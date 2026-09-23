<#
.SYNOPSIS
    Removes the HidPosEmu service, driver package, certificates and shortcuts. Double-click
    Uninstall.cmd, which runs this script, and approve the single UAC prompt.
#>

[CmdletBinding()]
param(
    # Set when the script starts itself again elevated, so that window stays open to be read.
    [switch]$Elevated,
    # Set by the Setup.exe uninstaller, which deletes its own folder afterwards and must still be
    # in it when this script ends.
    [switch]$Setup
)

$ErrorActionPreference = 'Stop'

# The elevated window is a new one that closes when the script ends, taking any error with it.
trap {
    Write-Host ''
    Write-Host "Uninstall failed: $_" -ForegroundColor Red
    if ($Elevated) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

# See install.ps1: a 32-bit PowerShell sees the wrong Program Files and no pnputil.
if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    throw 'Run this script from 64-bit PowerShell.'
}

$serviceName = 'HidPosEmuSvc'
$installDir = Join-Path $env:ProgramFiles 'HidPosEmu'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()

if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # Uninstall.cmd and a plain double-click both start unelevated. Start again elevated, which is
    # the one UAC prompt, and let this window close.
    Start-Process powershell.exe -Verb RunAs `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    return
}

# Installed by Setup.exe: hand over to its uninstaller, which runs this script with -Setup and also
# removes its entry in Settings > Apps. Deleting its folder from here would orphan that entry.
$setupUninstaller = Join-Path $installDir 'unins000.exe'

if (-not $Setup -and (Test-Path $setupUninstaller)) {
    Write-Host 'This machine has the emulator from HidPosEmu-Setup.exe; starting its uninstaller'
    Start-Process $setupUninstaller
    return
}

# 0. The emulator itself, if it runs from the install folder, which only a Setup.exe install does:
#    its node.exe would stay locked and could not be deleted.
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($installDir + '\', [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# 1. Service. Stopping it closes every software device, so no SWD\HidPosEmu devnode is left behind.
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($existing) {
    Write-Host 'Removing the service'

    if ($existing.Status -ne 'Stopped') {
        Stop-Service -Name $serviceName -Force
        $existing.WaitForStatus('Stopped', '00:00:30')
    }

    & sc.exe delete $serviceName | Out-Null
}

if (-not $Setup) {
    Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
}

# 2. Driver package. pnputil publishes the INF as oemNN.inf, so the original name has to be looked
#    up in the enumeration.
$enumerated = & pnputil /enum-drivers
$publishedName = $null

for ($index = 0; $index -lt $enumerated.Count; $index++) {
    if ($enumerated[$index] -match 'Published Name\s*:\s*(oem\d+\.inf)') {
        $candidate = $Matches[1]
    }

    if ($enumerated[$index] -match 'Original Name\s*:\s*HidPosEmu\.inf') {
        $publishedName = $candidate
        break
    }
}

if ($publishedName) {
    Write-Host "Removing the driver package ($publishedName)"
    & pnputil /delete-driver $publishedName /uninstall /force

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "pnputil returned exit code $LASTEXITCODE."
    }
}
else {
    Write-Host 'No HidPosEmu driver package is installed'
}

# 3. Certificates
Write-Host 'Removing the signing certificate'
& certutil -delstore Root 'HidPosEmu Dev Signing' | Out-Null
& certutil -delstore TrustedPublisher 'HidPosEmu Dev Signing' | Out-Null

# 4. Shortcuts that install.ps1 created. The unzipped folder they pointed into is left alone.
$shortcutName = 'HID-POS emulator'

foreach ($shortcutPath in @(
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$shortcutName.lnk"),
        (Join-Path $env:PUBLIC "Desktop\$shortcutName.lnk"))) {
    if (Test-Path $shortcutPath) {
        Write-Host "Removing $shortcutPath"
        Remove-Item $shortcutPath -Force
    }
}

Write-Host ''
Write-Host 'Done. The folder you unzipped to is left for you to delete.'
Write-Host 'Check: Get-Service HidPosEmuSvc, pnputil /enum-drivers, pnputil /enum-devices /class HIDClass'

if ($Elevated) {
    Read-Host 'Press Enter to close' | Out-Null
}
