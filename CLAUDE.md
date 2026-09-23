# CLAUDE.md

Orientation for an agent working on this repository. Read this first, then the document that covers
what you are about to touch.

> **Continuing earlier work? Read `docs/handoff.md` next, if this machine has one.** It is
> gitignored: local notes on the current state, unfinished work, this machine's quirks and how its
> owner wants to work.

## What this is

A virtual HID-POS barcode scanner for Windows 11. It creates a real device node at the operating
system level, so the native `navigator.hid` in Chrome, Edge or an Electron app enumerates it as a
physical Newland NLS-HR22 and receives real `inputreport` events. The app under test is not
modified in any way; that is the whole point of the design.

**Windows 11 x64 is the only target.** macOS was evaluated and dropped, not deferred. The one place
another platform still matters is CI, which runs the host's tests on Linux because the host is the
only part that builds anywhere else.

Three components, in the order a scan travels through them:

| Component | Language | Runs as | Lives after install |
| --------- | -------- | ------- | ------------------- |
| `host/` | Node 20 + TypeScript | the developer | a checkout, or `host\bin\server.mjs` from the release |
| `service/` | C++17, Win32 | `HidPosEmuSvc`, LocalSystem | `%ProgramFiles%\HidPosEmu\` |
| `driver/` | C, UMDF 2 | WUDFHost, per device | the Windows driver store |

## Commands

```powershell
.\installer\build.ps1 -Version 1.0.0    # builds, signs, bundles host + node.exe, writes out\*.zip and *-Setup.exe
cd host; yarn; yarn test; yarn typecheck
cd host; yarn dev                        # page rebuild + server restart on save, refresh the browser
& "$env:ProgramFiles\HidPosEmu\HidPosEmuSvc.exe" --selftest   # needs administrator
```

Installing needs one UAC approval (`Install.cmd` in the zip, or `.\install.ps1` in an elevated shell,
which also elevates itself) and `uninstall` before `install` whenever the driver was rebuilt. The full sequence is in [`docs/windows-runbook.md`](docs/windows-runbook.md).

## Where a change goes

Almost every change to what the emulator *does* is TypeScript. The driver and the service know
nothing about Newland, profiles or barcodes: they take a descriptor and bytes from the host and pass
them through. Neither hardcodes a vendor id, product id or preset outside `service/selftest.cpp`.

| To change | Edit | Native code? |
| --------- | ---- | ------------ |
| a scanner model: vendor id, product id, names, serial | `host/src/shared/profiles.ts` | no |
| a scan preset | `host/src/shared/presets.ts` | no |
| an injected fault | `host/src/shared/framing.ts` | no |
| the wire format: length byte, terminator, AIM prefix, splitting into reports | `host/src/shared/framing.ts`, `host/src/shared/aim.ts` | no |
| the HID report descriptor | `host/src/shared/descriptor.ts`, then `host/test/descriptor.test.ts` | only `service/selftest.cpp`, which keeps its own copy |
| the control page | `host/src/ui/` (React 18 + TSX, built into `host/public/build/` by `yarn build:ui`) | no |
| the page to host messages | `host/src/shared/uiProtocol.ts`, `host/src/server/index.ts` | no |
| the host to service messages | `host/src/server/serviceClient.ts` | yes, `service/protocol.cpp` parses them |
| how a device is created, destroyed or written to | `service/swdevice.cpp`, `service/hid.cpp` | yes, C++ |
| how the device answers Windows: a new IOCTL, a new report type, a second collection | `driver/hidposemu.c` | yes, C |
| build, signing, packaging | `installer/build.ps1` | no, PowerShell |
| install and uninstall | `installer/install.ps1`, `installer/uninstall.ps1` | no, PowerShell |
| Setup.exe: what it installs, its wizard, uninstall entry, restart | `installer/HidPosEmu.iss` (Inno Setup; the work stays in `install.ps1 -Setup`) | no |
| the release launcher, its shortcuts and icon | `installer/HidPosEmu.cmd`, `installer/install.ps1`, `installer/make-icon.ps1`; `--open` in `host/src/server/appWindow.ts` | no |

A change that lands in the last native rows is a change to the Windows side of the device, and it
comes with its own hazards: read the matching entries in `docs/invariants.md` first, and plan to
verify it on a real machine with `docs/verification.md`, because unit tests do not reach it.

If you change the descriptor, update `service/selftest.cpp` to match, or `--selftest` exercises a
device that no profile produces.

## Before you change anything

**Read [`docs/invariants.md`](docs/invariants.md).** Several values in this codebase look arbitrary
and are not: the HID usage, the length byte, the report ids, the handle flags on the read path. Each
one has already cost a debugging session, and each is load bearing in a way that unit tests do not
catch, because the failure surfaces in the Windows PnP stack rather than in the code.

The two rules that matter most:

- **The wire format is decided in `host/src/shared/framing.ts` and `host/test/framing.test.ts`.** Those two
  files are the authority for what a report looks like. The first design was wrong about the length
  byte; the tests were right.
- **The report descriptor's bytes are pinned in `host/test/descriptor.test.ts`.** hidclass derives
  the collections from them and apps key a device on those collections, so changing them is a
  change an app reading the scanner can see.

## Where to look

| Question | Document |
| -------- | -------- |
| How the pieces fit at the OS level | [`docs/architecture.md`](docs/architecture.md) |
| What must not change, and why | [`docs/invariants.md`](docs/invariants.md) |
| How to prove it works without a browser | [`docs/verification.md`](docs/verification.md) |
| What the first Windows bring-up established | [`docs/field-notes.md`](docs/field-notes.md) |
| Where the last session stopped | `docs/handoff.md`, local and gitignored |
| Build, install, acceptance criteria, troubleshooting | [`docs/windows-runbook.md`](docs/windows-runbook.md) |
| Step by step setup, in Ukrainian | [`docs/windows-setup.md`](docs/windows-setup.md) |

## Working conditions on Windows

These are environment facts, not preferences. Ignoring them wastes a session:

- **Smart App Control must be off.** It refuses to run a self signed binary at all, so the service
  will not start and `--selftest` will not run either. Turning it off cannot be undone without
  resetting Windows.
- **Driver traces are invisible in a Release build.** `KdPrint` compiles to nothing, so an empty
  DebugView proves nothing. Rebuild with `-Configuration Debug` before drawing conclusions.
- **`$ErrorActionPreference = 'Stop'` turns any stderr from a native command into a terminating
  error.** esbuild reports a clean build on stderr, which is why `build.ps1` runs it with
  `--log-level=error` and judges it by its exit code.
- **The child devnode is ephemeral.** Its instance id changes on every plug, so anything you attach
  to one instance does not survive a replug, and a failure is gone by the time you go looking unless
  the device is still plugged in.

## Testing

`yarn test` runs 25 tests over the framing, the descriptor, the AIM prefixes and the service client.
They cover the parts that can be tested without Windows, which is why CI (`.github/workflows/host.yml`)
runs only them, on Linux. Everything below the host has to be exercised on a real machine; see
`docs/verification.md` for how to do that without a browser in the loop.

The test script lists its files explicitly rather than using a glob, because `cmd` does not expand
globs and Node 20 does not expand them either. Add new test files to that list.
