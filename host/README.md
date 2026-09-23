# HID-POS scanner emulator, host app

The unelevated half of the tool: a Node 20 process with a browser UI that frames a scan into HID
reports and hands them to `HidPosEmuSvc`, which owns the virtual device. The app under test never
talks to this process - it talks to the operating system, through the native `navigator.hid`.

## Run

```shell
yarn
yarn start
yarn start -- --port 7500          # non-default port
```

Then open <http://localhost:7411>. With `--open` the host opens the page itself, as an Edge app
window, and if the port is already taken it only opens the window and exits; the release's
`HidPosEmu.cmd` launcher runs it that way.

To work on the host itself, run `yarn dev` instead (it takes the same `--port`). It rebuilds the page
on every save in `src/ui/` and restarts the server on every save in `src/server/` or `src/shared/`.
There is no hot reload, so refresh the browser after a change. Restarting the server does not
unplug devices: they belong to the service, and the host picks them up again when it reconnects.

The header says what the service is doing:

| Status                                | Meaning                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| `Service: connected, driver installed` | ready, plug in a profile                                    |
| `Service: connected, driver missing`   | the service runs but no driver package is staged            |
| `Service: disconnected`                | the service is not running, or this is not Windows          |

The client reconnects to the pipe every 2 s, so starting the service later needs no restart here.

## Install on Windows

The host alone does nothing: the driver and the service have to be installed once per machine.
Run `HidPosEmu-<version>-Setup.exe`, or unzip `HidPosEmu-<version>-x64.zip` and double-click
`Install.cmd`; either way one UAC prompt, and Node.js comes with it.
Details in `installer/README-install.md`, the full walk-through with the
acceptance criteria in `docs/windows-runbook.md`.

On Linux the host runs, serves the UI and answers `POST /scan`, but shows the service as
disconnected: there is nothing to create a device with. That is enough to work on the host itself
and to run its tests, which is exactly what CI does.

## Device profiles

| id                        | vendorId / productId | report | framing                                                                                                                                     |
| ------------------------- | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `newland`                 | `0x1eab` / `0x3910`  | 63 B   | `[length][56 payload][padding]`, an app that knows Newland reads the length byte first                                                      |
| `generic`                 | `0x05e0` / `0x1200`  | 64 B   | `[64 payload]`, no length byte, the app decodes the whole report as text                                                                    |
| `unknownVendorLengthByte` | `0x0c2e` / `0x0bfe`  | 63 B   | Newland framing under a vendor id the app does not know, so the length byte `0x38` is decoded as the character `8`                            |

`newland` and `unknownVendorLengthByte` declare report ids (input 2, output 3, feature 4) and put
64 bytes on the wire, of which the first is the report id; the browser strips it, so the app sees
63 bytes. `generic` declares no report ids and the app sees 64.

`descriptor.ts` builds the report descriptor for each profile and `toServiceProfile` turns the
profile into the seven device properties the driver reads. The descriptor bytes are pinned by
`test/descriptor.test.ts`, because hidclass derives the collections from them and apps key a
device on those collections.

## Presets

| id              | text                                   | what it exercises                                          |
| --------------- | -------------------------------------- | ---------------------------------------------------------- |
| `ticketBarcode` | `221-3351-753`                         | a short barcode, one report                                |
| `ticketQrPin`   | a 69-character ticket URL, `?pin=39321` | a QR longer than one report: two reports on Newland        |
| `cardNumber`    | `1234 5678 9123 4567`                  | a 16-digit card number with spaces                         |
| `bookingCode`   | `L9NV277X`                             | a short alphanumeric code                                  |
| `receiptQr`     | synthetic 180-character receipt QR     | a long QR that matches none of the above                   |
| `custom`        | the textarea                           |                                                            |

The `receiptQr` payload is synthetic: the field order of an Austrian RKSV receipt, placeholder
values.

## Fault modes

| fault                   | what it does                                             | what to expect                                                                                     |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `missingLengthByte`     | a length-byte profile sends the payload from byte 0      | the first payload byte is read as a length that exceeds the report; first character lost           |
| `noTerminator`          | no CR / LF / ETX at the end                              | the scan never completes, the next scan arrives with the tail of this one                           |
| `terminatorInOwnReport` | the terminator arrives as its own report `[1, 0x0d, 0…]` | the scan completes one report later                                                                 |

The `8https://…` corruption of a length byte read as text is reproduced by the
`unknownVendorLengthByte` profile, not by a fault mode.

## Scan from image

A photo or screenshot is a second source for the same Custom field. Drop a file on the image zone,
choose one, or press `Cmd/Ctrl+V` with a picture in the clipboard; pasting text into the textarea
still works normally.

Decoding happens in the page, in two layers:

1. **`BarcodeDetector`** (native in Chromium) returns every code on the picture at once, so a photo
   of a receipt yields a barcode and two QR codes as three rows.
2. **ZXing** (`@zxing/library`, served from `/vendor/zxing.js`, loaded only when it is needed) is
   the fallback for browsers without `BarcodeDetector` and returns one code per image.

Images larger than 2000px on the longest side are scaled down on a canvas before decoding.

Clicking a row puts its text into Custom and switches the AIM prefix to the one that matches the
symbology, showing a `from image: receipt.jpg · code_128` badge. A single code is applied without a
click, and `Scan right after decode` sends it immediately. Editing the textarea by hand clears the
badge. Failures show under the zone: `No barcode found — try a sharper, closer photo` or
`Unsupported file type`.

| format     | AIM   | format        | AIM       |
| ---------- | ----- | ------------- | --------- |
| `qr_code`  | `]Q3` | `ean_8`       | `]E4`     |
| `code_128` | `]C0` | `upc_e`       | `]E0`     |
| `code_39`  | `]A0` | `itf`         | `]I0`     |
| `code_93`  | `]G0` | `data_matrix` | `]d2`     |
| `ean_13`   | `]E0` | `pdf417`      | `]L2`     |
| `aztec`    | `]z3` | anything else | no prefix |

## HTTP API

```shell
curl -s localhost:7411/state | jq                     # service status, devices, presets, profiles, log

curl -X POST localhost:7411/scan \
  -H 'content-type: application/json' \
  -d '{"presetId":"ticketQrPin"}'                     # 202 {"status":"accepted","reportCount":2}

curl -X POST localhost:7411/scan \
  -H 'content-type: application/json' \
  -d '{"text":"221-3351-753","profileId":"generic","options":{"aimPrefix":"]Q3","terminator":"CR","delayMs":5,"faults":["noTerminator"]}}'
```

`profileId` defaults to the only plugged-in device, or to `newland`. The contract is unchanged from
the previous emulator, so anything scripted against it keeps working, with one difference: a scan
for a profile that is not plugged in now fails with `400 {"error":"not plugged"}` instead of being
framed into the void, because the report has nowhere to go.

## Pipe protocol

`src/server/serviceClient.ts` connects to `\\.\pipe\HidPosEmu` and speaks JSON lines, one object per line,
UTF-8. Requests carry an `id`; the answer with the same `id` resolves the call, after 5 s it fails.
`device` events arrive unsolicited.

```ts
type ServiceRequest =
  | { id: number; op: 'list' }
  | { id: number; op: 'plug'; profile: ServiceProfile }
  | { id: number; op: 'unplug'; instanceId: string }
  | { id: number; op: 'emit'; instanceId: string; reportsHex: Array<string>; delayMs: number };

type ServiceResponse =
  | { id: number; ok: true; devices?: Array<ServiceDevice>; reportCount?: number }
  | { id: number; ok: false; error: string; win32?: number };

type ServiceEvent =
  | { event: 'hello'; version: string; driverInstalled: boolean }
  | { event: 'device'; device: ServiceDevice; state: 'plugged' | 'unplugged' | 'reader' };
```

`reportsHex` is one lowercase hex string per report **as it goes on the wire**: the report id byte
followed by the report bytes for a profile with report ids, the report bytes alone otherwise. The
service writes each one into the body of an output report; the driver re-emits that body verbatim
as an input report. `framing.ts` decides what those bytes are, and the driver never looks inside.

Failures are explicit and carry the service's own wording: `already plugged`, `not plugged`,
`report too long`, `driver not installed, run install.ps1`, plus the Win32 error code when there
is one.

## Tests

```shell
yarn test        # node:test - framing (12), AIM (7), descriptors (2), service client (4)
yarn typecheck
```

Framing, the AIM table, the report descriptors and the pipe codec are pure and unit tested. The
service client is tested against an in-process socket server, not the real pipe. Everything that
needs a device is in the manual checklist below.

## Manual QA checklist

The acceptance criteria in `docs/windows-runbook.md`, section 6, are the checklist: Windows 11 x64
(build 22000 or newer) with Secure Boot on, a non-admin account plus one UAC approval, Chrome 128 or
newer, and the WebHID app under test.
