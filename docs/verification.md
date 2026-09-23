# Verification without a browser

`navigator.hid.requestDevice` refuses to open its picker without a real user gesture, and the cash
desk needs a person driving it. That puts a hard floor under what can be automated — but the floor is
much lower than it first appears. Everything beneath WebHID can be proven headlessly, including the
actual bytes of a scan, and doing so isolates a failure to one side of the browser boundary.

Three levels, cheapest first.

## Level 1: is the devnode healthy

```powershell
Get-PnpDevice | Where-Object { $_.InstanceId -like '*HIDPOSEMU*' -and $_.Problem -ne 'CM_PROB_PHANTOM' } |
  Format-List InstanceId, FriendlyName, Status, Problem, Class
```

Each plugged profile must show two entries: `SWD\HidPosEmu\<profile>` and a child
`HID\HidPosEmu\1&<hash>&0&0000` named **`HID-compliant device`** under class `HIDClass`, both `OK`
and `CM_PROB_NONE`.

Filter on `CM_PROB_PHANTOM` or the list fills with every device that was ever plugged. Phantom means
removed, not broken.

## Level 2: what an application sees

`tools/hid-enum.ps1` walks `GUID_DEVINTERFACE_HID` through `setupapi` and reads each interface with
`hid.dll`, which is the same route Chrome takes. It needs no elevation.

```powershell
.\tools\hid-enum.ps1
```

For a plugged `newland` it prints:

```
  productName  : NLS-HR22
  vendorId     : 0x1eab
  productId    : 0x3910
  serialNumber : EMU-NEWLAND-0001
  usagePage    : 0x8c
  usage        : 0x3
  in/out/feat  : 64/65/3
```

That is acceptance criterion 3 minus Chrome's own dialog. If these values are right, WebHID has
everything it needs; if the picker still shows nothing, the problem is in Chrome or the page, not in
the device.

Report lengths differ per profile and this is correct, not a bug: `newland` and
`unknownVendorLengthByte` are `64/65/3`, `generic` is `65/65/3`, because it declares no report ids and
so carries a leading zero byte instead.

## Level 3: the actual bytes of a scan

`tools/hid-read.ps1` opens the interface for reading, exactly as an application does after
`device.open()`, and prints the reports that arrive.

```powershell
.\tools\hid-read.ps1 <vendorId> [reportCount]
.\tools\hid-read.ps1 0x1eab 2      # wait for two reports from the newland profile
```

It must be started *before* the scan is triggered, and it blocks until the reports arrive, so run it
in one window and fire the scan from another. It sizes its buffer from the device's own
`InputReportByteLength`; a fixed buffer fails with `ERROR_INVALID_USER_BUFFER` on the profile whose
length differs.

## Driving the host without a browser

The control page is an ordinary WebSocket client, so anything can take its place. From the page's own
console, or any WebSocket client pointed at `ws://localhost:7411`:

```js
ws.send(JSON.stringify({ type: 'ui-hello' }));
ws.send(JSON.stringify({ type: 'ui-plug', profileId: 'newland' }));
ws.send(JSON.stringify({ type: 'ui-scan', presetId: 'ticketBarcode', profileId: 'newland' }));
ws.send(JSON.stringify({ type: 'ui-scan', presetId: 'ticketBarcode', profileId: 'newland',
                         options: { faults: ['noTerminator'] } }));
```

The reply `{"type":"ui-scan-result","reportCount":N}` tells you how many reports were emitted, which
is worth checking against what the reader saw. `{"type":"ui-error","message":...}` is how the service
reports a refusal.

## Expected bytes

Verified on Windows 11 build 26200. `ticketBarcode` is `221-3351-753`; `ticketQrPin` is the ticket
URL for `505-1786-106` with pin `39321`.

| Case | Reports | First bytes |
| ---- | ------- | ----------- |
| `newland` + `ticketBarcode` | 1 | `02 0d 32 32 31 2d 33 33 35 31 2d 37 35 33 0d` |
| `generic` + `ticketBarcode` | 1 | `00 32 32 31 2d 33 33 35 31 2d 37 35 33 0d` |
| `newland` + `ticketQrPin` | 2 | `02 38 68 74 74 70 73 …` then `02 0e 31 30 36 3f 70 69 6e 3d 33 39 33 32 31 0d` |
| `unknownVendorLengthByte` + `ticketQrPin` | 2 | identical framing to `newland` |
| fault `missingLengthByte` | 1 | `02 32 32 31 2d …` — no length byte at all |
| fault `noTerminator` | 1 | `02 0c 32 32 31 … 37 35 33` — length 12, no CR |
| fault `terminatorInOwnReport` | 2 | `02 0c 32 32 31 … 37 35 33` then `02 01 0d` |

Reading the first row: report id `02`, length byte `0x0d` (twelve characters plus the CR), the text,
then `0x0d`. The `generic` row has no report id byte of its own and no length byte, which is what
acceptance criterion 6 means by `reportId === 0` and `data.byteLength === 64`.

Two of these are worth keeping in mind because they explain criteria that otherwise look strange:

- The length byte in the `ticketQrPin` first report is `0x38`, which is the ASCII digit `8`. An
  application that does not know the vendor and so does not strip that byte sees text beginning
  `8https://`. That is criterion 7, and it is a property of the wire format rather than a bug.
- `missingLengthByte` removes the byte entirely, so any reader expecting one consumes the leading
  `2` of the ticket number as a length. That is the "lost first character" in criterion 8.

## What still needs a person

Chrome's device picker, and everything an app does with a scan: its own log lines, what it ignores,
and an Electron window. Criteria 5, 8 in its logging half, 9 and 11 of `windows-runbook.md`.
