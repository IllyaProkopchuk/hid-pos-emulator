<#
.SYNOPSIS
    Installs the HidPosEmu driver package, certificate and service. Double-click Install.cmd, which
    runs this script, and approve the single UAC prompt.

.DESCRIPTION
    Idempotent: running it again on a machine that already has the tool installed re-imports the
    same certificate (certutil replaces it), refreshes the driver package and restarts the
    service, without creating a second service or a duplicate certificate.

    Secure Boot stays on and test signing stays off: a UMDF driver needs no kernel signature, only
    a catalog signed by a certificate the machine trusts.
#>

[CmdletBinding()]
param(
    # Set when the script starts itself again elevated, so that window stays open to be read.
    [switch]$Elevated,
    # Set by HidPosEmu-Setup.exe, which has already copied this folder to its final place, owns the
    # shortcuts and the restart prompt, and runs this hidden: so no shortcuts, a log file instead of
    # a window, and exit code 3010 when Windows has to restart.
    [switch]$Setup
)

$ErrorActionPreference = 'Stop'

if ($Setup) {
    Start-Transcript -Path (Join-Path $PSScriptRoot 'install.log') -Force | Out-Null
}

# The elevated window is a new one that closes when the script ends, taking any error with it.
trap {
    Write-Host ''
    Write-Host "Install failed: $_" -ForegroundColor Red
    if ($Elevated) { Read-Host 'Press Enter to close' | Out-Null }
    if ($Setup) { Stop-Transcript | Out-Null }
    exit 1
}

# A 32-bit PowerShell sees Program Files (x86) and no pnputil, and would install into the wrong
# place. Setup.exe is a 32-bit process, which is how that could happen.
if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    throw 'Run this script from 64-bit PowerShell.'
}

$root = $PSScriptRoot
$driverInf = Join-Path $root 'driver\HidPosEmu.inf'
$serviceSource = Join-Path $root 'service'
$certificate = Join-Path $root 'HidPosEmu.cer'
$installDir = Join-Path $env:ProgramFiles 'HidPosEmu'
$serviceName = 'HidPosEmuSvc'
$serviceBinary = Join-Path $installDir 'HidPosEmuSvc.exe'
$shortcutName = 'HID-POS emulator'
$shortcutPaths = @(
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$shortcutName.lnk"),
    (Join-Path $env:PUBLIC "Desktop\$shortcutName.lnk")
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()

if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # Install.cmd and a plain double-click both start unelevated. Start again elevated, which is the
    # one UAC prompt, and let this window close.
    Start-Process powershell.exe -Verb RunAs `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    return
}

foreach ($path in @($driverInf, $certificate, $serviceSource)) {
    if (-not (Test-Path $path)) {
        throw "Missing from the package: $path"
    }
}

# 0. Smart App Control refuses to run a self signed binary at all, so the service would never start.
#    Turning it off is the user's decision and cannot be undone, so this only says so, before
#    anything on the machine has changed. 1 is on, 2 is evaluation, which may switch itself on later.
$smartAppControl = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' `
        -Name VerifiedAndReputablePolicyState -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState

if ($smartAppControl -eq 1) {
    throw 'Smart App Control is on, and it blocks the emulator''s self signed service. Turn it off in Windows Security > App & browser control > Smart App Control settings, then run the installer again. Windows cannot turn it back on without a reset, so decide with that in mind.'
}

if ($smartAppControl -eq 2) {
    Write-Warning 'Smart App Control is in evaluation mode. If Windows later switches it on, the emulator''s service stops starting; turning it off in Windows Security avoids that.'
}

# Files unzipped from a download carry the mark of the web, and Windows then warns before the
# launcher runs. The user has already chosen to install this package, so clear it once here.
Get-ChildItem -Path $root -Recurse -File | Unblock-File

# The first install on a machine needs a reboot before a device can start (see
# docs/field-notes.md). No driver package before this run is the closest sign of that.
$isFirstInstall = -not (& pnputil /enum-drivers | Select-String 'Original Name\s*:\s*HidPosEmu\.inf')

# 1. Test signing must stay off; this script never turns it on and refuses to run behind it,
#    because a machine in test signing mode would hide a broken signature.
$bootConfiguration = & bcdedit /enum '{current}'

if ($bootConfiguration -match 'testsigning\s+Yes') {
    throw 'Test signing is enabled on this machine. Turn it off (bcdedit /set testsigning off, then reboot) and run this script again.'
}

# 2. Certificate
Write-Host 'Importing the signing certificate'
& certutil -addstore -f Root $certificate | Out-Null
& certutil -addstore -f TrustedPublisher $certificate | Out-Null

# 3. Driver package
Write-Host 'Installing the driver package'
& pnputil /add-driver $driverInf /install

if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 259) {
    throw "pnputil failed with exit code $LASTEXITCODE. See docs\windows-runbook.md for what the codes mean."
}

# 4. Service
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($existing -and $existing.Status -ne 'Stopped') {
    Write-Host 'Stopping the running service'
    Stop-Service -Name $serviceName -Force
    $existing.WaitForStatus('Stopped', '00:00:30')
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -Path (Join-Path $serviceSource '*') -Destination $installDir -Recurse -Force

if (-not $existing) {
    Write-Host 'Creating the service'
    & sc.exe create $serviceName binPath= "`"$serviceBinary`"" start= auto DisplayName= "HID-POS Scanner Emulator" | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "sc create failed with exit code $LASTEXITCODE."
    }

    & sc.exe description $serviceName "Creates virtual HID-POS barcode scanners for local development." | Out-Null
}

Write-Host 'Starting the service'
Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus('Running', '00:00:30')

# 5. Report
$pipe = Test-Path '\\.\pipe\HidPosEmu'

Write-Host ''
Write-Host ('Service : {0}' -f (Get-Service -Name $serviceName).Status)
Write-Host ('Pipe    : {0}' -f $(if ($pipe) { '\\.\pipe\HidPosEmu' } else { 'not reachable yet, give it a second' }))
Write-Host ''
#
# 6. Shortcuts. A release built without -SkipHost carries the bundled host and a launcher for it,
#    which runs on Node alone; only a checkout needs yarn and the npm registry.
#
#    For all users, in the common Start menu and the public desktop: the account that approved the
#    UAC prompt may not be the one that uses the emulator. They point into this folder, so the
#    folder has to stay where it is; unzipping a newer release over it keeps them working.
#    Setup.exe makes the same shortcuts itself, so that its uninstaller removes them.
#
$launcher = Join-Path $root 'HidPosEmu.cmd'

if ($Setup) {
    Stop-Transcript | Out-Null
    exit $(if ($isFirstInstall) { 3010 } else { 0 })
}

if (Test-Path $launcher) {
    Write-Host 'Creating the Start menu and desktop shortcuts'

    $shell = New-Object -ComObject WScript.Shell

    foreach ($shortcutPath in $shortcutPaths) {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $launcher
        $shortcut.WorkingDirectory = $root
        $shortcut.IconLocation = (Join-Path $root 'HidPosEmu.ico') + ',0'
        $shortcut.Description = 'Virtual HID-POS barcode scanner'
        # Minimised: the page opens in its own window, and this one only has to be there to close.
        $shortcut.WindowStyle = 7
        $shortcut.Save()
    }

    $next = "start '$shortcutName' from the Start menu or the desktop."
} else {
    $next = 'cd host && yarn && yarn start, then open http://localhost:7411'
}

Write-Host ''

if ($isFirstInstall) {
    Write-Host 'This is the first install on this machine: restart Windows before the first use,' -ForegroundColor Yellow
    Write-Host 'or the scanner is created but cannot start.' -ForegroundColor Yellow
    Write-Host "After the restart: $next"

    if ($Elevated) {
        $answer = Read-Host 'Restart now? [y/N]'

        if ($answer -match '^(y|yes)$') {
            Restart-Computer
        }
    }
} else {
    Write-Host "Next: $next"

    if ($Elevated) {
        Read-Host 'Press Enter to close' | Out-Null
    }
}
