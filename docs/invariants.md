# Invariants

Values and choices in this codebase that look arbitrary and are not. Each one has already cost a
debugging session. For each: what it is, what breaks if you change it, and how the breakage looks,
because none of these fail in a way a unit test catches.

---

## The HID usage is 0x03, not 0x02

`host/src/shared/descriptor.ts`, mirrored in `service/selftest.cpp`.

Windows ships `hidscanner.inf`, and its one and only compatible id is `HID_DEVICE_UP:008C_U:0002`.
Declaring usage `0x02` therefore hands the collection to Microsoft's own POS barcode class driver,
which does not start on this descriptor.

**How it looks when broken:** the parent `SWD\HidPosEmu\...` is healthy, the child devnode is class
`BarcodeScanner`, named `POS HID Barcode scanner`, in `CM_PROB_FAILED_START` with problem status
`STATUS_DEVICE_POWER_FAILURE` (`0xC000009E`). No device interface is published, so Chrome shows
nothing at all and `--selftest` reports `the device has no HID interface`. Nothing in the event log,
and DebugView is silent because the failing driver is Microsoft's, not ours.

No inbox INF claims any other usage on page `0x8C`, so `0x03` leaves the collection with the generic
HID driver. Apps do not notice: a WebHID filter for scanners matches on the usage *page*, not the
usage.

---

## The length byte counts the terminator

`host/src/shared/framing.ts`, pinned by `host/test/framing.test.ts`.

For `221-3351-753` the Newland length byte is `0x0d`, not `0x0c`: twelve characters plus CR. The
first design said `0x0c` and was wrong. When the two disagree, the tests are right.

**How it looks when broken:** off by one at the start or the end of every scanned string, in the
app only, with the wire bytes looking almost correct.

---

## The read handle must be opened with FILE_FLAG_OVERLAPPED

`service/hid.cpp`, used by `service/selftest.cpp`.

On a synchronous handle, `ReadFile` blocks inside the kernel until a report arrives and ignores the
`OVERLAPPED` it was given, so any timeout layered on top is unreachable. In the selftest the read is
started *before* the injection two lines below it, which makes a synchronous handle a guaranteed
self deadlock: the code waits for a report that it is itself supposed to send.

**How it looks when broken:** `--selftest` hangs forever with the process idle in `Wait/Executive`
and the device healthy in Device Manager. It never times out, because the two second guard is never
reached.

`OpenHidInterface` defaults to a synchronous handle on purpose: the injection and status paths want
one. Only the reader passes the flag.

---

## A zero length output buffer is report id 0, not an error

`driver/hidposemu.c`, `RequestGetHidXferPacket_ToWriteToDevice`.

mshidumdf cannot marshal `HID_XFER_PACKET`'s embedded pointer between processes, so it splits the
packet: the report body arrives as the input buffer and the report *id* as the output buffer's
*length*. A collection that declares no report ids means id 0, which arrives as a zero length output
buffer, and WDF answers a zero length buffer with `STATUS_BUFFER_TOO_SMALL`.

Treating that status as failure rejects every write to an id-less collection.

**How it looks when broken:** `newland` works perfectly and `generic` fails every scan with
`cannot write the report to the device (win32 122)`. Because only one profile is affected, it reads
like a profile or framing bug rather than a driver one.

---

## IOCTL_UMDF_HID_SET_OUTPUT_REPORT returns STATUS_NOT_SUPPORTED deliberately

`driver/hidposemu.c`.

The device has exactly one writable channel, and it is reached through `IOCTL_HID_WRITE_REPORT`.
Answering `HidD_SetOutputReport` would create a second path into the driver that bypasses
`WriteReport`, which is where the output report id is stripped.

**How it looks when broken:** reports reach the app with `reportId === 3`, the output report's
id, instead of `2`, the input report's.

---

## The descriptor bytes are pinned, not recomputed

`host/test/descriptor.test.ts`.

hidclass derives the collections from these bytes and apps key a device on those collections. A
test that recomputed the bytes from the builder would pass while an app stopped recognising the
device. Pinning is the point.

---

## Report ids 2, 3 and 4 are fixed

`host/src/shared/descriptor.ts`: input `2`, output `3`, feature `4`. The acceptance criteria and the cash
desk's own expectations name `reportId === 2` for a scan. The `generic` profile drops every Report ID
item, which is what makes its input report 65 bytes on the wire (64 body plus a leading zero) against
the newland profile's 64.

---

## The server finds `public\` by walking up, and its bundle is ESM

`host/src/server/paths.ts`, `installer/build.ps1`.

The server code runs from two depths: `src/server/` in a checkout, and the single bundled file
`host\bin\server.mjs` in a release. A fixed `../public/` could only ever be right for one of them, so
`paths.ts` walks up from its own location until it finds a directory holding `public/index.html`,
and derives `public/` and the ZXing UMD path from that. Moving the bundle deeper or shallower is
fine; putting it somewhere that does not have the host directory as an ancestor is not.

That walk starts from `import.meta.url`, which exists only in ESM, so the bundle must stay ESM.

The esbuild banner that injects `createRequire` is not optional either. `ws` is CommonJS, and without
a real `require` esbuild's ESM output substitutes a stub that throws on ws's first `require('events')`.

**How it looks when broken:** `Dynamic require of "events" is not supported` at startup, or a 404 for
the control page and `/vendor/zxing.js`.
