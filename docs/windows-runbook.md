# Windows runbook

Everything that has to happen on a Windows 11 x64 machine, in order: install the toolchain, build,
sign, install, verify, and what to do when a step goes wrong. The driver and the service cannot be
built anywhere else, so this is the only place they are exercised.

Assumed environment: Windows 11 x64, build 22000 or newer, Secure Boot on, test signing off,
**Smart App Control off**, a developer account plus one administrator approval.

Smart App Control is not optional to get right. It refuses to run a self signed binary at all, as a
service and from a console alike, so with it on the service cannot start no matter what else is
correct. Check before anything else, `0` means off:

```powershell
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState).VerifiedAndReputablePolicyState
```

Turning it off is a one way door: it cannot be switched back on without resetting Windows.

## 1. Toolchain, once per machine

Microsoft pairs each Visual Studio release with one WDK, and the SDK and WDK **build numbers must
match**. Pick one pair and stay on it:

| Pair | Visual Studio | SDK + WDK |
| ---- | ------------- | --------- |
| current (recommended) | 2026, Community or Build Tools | 10.0.28000.x |
| older | 2022 | 10.0.26100.6584 |

1. **Visual Studio 2026**, either *Build Tools* (no IDE, enough for `build.ps1`) or *Community*,
   from <https://visualstudio.microsoft.com/downloads/>. Select the workload *Desktop development
   with C++*, then under *Individual components* add, searching for `spectre`:
   *C++ Spectre-mitigated libraries for x64/x86*, *C++ ATL with Spectre mitigations for x64/x86*,
   *C++ MFC with Spectre mitigations for x64/x86*. The WDK build fails without them. In the same
   tab add **Windows Driver Kit**, which is the WDK Visual Studio extension; without it `msbuild`
   cannot build a `DriverType=UMDF` project. The ARM64 variants of the Spectre components are not
   needed, this repository builds x64 only.
2. **Windows SDK**, latest, from
   <https://developer.microsoft.com/windows/downloads/windows-sdk/>. The C++ workload does not
   install the version the WDK needs, so this step is not optional.
3. **Windows Driver Kit**, latest, from
   <https://learn.microsoft.com/windows-hardware/drivers/download-the-wdk>. Install it after the
   SDK. If the installer says it cannot find the WDK extension, add *Windows Driver Kit* in the
   Visual Studio Installer under *Individual components* and run the WDK installer again.
4. **Node 20** and **yarn 1.22** for the host: `winget install OpenJS.NodeJS.LTS`, then
   `npm i -g yarn@1.22.22`. The release bundles this Node, so it has to be x64 and 20 or newer.
5. **Inno Setup 6**, for `Setup.exe`; optional, without it the build makes only the zip. No
   administrator needed: `winget install JRSoftware.InnoSetup --override "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CURRENTUSER"`.

Check:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter inf2cat.exe -Recurse | Select-Object -First 1
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory | Select-Object -ExpandProperty Name
node --version    # v20.x
```

## 2. Build a release

```powershell
cd hid-pos-emulator
.\installer\build.ps1 -Version 1.0.0
```

The script creates `installer\HidPosEmu.pfx` (gitignored) and `installer\HidPosEmu.cer` the first
time it runs, builds both solutions, runs `inf2cat`, signs the catalog, the driver DLL and the
service, bundles the host with esbuild and this machine's `node.exe`, and writes
`out\HidPosEmu-1.0.0-x64.zip`; then, if Inno Setup is installed, `out\HidPosEmu-1.0.0-Setup.exe`
from the same files, signed with the same certificate.

Run `yarn` in `host\` at least once before building, or the bundle step has no esbuild to call. The
results are self contained: whoever installs them needs no toolchain, no Node.js, no yarn and no
registry access. Setup.exe is what to hand to people who only use the emulator.

**Keep the .pfx.** Regenerating it means every machine that already trusts the old certificate has
to import the new one, and the old driver package has to be removed first.

## 3. Install

For a teammate, running `HidPosEmu-<version>-Setup.exe` is the whole step, and a failure there is
explained in `%ProgramFiles%\HidPosEmu\install.log`. From the zip it is double-clicking
`Install.cmd`, which bypasses the execution policy for that one process; `install.ps1` elevates itself (the single UAC prompt), and
the elevated window stays open at the end, with an offer to restart on a first install. Explorer's
own "Run with PowerShell" does not bypass the policy, so a downloaded `.ps1` just closes.

When bringing the tool up, run it from a PowerShell opened **as administrator** instead, so its
output stays in a window you already have. Scripts are blocked by default, hence the first line.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Expand-Archive .\out\HidPosEmu-1.0.0-x64.zip -DestinationPath C:\Tools\HidPosEmu -Force
cd C:\Tools\HidPosEmu
.\install.ps1
```

**Reboot after the first install on a machine.** Windows stages its own UMDF files for the HID stack
and reports `ERROR_SUCCESS_REBOOT_REQUIRED` (`0xbc3`) in `C:\Windows\inf\setupapi.dev.log`; until
the reboot the device is created but cannot start. The service comes back by itself, it is auto
start.

Expected output, ending with:

```
Service : Running
Pipe    : \\.\pipe\HidPosEmu

Creating the Start menu and desktop shortcuts

Next: start 'HID-POS emulator' from the Start menu or the desktop.
```

The shortcuts, for all users, point at `HidPosEmu.cmd` in the unzipped folder. A package built with
`-SkipHost` has no bundled host and no launcher, creates no shortcuts and prints
`cd host && yarn && yarn start` instead.

## 4. Selftest

```powershell
& "$env:ProgramFiles\HidPosEmu\HidPosEmuSvc.exe" --selftest
```

Expected:

```
selftest OK: 64 bytes, report id 2, text 221-3351-753
```

Exit code 0. It plugs a `selftest` device, injects the `ticketBarcode` report, reads it back
through the HID interface, compares the first 15 bytes against
`[0x02, 0x0d, '2','2','1','-','3','3','5','1','-','7','5','3', 0x0d]` and unplugs again.

`0x0d` in second position is the Newland length byte, which counts the terminator: 12 characters of
`221-3351-753` plus CR. `framing.ts` and `test/framing.test.ts` are the authority on the wire
format; the first design said `0x0c` and was corrected to match them.

## 5. Run the host

From an installed release, start the **HID-POS emulator** shortcut. It runs `HidPosEmu.cmd`, which
starts `host\bin\server.mjs --open` on the bundled `host\node\node.exe` in a minimised console and
opens the page as an Edge app window (`msedge --app=`). If port 7411 is already taken, `--open`
takes that to be the emulator and only opens a window. The host alone, without the launcher, from
the install folder (`%ProgramFiles%\HidPosEmu` after Setup.exe):

```powershell
.\host\node\node.exe .\host\bin\server.mjs
```

From a checkout, with the VPN up so `yarn` can reach the registry:

```shell
cd host
yarn
yarn start
```

Open <http://localhost:7411>. The header must read `Service: connected, driver installed` within
2 s.

`build.ps1` produces that bundle with esbuild, which is why installing a release needs neither yarn
nor the npm registry. `build.ps1 -SkipHost` opts out and produces a driver-only zip.

## 6. Acceptance criteria

Run these with the WebHID app you are testing open in Chrome. Where a step only needs the raw
reports, the snippet under "Scans arrive but the app ignores them" below is enough of an app.
A preset id below means that preset's text, typed into the page or sent as `presetId` to
`POST /scan` (see `host/README.md`).

| #   | Step                                                                                                                          | Expected                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `install.ps1`; then `bcdedit /enum {current} \| findstr testsigning`; `Get-Service HidPosEmuSvc`; `pnputil /enum-drivers`      | exit code 0 after exactly one UAC prompt; `findstr` prints nothing; the service is `Running`; the enumeration lists `HidPosEmu.inf`                                                                                  |
| 2   | `yarn start` in `host/`                                                                                                       | the UI shows `Service: connected, driver installed` within 2 s                                                                                                                                                       |
| 3   | UI "Plug in" on `newland`, then Device Manager, then `navigator.hid.requestDevice({ filters: [{ usagePage: 0x8c }] })`         | `SWD\HidPosEmu\newland` exists and its child devnode is a `HID-compliant device` with no error; the picker lists `vendorId 0x1eab`, `productId 0x3910`, `productName 'NLS-HR22'`, `serialNumber 'EMU-NEWLAND-0001'`, one collection `usagePage 0x8c` / `usage 0x03` |
| 4   | `await device.open()`, then preset `ticketBarcode`                                                                            | one `inputreport`, `reportId === 2`, `data.byteLength === 63`, `data.getUint8(0) === 0x0d`, bytes 1 to 12 `221-3351-753`, byte 13 `0x0d`                                                                             |
| 5   | The app on `newland`: `ticketBarcode`, `ticketQrPin`, `cardNumber`, `bookingCode`, `receiptQr`                               | each reads as the preset text once the app drops the length byte and the terminator; `ticketQrPin` arrives as 2 reports and reassembles to the full URL; `receiptQr` arrives whole over several reports |
| 6   | Same on `generic`                                                                                                             | identical text, `data.byteLength === 64`, `reportId === 0`                                                                                                                                                           |
| 7   | `unknownVendorLengthByte` + `ticketQrPin`                                                                                     | an app that picks its decoding by vendor id reads `8https://`: the length byte `0x38` taken as a character                                                                                                          |
| 8   | Faults `missingLengthByte`, `noTerminator`, `terminatorInOwnReport`                                                           | a length that exceeds the report size and a lost first character; a scan that never completes, its tail carried into the next scan; a scan that completes one report later                                          |
| 9   | UI "Unplug", then "Plug in" again, without reloading the app                                                                  | `navigator.hid` fires `disconnect` within 2 s; then `connect` within 2 s of plugging in                                                                                                                             |
| 10  | Plug `newland` and `generic` at the same time                                                                                 | two devices in `requestDevice`; scans reach only the selected one                                                                                                                                                    |
| 11  | An Electron app's main window                                                                                                 | criteria 5 and 9 pass, with no change to the app                                                                                                                                                                     |
| 12  | `HidPosEmuSvc.exe --selftest`                                                                                                 | `selftest OK`, exit code 0                                                                                                                                                                                           |
| 13  | `git status --porcelain` in the app's repository                                                                              | empty for the whole run: nothing in the app had to change                                                                                                                                                            |
| 14  | Reboot, then Event Viewer System log, then "Plug in"                                                                          | the service is `Running`, no device was auto-created, no `HidPosEmu` / `WUDFRd` / `MsHidUmdf` errors, plugging in works                                                                                               |
| 15  | `uninstall.ps1`, then `pnputil /enum-drivers` and `pnputil /enum-devices /class HIDClass`                                     | exit code 0; no service, no `HidPosEmu.inf`, no `SWD\HidPosEmu` devnodes, both certificate stores clean                                                                                                               |
| 16  | `cd host && yarn test && yarn typecheck`                                                                                      | 25 tests pass, typecheck passes                                                                                                                                                                                      |
| 17  | `install.ps1` again on the same machine                                                                                       | exit code 0, one service, one certificate in each store                                                                                                                                                              |

## 7. Debugging the service in the foreground

```powershell
Stop-Service HidPosEmuSvc
& "$env:ProgramFiles\HidPosEmu\HidPosEmuSvc.exe" --console
```

It prints what it is doing and stops on Ctrl+C. Only one process can own the pipe name, so the
service has to be stopped first.

Driver traces go to the kernel debugger output. Without a debugger attached, use DebugView from
Sysinternals with *Capture Global Win32* enabled; every driver line starts with `HidPosEmu:`.

**A Release build emits none of them.** `KdPrint` compiles to nothing outside a Debug build, so
DebugView staying empty says nothing about what the driver did. Rebuild with
`.\installer\build.ps1 -Configuration Debug` before concluding anything from silence there.

## Troubleshooting

### Yellow bang on the device in Device Manager

Right-click the device, Properties, General, and read the error code.

- **Code 10, "This device cannot start"**: read the failing devnode's *class* first, it splits two
  very different causes.
  - Class `BarcodeScanner`, friendly name `POS HID Barcode scanner`, problem status
    `STATUS_DEVICE_POWER_FAILURE` (`0xC000009E`): this is not our driver. Windows bound its own
    `hidscanner.inf` to the collection, whose one compatible id is `HID_DEVICE_UP:008C_U:0002`, and
    that driver does not start on this descriptor. The parent `SWD\HidPosEmu\...` stays healthy
    while the child fails, and no HID interface is published at all. The descriptor declares usage
    `0x03` precisely to avoid this; if you see it, something put usage `0x02` back. A healthy child
    reads `HID-compliant device` under class `HIDClass`.
  - Class `HIDClass`: `EvtDeviceAdd` in our own driver failed, almost always a device property it
    rejected. Look for `HidPosEmu: device property <name> is missing` or `... has type 0x..`; the
    name tells you which of the seven properties the service sent wrongly. A report descriptor
    longer than 512 bytes or a string longer than 126 characters fails the same way. Note that those
    lines only exist in a Debug build, see the debugging section.

  ```powershell
  Get-PnpDevice | Where-Object { $_.InstanceId -like '*HIDPOSEMU*' -and $_.Problem -ne 'CM_PROB_PHANTOM' } |
    Format-List InstanceId, FriendlyName, Status, Problem, Class
  ```
- **Code 28, "The drivers for this device are not installed"**: the driver package is not staged.
  `pnputil /enum-drivers | Select-String HidPosEmu` should list it; if not, run `install.ps1`
  again.
- **Code 52, "Windows cannot verify the digital signature"**: the certificate is not in both
  stores. `certutil -store Root "HidPosEmu Dev Signing"` and the same for `TrustedPublisher` must
  both find it. Note that a UMDF driver needs no kernel signature, so this is never about Secure
  Boot; do not turn test signing on.
- **Code 31 or 39 after a rebuild**: an old package is still bound. Run `uninstall.ps1`, then
  `install.ps1`.

### `pnputil` exit codes

| Code       | Meaning                                     | What to do                                                                       |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 0          | success                                     |                                                                                  |
| 259        | success, nothing matched the driver update  | expected on a machine with no device plugged in yet; `install.ps1` treats it as success |
| 3010       | success, a reboot is required                | reboot, then run `install.ps1` again                                             |
| 5          | access denied                                | the script was not run as administrator                                          |
| 87         | invalid parameter                            | the INF path is wrong, or the INF is malformed                                   |
| 259 on delete | no such published driver                  | it was already removed                                                           |

`pnputil /enum-drivers` prints the published name (`oemNN.inf`) that `uninstall.ps1` looks up.

### The service will not start, or the binary refuses to run

`Start-Service` fails with *"Cannot start service HidPosEmuSvc"*, and the System log shows event
7000 with **"An Application Control policy has blocked this file"**. That is Smart App Control, and
it blocks the binary everywhere, not just as a service, so `--selftest` from a console fails the same
way. Confirm it in the CodeIntegrity log:

```powershell
Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 20 |
  Where-Object { $_.Message -match 'HidPosEmu' } | Select-Object TimeCreated, Id, Message
```

Events 3033 and 3077 naming `HidPosEmuSvc.exe` confirm it. Turn Smart App Control off, see the top
of this document. Nothing else fixes it short of signing the binaries with a certificate Windows
already trusts.

### The build fails

- **`inf2cat.exe not found`**, or **`Unable to load DLL 'x86\InfVerif.dll'`**: the kit ships
  `inf2cat.exe` x86-only, and `InfVerif.dll` x64-only, so the build has to find the first outside
  `x64\` and run the 64 bit MSBuild. `build.ps1` does both; a failure here means it was reverted.
- **`MSB8020 ... Platform Toolset = 'v143'`**: that toolset belongs to Visual Studio 2022. Visual
  Studio 2026 ships `v145`. The service project follows `$(DefaultPlatformToolset)` so it tracks
  whatever is installed.
- **`warning C4100 ... treated as error`**: a parameter used only inside `KdPrint` looks unused in
  Release, because `KdPrint` compiles away. Mark it with `UNREFERENCED_PARAMETER`.
- **The build dies right after `Bundling the host` with an empty `NativeCommandError`**: esbuild
  reports even a clean build on stderr, and `$ErrorActionPreference = 'Stop'` turns any stderr from
  a native command into a terminating error. `build.ps1` runs it with `--log-level=error` and judges
  the run by its exit code instead.
- **`esbuild not found`**: run `yarn` in `host\` first, or `build.ps1 -SkipHost` for a driver-only
  zip.

### The host says "Service: disconnected"

1. `Get-Service HidPosEmuSvc` - if it is not `Running`, `Start-Service HidPosEmuSvc` and check the
   System log for a start failure.
2. `Test-Path \\.\pipe\HidPosEmu` - `False` while the service is running means it failed to create
   the pipe; run it with `--console` to see the reason.
3. **Access denied on the pipe**: the pipe's DACL grants `GRGW` to Authenticated Users. A machine
   with a policy that strips that, or a host running as a service account outside Authenticated
   Users, cannot connect. Confirm with
   `[System.IO.Pipes.NamedPipeClientStream]::new('.', 'HidPosEmu', 'InOut')` and `.Connect(2000)`
   from the same account that runs `yarn start`.
4. Only one process at a time can own the pipe name. If `--console` was left running, stop it.

### Chrome does not list the device

1. Open `chrome://device-log`, clear it, then unplug and plug the device from the UI. Every HID
   device Chrome enumerates leaves a line there. `HID device added: vendor=1eab product=3910` means
   Chrome sees it and the problem is the filter or the picker; nothing at all means Chrome never
   enumerated it.
2. Chrome enumerates `GUID_DEVINTERFACE_HID` interfaces. Confirm the interface exists at all:
   ```powershell
   Get-CimInstance Win32_PnPEntity | Where-Object { $_.DeviceID -like 'HID*VID_1EAB*' }
   ```
   Nothing means hidclass did not publish a collection, which points back at the report descriptor
   or a yellow bang on the parent.
3. The filter is `usagePage: 0x8c` only. A descriptor whose top level collection is not on page
   0x8C is enumerated by Chrome but hidden by the picker; `test/descriptor.test.ts` pins the bytes,
   so a mismatch means the service sent a different descriptor than the host built.
4. `requestDevice` must be called from a user gesture and over `localhost` or HTTPS.
5. A device already granted to the page does not reappear in the picker; check
   `await navigator.hid.getDevices()`.

### A scan fails with `cannot write the report to the device (win32 122)`

Win32 122 is `ERROR_INSUFFICIENT_BUFFER`, which is `STATUS_BUFFER_TOO_SMALL` coming back from the
driver, and it hits only the profiles whose descriptor declares no report ids, `generic` above all.

`RequestGetHidXferPacket_ToWriteToDevice` reads the report id out of the *length* of the request's
output buffer, because mshidumdf puts it there. A collection with no report ids means report id 0,
which mshidumdf expresses as a zero length output buffer, and WDF answers a zero length buffer with
`STATUS_BUFFER_TOO_SMALL`. Treating that status as failure rejects every write to an id-less
collection. The driver now reads it as report id 0.

If this comes back, check that branch before looking anywhere else: `newland` will keep working
while `generic` fails, which makes it look like a profile or framing problem rather than a driver
one.

### Scans arrive but the app ignores them

Check the report in the page first:

```js
const [device] = await navigator.hid.getDevices();
await device.open();
device.addEventListener('inputreport', (event) =>
  console.log(event.reportId, new Uint8Array(event.data.buffer)));
```

If the bytes are right, the problem is in the app's decoding, not here. If `reportId` is 3 rather than
2, the driver re-emitted the output report id instead of the body: that means the write path went
around `WriteReport`, so check that the service is writing with `WriteFile` and not
`HidD_SetOutputReport`, which the driver answers with `STATUS_NOT_SUPPORTED` on purpose.
