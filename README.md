# hid-pos-emulator

A HID-POS barcode scanner that does not exist. It creates a virtual USB-HID device at the operating
system level on Windows 11, so the **native** `navigator.hid` in Chrome, Edge or an Electron app
enumerates it as a real Newland scanner, delivers real `inputreport` events, and lets a developer
reproduce barcode and QR scans, including broken ones, without hardware.

The app under test is not touched: no webpack plugin, no polyfill, no build flag, no stub. It reads
the emulator exactly as it reads a scanner on a USB port.

## How it fits together

```
 Windows 11 developer machine
 +----------------------------------------------------------------------------+
 |  control page http://localhost:7411  --ws-->  host (Node/TS, unelevated)    |
 |  (src/ui, React: presets, faults,            framing.ts builds the wire     |
 |   photo decoder, POST /scan)                 reports                        |
 |                                                    | named pipe JSON lines  |
 |                                                    v                        |
 |                                        HidPosEmuSvc.exe (service, SYSTEM)   |
 |                                        SwDeviceCreate("HidPosEmu", ...)     |
 |                                        WriteFile(hidHandle, report)         |
 |                                                    |                        |
 |  your app in Chrome / Edge / Electron   hidclass.sys + MsHidUmdf.sys        |
 |  navigator.hid.requestDevice <--------  HidPosEmu.dll (UMDF2 minidriver)    |
 |  inputreport (63 B, reportId 2)         SWD\HidPosEmu\newland               |
 +----------------------------------------------------------------------------+
```

The host frames a scan into HID reports and hands them to the service as hex. The service writes
each one to the device's output report; the driver treats that body as the input report to emit and
completes a pending read with it. From the browser's point of view a scanner just scanned.

## Quick start

On Windows 11 with Smart App Control off, once per machine:

1. Get `HidPosEmu-<version>-Setup.exe` from the releases and run it (More info, Run anyway),
   approve the single UAC prompt, and restart if it asks you to.
2. Start **HID-POS emulator** from the Start menu, press **Plug in** on a profile, and the scanner
   is there for `navigator.hid`.

Node.js is built into the release. `installer/README-install.md`, which ships with it, has the
details and the zip alternative. Working on the emulator itself: `cd host`, `yarn`, `yarn dev`.

**Windows 11 x64 only.** The driver and the service are the whole product and neither exists
anywhere else.

The host alone is portable, which is what CI relies on: on Linux it runs, serves its UI and answers
`POST /scan`, reporting the service as disconnected because there is no device to drive. That is
enough to work on the host and to run its tests.

## What is in here

| Directory    | What it is                                                                     |
| ------------ | ------------------------------------------------------------------------------ |
| `driver/`    | `HidPosEmu`, a UMDF 2 virtual HID minidriver (C, x64), derived from vhidmini2   |
| `service/`   | `HidPosEmuSvc`, the Win32 service that owns `SwDeviceCreate` and injects reports |
| `host/`      | the Node 20 host app, its browser UI, the framing, the presets and the tests    |
| `installer/` | build, sign, install and uninstall scripts, the launcher and Setup.exe          |
| `docs/`      | the architecture, the Windows runbook and the knowledge base                    |
| `tools/`     | PowerShell diagnostics: enumerate the HID interface, read reports from it        |

## Documentation

Start at [`CLAUDE.md`](CLAUDE.md), which orients a newcomer, human or agent, and points at the rest.

**Working on the code**

- [`docs/architecture.md`](docs/architecture.md) - how the pieces fit at the OS level, the device tree, the injection path
- [`docs/invariants.md`](docs/invariants.md) - values that look arbitrary and are not, with the symptom each one produces
- [`docs/verification.md`](docs/verification.md) - proving it works without a browser, and the exact bytes to expect
- [`docs/field-notes.md`](docs/field-notes.md) - what the first Windows bring-up established, including a rejected hypothesis

**Running it**

- [`docs/windows-runbook.md`](docs/windows-runbook.md) - build, install, verify, troubleshoot
- [`docs/windows-setup.md`](docs/windows-setup.md) - install from zero on a Windows 11 machine, self contained, in Ukrainian
- [`host/README.md`](host/README.md) - profiles, presets, faults, HTTP API, pipe protocol
- [`installer/README-install.md`](installer/README-install.md) - installing a release, for people who only use it

## Building

Using the emulator needs no build. Releases are built on a machine with Visual Studio 2026 and a
matching SDK + WDK pair, set up as described in [`docs/windows-runbook.md`](docs/windows-runbook.md):

```powershell
.\installer\build.ps1 -Version 1.0.0
```

CI (`.github/workflows/host.yml`) covers the host only: `yarn test` and `yarn typecheck` on Node 20.
