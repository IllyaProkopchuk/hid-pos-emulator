# HidPosEmu, install on Windows 11

This package creates a virtual USB-HID barcode scanner on your machine. Chrome, Edge and Electron
apps see it through the native `navigator.hid`, exactly like a real Newland scanner. Nothing in the
app you test changes.

It comes two ways, which install exactly the same thing: **`HidPosEmu-<version>-Setup.exe`**, the
one to use, and **`HidPosEmu-<version>-x64.zip`**, the same files for when you want them in a
folder of your own. Use one or the other on a machine, not both.

## Before you start

- **Windows 11 x64**, and administrator rights for one UAC prompt.
- **Smart App Control off.** Check in Windows Security > App & browser control > Smart App Control
  settings. While it is on, Windows refuses to run the emulator's self signed service, and Setup
  stops and says so. Windows cannot turn it back on without a reset, so decide with that in mind.
- Nothing else. Node.js is built in; you do not need your own.

## Install with Setup.exe

1. Double-click `HidPosEmu-<version>-Setup.exe`. Windows does not know the publisher yet, so it
   shows "Windows protected your PC": choose **More info**, then **Run anyway**.
2. Approve the UAC prompt, then Next, Install. Setup puts everything in
   `C:\Program Files\HidPosEmu` and adds **HID-POS emulator** to the Start menu, and to the desktop
   if you keep that box ticked.
3. **Restart when Setup asks you to.** It does after the first install on a machine: until then the
   scanner is created but cannot start. Otherwise it offers to start the emulator right away.

To update, run a newer Setup.exe: it upgrades in place, and closes a running emulator first. To
uninstall, use Settings > Apps > Installed apps > **HID-POS emulator** > Uninstall.

## Install from the zip

1. **Unblock the zip:** right-click it, Properties, tick **Unblock**, OK. Otherwise Windows asks
   "Do you want to run this file?" in step 3 (then choose Run, or More info > Run anyway).
2. **Unzip it to a folder that stays**, for example `C:\Tools\HidPosEmu`. The shortcuts point
   into it.
3. **Double-click `Install.cmd`** and approve the UAC prompt. A window shows what it installs.
4. **Restart Windows if the installer asks you to**, for the same reason as above.

To update, unblock the new zip and unzip it over the same folder; when you are told the driver or
the service changed, double-click `Uninstall.cmd`, then `Install.cmd`. To uninstall, double-click
`Uninstall.cmd`; the folder you unzipped to is left for you to delete.

## Use

1. Start **HID-POS emulator** from the Start menu or the desktop. The page opens in its own window,
   and a minimised console window appears in the taskbar: that one is the emulator, and closing it
   stops it. Starting the shortcut again while it runs only opens another window.
2. The header should read **Service: connected, driver installed**.
3. Press **Plug in** on a profile, for example Newland NLS-HR22.
4. Connect the scanner in your app as you would a real one; in Chrome that is the device picker,
   `navigator.hid.requestDevice({ filters: [{ usagePage: 0x8c }] })`. Once the app has it open,
   the card shows **app reading**.
5. Type the text to scan, for example `221-3351-753`, and press **Scan** (or Ctrl+Enter): the app
   receives it. A photo of a barcode works too: drop it on the page or paste it.

Devices you plugged in stay plugged after the emulator stops, because they belong to the service;
unplug them on the page first if you want them gone.

Without the shortcut, from a normal PowerShell in the install folder (`C:\Program Files\HidPosEmu`
for Setup.exe, the folder you unzipped to otherwise):

```powershell
.\HidPosEmu.cmd                                        # what the shortcut runs
.\host\node\node.exe .\host\bin\server.mjs             # the host alone, then open http://localhost:7411
.\host\node\node.exe .\host\bin\server.mjs --port 7500 # non-default port
```

## When something is wrong

| You see | What it means |
| ------- | ------------- |
| Setup or the installer says Smart App Control is on | turn it off as above, then install again |
| Setup says installing the driver and the service failed | the reason is in `C:\Program Files\HidPosEmu\install.log` |
| **Service: disconnected** | the service is not running: `Get-Service HidPosEmuSvc`; start it or install again |
| **driver missing** | the driver package is not installed: install again |
| A yellow mark on the scanner in Device Manager | Windows was not restarted after the first install |
| "Windows protected your PC" or "Do you want to run this file?" | expected for a file from a download: More info > Run anyway, or Run |

To check the installation by hand, in an administrator PowerShell:

```powershell
Get-Service HidPosEmuSvc                                       # Running
pnputil /enum-drivers | Select-String HidPosEmu
& "$env:ProgramFiles\HidPosEmu\HidPosEmuSvc.exe" --selftest    # exits 0
```

`docs\windows-runbook.md` in the repository has the full acceptance checklist and a longer
troubleshooting section.
