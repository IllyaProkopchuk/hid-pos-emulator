# Architecture

How the three components fit together, and what Windows does with them. `README.md` has the picture;
this is the part that matters when something does not work.

## The chain, once

A scan starts as text in the control page and ends as an `inputreport` event in the app under test. It
crosses two process boundaries and one privilege boundary on the way.

```
 control page (browser)          host (Node, unelevated)        service (LocalSystem)
 text, faults, options     --ws-->  framing.ts builds the   --pipe-->  SwDeviceCreate
                                    wire reports                       WriteFile(hid, report)
                                                                            |
 your app (Chrome/Electron)   <--- hidclass.sys <--- MsHidUmdf.sys <--- HidPosEmu.dll
 navigator.hid inputreport
```

Two things about this are easy to get wrong:

- **The control page never touches WebHID.** It is an ordinary WebSocket client. Only the app under
  test uses `navigator.hid`. A change to the page cannot break device enumeration, and a device problem
  cannot be diagnosed from the page.
- **The service, not the host, owns the device.** The host can restart, or not run at all, and the
  device stays plugged. The service is the only process with the privilege to create one.

## The device tree Windows builds

`SwDeviceCreate` makes one software devnode. Everything else is Windows reacting to the report
descriptor the service handed over as a device property.

```
SWD\HidPosEmu\newland                 the software device the service creates
  └─ HID\HidPosEmu\1&<hash>&0&0000    one child per top level collection, made by hidclass
       └─ \\?\hid#hidposemu#...       GUID_DEVINTERFACE_HID, what an application opens
```

The parent is driven by `HidPosEmu.dll`, our UMDF minidriver. hidclass sits above it, parses the
descriptor, and enumerates one child devnode per top level collection. That child is what publishes
the device interface, and it is what Chrome finds.

This split explains the failure mode that cost the most time: **the parent can be perfectly healthy
while the child fails to start**, and when the child fails there is no device interface at all, so
the device is simply invisible rather than broken-looking. Always check the child.

```powershell
Get-PnpDevice | Where-Object { $_.InstanceId -like '*HIDPOSEMU*' -and $_.Problem -ne 'CM_PROB_PHANTOM' } |
  Format-List InstanceId, FriendlyName, Status, Problem, Class
```

A healthy child reads `HID-compliant device` under class `HIDClass`. Anything else, start at the
Code 10 section of the runbook.

## The two IPC hops

**Page to host: WebSocket, JSON.** Message types are in `host/src/shared/uiProtocol.ts`: `ui-hello`,
`ui-plug`, `ui-unplug`, `ui-scan`, `ui-clear-log` in one direction, `ui-state`, `ui-scan-result`,
`ui-error` in the other. Any client can speak it, which is what makes headless verification possible.

**Host to service: named pipe `\\.\pipe\HidPosEmu`, JSON lines.** `host/src/server/serviceClient.ts` is the
client half. Only one process can own the pipe name, so a service left running in `--console` mode
blocks the real service from starting.

The pipe's DACL grants `GRGW` to Authenticated Users. A machine whose policy strips that, or a host
running under an account outside that group, cannot connect.

## Injection: how a report gets in

This is the part with no analogue in a real scanner, and it is worth understanding before touching
the driver.

The descriptor declares three reports: an **input** report, which is the scan the app reads; an
**output** report on a vendor usage page, which is the injection channel; and a two byte **feature**
report carrying driver status.

To emit a scan, the service writes the desired *input* report as the *body of an output* report. The
driver's `WriteReport` strips the output report's own id, then either completes a read that is
already pending or pushes the body into a ring buffer so a scan sent before the application opened
the device is not lost.

The consequence: `IOCTL_UMDF_HID_SET_OUTPUT_REPORT` deliberately returns `STATUS_NOT_SUPPORTED`.
There is exactly one writable path, `IOCTL_HID_WRITE_REPORT`, reached through `WriteFile`. If a
report ever arrives at the app with `reportId === 3`, the write went around `WriteReport`.

## Privilege model

| Action | Needs |
| ------ | ----- |
| Build, run the host, run the control page | nothing |
| Install the driver package and the service | administrator, once |
| Create or destroy a device (`SwDeviceCreate`) | administrator, which is why the service does it |
| `--selftest` | administrator, because it creates its own device |

The service runs as LocalSystem and starts automatically, so after installation a developer needs no
elevation for anything they do day to day.

## What ships

`installer\build.ps1` produces a self contained zip, and from the same files
`HidPosEmu-<version>-Setup.exe` (below). Nobody but the person building it needs the driver
toolchain, or Node.js:

```
Install.cmd  Uninstall.cmd  install.ps1  uninstall.ps1  README-install.md  HidPosEmu.cer
HidPosEmu.cmd  HidPosEmu.ico
driver\   HidPosEmu.dll  HidPosEmu.inf  hidposemu.cat
service\  HidPosEmuSvc.exe
host\     bin\server.mjs
          node\     node.exe  LICENSE.txt
          public\   index.html  favicon.svg  build\app.js  build\app.css
          node_modules\@zxing\library\umd\index.min.js
```

`host\node\node.exe` is the build machine's own Node.js, copied unchanged with its OpenJS
signature; `build.ps1` refuses anything older than 20 or not x64, because the bundle targets node20.

Setup.exe is an Inno Setup installer (`installer\HidPosEmu.iss`). It installs to
`%ProgramFiles%\HidPosEmu`, the folder `install.ps1` already puts the service in, and only places
the files, makes the shortcuts, registers the uninstaller and asks for the restart. The work is
still `install.ps1 -Setup` and `uninstall.ps1 -Setup`, run hidden in 64-bit PowerShell, with the
output in `install.log` and exit code 3010 for "restart required"; so a zip install and a Setup
install are the same install. Without Inno Setup on the build machine, `build.ps1` warns and makes
only the zip.

The server is bundled with esbuild into one ESM file, and the React control page into
`public\build\`. The server locates `public\` by walking up from itself (`src/server/paths.ts`),
which is why the same code works from `src/server/` in a checkout and from `bin\` in a release.
`install.ps1` uses only `certutil`, `pnputil` and `sc.exe`, all of which ship with Windows.

`Install.cmd` and `Uninstall.cmd` exist because Windows will not run a downloaded `.ps1` under its
default execution policy, and Windows 11's own "Run with PowerShell" does not bypass it. They start
the script with `-ExecutionPolicy Bypass`; the script then elevates itself, which is the single UAC
prompt, and keeps that elevated window open at the end. `HidPosEmu.cmd` is the launcher the Start
menu and desktop shortcuts point at: it runs `host\bin\server.mjs --open` on the bundled node.

## Source layout of the host

```
host/src/
  shared/   used by both sides: the UI protocol, profiles, presets, framing, descriptor, AIM table
  server/   the Node process: HTTP and WebSocket (index.ts), the pipe client, state, paths
  ui/       the React control page
    components/   one folder per section of the page: header, devices, scan, options, log, common
    hooks/        useEmulator (the WebSocket), useScan (the next scan), useImageDecoder (photos)
    utils/        barcode decoding, service status, formatting
    constants/    fault definitions, scan defaults
    styles/       the page stylesheet
```

The one rule the layout enforces: `server/` and `ui/` both import from `shared/`, never from each
other. The page takes its message types from `shared/uiProtocol.ts`, so a field renamed on one side
fails to compile on the other instead of breaking the page silently. The page has its own
`tsconfig.json` (DOM, JSX, the `@/` and `@shared/` aliases); the root one covers `server/`,
`shared/` and the tests.
