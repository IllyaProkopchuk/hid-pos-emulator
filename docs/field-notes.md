# Field notes: the first Windows bring-up

What the machine actually taught us, on 2026-09-04, taking the project from never having been
compiled to a verified device on Windows 11 build 26200 with VS 2026 and WDK 10.0.28000.

This records what turned out to be true once the design met a real machine.

## Assumptions from the design, resolved

The design listed assumptions to verify during implementation. Their outcomes:

| Assumption | Outcome |
| ---------- | ------- |
| Chrome enumerates software created HID devices like real USB ones | **Holds.** Enumerating `GUID_DEVINTERFACE_HID` the way Chrome does returns the emulated device with the right vendor, product, serial and collection. Chrome's own picker was never exercised, for want of a click. |
| The descriptor as designed produces a working collection | **Failed as designed, fixed.** Usage `0x02` handed the collection to Microsoft's `hidscanner.inf`, which does not start on it. See below. |
| A UMDF driver needs no test signing and no Secure Boot change | **Holds.** Neither was ever touched. |
| Self signed is enough | **Holds, with one condition nobody anticipated:** Smart App Control must be off. |

## The two bugs that were not in the plan

**Code 10 on the child devnode.** The symptom was that the parent software device was healthy while
its child sat in `CM_PROB_FAILED_START` with `STATUS_DEVICE_POWER_FAILURE`, and no HID interface
appeared anywhere. Nothing in the event log; DebugView silent.

The cause was that Windows binds its own `hidscanner.inf` to any collection matching
`HID_DEVICE_UP:008C_U:0002`, and that driver will not start on this descriptor. It is Microsoft's
code failing, not ours, which is why there was nothing to find on our side.

One hypothesis was tested and **rejected** along the way, and is recorded so nobody spends the time
again: that `IOCTL_HID_ACTIVATE_DEVICE` returning `STATUS_NOT_IMPLEMENTED` was to blame. It was
changed to `STATUS_SUCCESS`, rebuilt, installed — and the problem status did not move by a single
bit. The change was kept because answering it is correct, but it fixes nothing.

The fix was to declare usage `0x03`, which no inbox INF claims. See `invariants.md`.

**The id-less write path.** `generic`, the only profile whose descriptor declares no report ids,
failed every scan with `win32 122`. The driver derives the report id from the *length* of the
request's output buffer, and id 0 arrives as a zero length buffer, which WDF reports as
`STATUS_BUFFER_TOO_SMALL`. The driver was treating that as an error. Because only one profile was
affected, it looked like a framing bug for some time.

Both are now covered in `invariants.md` with their symptoms.

## Toolchain facts for VS 2026 and WDK 28000

Four things in the build had to change for this pair, none of them the project's fault:

- `inf2cat.exe` ships **x86 only**, even in an x64 kit. A search restricted to `x64\` finds nothing.
- `InfVerif.dll` ships **x64 only**, so the build must run the 64 bit MSBuild. The 32 bit one fails
  with `Unable to load DLL 'x86\InfVerif.dll'`.
- The platform toolset is **v145**, not `v143`. The project now follows `$(DefaultPlatformToolset)`
  so it tracks whatever is installed.
- `KdPrint` compiles to nothing in Release, so a parameter used only for tracing trips
  `warning C4100` as an error. This also means **driver traces do not exist in a Release build**,
  which invalidates the runbook's older advice to read DebugView without qualification.

## Environment facts

- **Smart App Control** blocks a self signed binary outright, as a service and from a console alike:
  `An Application Control policy has blocked this file`, CodeIntegrity events 3033 and 3077. It
  cannot be re-enabled without resetting Windows, so this is a real decision for a developer machine.
- **A reboot is required after the first install on a machine.** Windows stages its own UMDF files
  for the HID stack and reports `ERROR_SUCCESS_REBOOT_REQUIRED` in `setupapi.dev.log`; until the
  reboot the device is created but cannot start.
- **Just after midnight the driver build failed with "DriverVer set to a date in the future".**
  stampinf dates the INF with the local date and inf2cat checks it against the UTC one, so east of
  UTC (Kyiv, UTC+2/+3) every build broke for the first hours of the day. `build.ps1` now passes the
  UTC date as `InfDateStamp`, which `driver\HidPosEmu.vcxproj` hands to stampinf.
- **The child devnode's instance id changes on every plug.** Anything bound to one instance does not
  survive a replug, which rules out Device Manager driver overrides as a diagnostic here.
- **`node_modules` has to be installed on the machine that uses it.** Carried over from elsewhere,
  the symlinks in `.bin` arrive as dead 20 byte text files and the platform specific esbuild binary
  is missing, so `yarn start` fails with `'tsx' is not recognized`.

## What was verified, and how

Verified headlessly, by enumerating the HID interface and reading reports from it in a separate
process: all three profiles produce healthy devnodes; `NLS-HR22` presents the right vendor, product,
serial and collection; single scans, the two report `ticketQrPin` split, and all three injected faults
produce exactly the bytes in `verification.md`; `--selftest` passes end to end.

Not verified, because both need a human: Chrome's device picker, and everything an app does with a
scan.

## Still open

- The release zip carries the host bundled, so installing needs only Node 20. Whether the control
  page should become a desktop window instead of a browser tab was discussed and deliberately left
  alone; the page uses no browser privileged API, so it is a presentation choice, not a rewrite.
- During one verification run every device unplugged itself while both the service and the host were
  alive and healthy. The cause was never established. If it recurs, that is a real bug worth chasing.
