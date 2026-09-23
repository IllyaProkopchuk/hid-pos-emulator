<#
.SYNOPSIS
    Builds, signs and packages the HidPosEmu driver and service. Run once per release on a machine
    with Visual Studio 2026 and a matching SDK + WDK pair (10.0.28000.x; VS 2022 pairs with
    10.0.26100.6584).

.DESCRIPTION
    Produces out\HidPosEmu-<version>-x64.zip containing the driver package, the service binary, the
    signing certificate and the install scripts. Developers install that zip; they do not build.

    The certificate is self signed and lives in installer\HidPosEmu.pfx, which is gitignored. Keep
    it: replacing it means every machine has to re-import the new certificate.
#>

[CmdletBinding()]
param(
    [string]$Version = '1.0.0',
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',
    # Builds a driver-only zip. Useful on a machine that cannot reach the npm registry, but the
    # people who install that zip then need yarn and the registry themselves.
    [switch]$SkipHost
)

$ErrorActionPreference = 'Stop'

$installerDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $installerDir
$outDir = Join-Path $repoRoot 'out'
# The payload is assembled in its own directory so that the zip, which lands in out\, is never
# inside the tree it archives.
$packageDir = Join-Path $outDir 'package'
$driverOut = Join-Path $packageDir 'driver'
$serviceOut = Join-Path $packageDir 'service'
$hostDir = Join-Path $repoRoot 'host'
# The bundle lands in host\bin\server.mjs, beside public\ and node_modules\ in host\. The server
# finds that host directory by walking up from itself (src/server/paths.ts), so the depth of the
# bundle does not matter; host\ being its ancestor does.
$hostOut = Join-Path $packageDir 'host'
$pfxPath = Join-Path $installerDir 'HidPosEmu.pfx'
$cerPath = Join-Path $installerDir 'HidPosEmu.cer'
$pfxPassword = 'HidPosEmu'

function Find-VisualStudioTool {
    param([string]$RelativePath)

    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'

    if (-not (Test-Path $vswhere)) {
        throw 'vswhere.exe not found. Install Visual Studio 2026 (Build Tools is enough) with the Desktop development with C++ workload.'
    }

    $installPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath

    if (-not $installPath) {
        throw 'No Visual Studio installation with MSBuild was found.'
    }

    $tool = Join-Path $installPath $RelativePath

    if (-not (Test-Path $tool)) {
        throw "Expected tool not found: $tool"
    }

    return $tool
}

function Find-KitTool {
    param([string]$Name)

    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'),
        (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin\x64')
    )

    foreach ($root in $roots) {
        if (-not (Test-Path $root)) {
            continue
        }

        $candidates = Get-ChildItem -Path $root -Filter $Name -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' -or $_.FullName -match '\\x86\\' -or $_.DirectoryName -eq $root }

        $found = $candidates | Where-Object { $_.FullName -match '\\x64\\' -or $_.DirectoryName -eq $root } |
            Sort-Object FullName -Descending | Select-Object -First 1

        if (-not $found) {
            # inf2cat.exe and a few other kit tools ship x86-only even in x64 kits.
            $found = $candidates | Where-Object { $_.FullName -match '\\x86\\' } |
                Sort-Object FullName -Descending | Select-Object -First 1
        }

        if ($found) {
            return $found.FullName
        }
    }

    throw "$Name not found. Install the Windows SDK and the Windows Driver Kit with matching build numbers."
}

Write-Host '== HidPosEmu build =='

$msbuild = Find-VisualStudioTool 'MSBuild\Current\Bin\amd64\MSBuild.exe'
$inf2cat = Find-KitTool 'inf2cat.exe'
$signtool = Find-KitTool 'signtool.exe'

# 1. Signing certificate
if (-not (Test-Path $pfxPath)) {
    Write-Host 'Creating a self signed code signing certificate'

    $certificate = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject 'CN=HidPosEmu Dev Signing' `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -NotAfter (Get-Date).AddYears(5)

    $securePassword = ConvertTo-SecureString -String $pfxPassword -Force -AsPlainText

    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
    Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
}
elseif (-not (Test-Path $cerPath)) {
    throw "HidPosEmu.pfx exists but HidPosEmu.cer does not. Delete the .pfx to create a new pair, or restore the .cer."
}

# 2. Driver
Write-Host 'Building the driver'
# DriverVer is dated in UTC, because inf2cat rejects a date later than today in UTC and stampinf
# would otherwise use the local one (see driver\HidPosEmu.vcxproj).
$infDate = [DateTime]::UtcNow.ToString('MM/dd/yyyy', [Globalization.CultureInfo]::InvariantCulture)

& $msbuild (Join-Path $repoRoot 'driver\HidPosEmu.sln') /nologo /verbosity:minimal `
    "/p:Configuration=$Configuration" /p:Platform=x64 "/p:InfDateStamp=$infDate"

if ($LASTEXITCODE -ne 0) { throw 'The driver build failed.' }

# 3. Service
Write-Host 'Building the service'
& $msbuild (Join-Path $repoRoot 'service\HidPosEmuSvc.sln') /nologo /verbosity:minimal `
    "/p:Configuration=$Configuration" /p:Platform=x64

if ($LASTEXITCODE -ne 0) { throw 'The service build failed.' }

# 4. Collect, catalog and sign
Remove-Item -Path $packageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $driverOut, $serviceOut -Force | Out-Null

$driverBuildDir = Join-Path $repoRoot "driver\x64\$Configuration"
$serviceBuildDir = Join-Path $repoRoot "service\x64\$Configuration"

Copy-Item (Join-Path $driverBuildDir 'HidPosEmu.dll') $driverOut
Copy-Item (Join-Path $driverBuildDir 'HidPosEmu.inf') $driverOut
Copy-Item (Join-Path $serviceBuildDir 'HidPosEmuSvc.exe') $serviceOut

Write-Host 'Creating the catalog'
& $inf2cat /driver:$driverOut /os:10_X64

if ($LASTEXITCODE -ne 0) { throw 'inf2cat failed.' }

Write-Host 'Signing'
& $signtool sign /fd SHA256 /f $pfxPath /p $pfxPassword `
    (Join-Path $driverOut 'HidPosEmu.cat') `
    (Join-Path $driverOut 'HidPosEmu.dll') `
    (Join-Path $serviceOut 'HidPosEmuSvc.exe')

if ($LASTEXITCODE -ne 0) { throw 'signtool failed.' }

# 5. Bundle the host, so installing the release needs neither yarn nor the npm registry
if (-not $SkipHost) {
    $esbuild = Join-Path $hostDir 'node_modules\esbuild\bin\esbuild'

    if (-not (Test-Path $esbuild)) {
        throw 'esbuild not found. Run yarn in host\ first, or pass -SkipHost for a driver-only zip.'
    }

    Write-Host 'Bundling the host'

    $zxingUmd = Join-Path $hostDir 'node_modules\@zxing\library\umd\index.min.js'
    $zxingOut = Join-Path $hostOut 'node_modules\@zxing\library\umd'

    New-Item -ItemType Directory -Path (Join-Path $hostOut 'bin'), $zxingOut -Force | Out-Null

    #
    # ESM output, because src/server/paths.ts reads import.meta.url. ws is CommonJS, and esbuild's ESM output
    # otherwise stubs a require() that throws on ws's first `require('events')`, so the banner hands
    # it a real one.
    #
    $banner = "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

    Push-Location $hostDir

    #
    # esbuild reports even a clean build on stderr, and $ErrorActionPreference = 'Stop' turns any
    # stderr from a native command into a terminating error. Quiet it down and judge the run by its
    # exit code instead.
    #
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    & node $esbuild 'src/server/index.ts' --bundle --platform=node --target=node20 --format=esm `
        --log-level=error "--outfile=$(Join-Path $hostOut 'bin\server.mjs')" $banner

    $bundleExitCode = $LASTEXITCODE

    #
    # The control page is React source in src/ui/, built into public\build\ so that the copy of public\
    # below carries it. The same command as `yarn build:ui`; minified, which is also what makes
    # esbuild define process.env.NODE_ENV as production and so drops React's development checks.
    #
    $pageExitCode = 0

    if ($bundleExitCode -eq 0) {
        & node $esbuild 'src/ui/index.tsx' --bundle --minify --sourcemap --format=esm --target=es2022 `
            --log-level=error '--outfile=public/build/app.js'

        $pageExitCode = $LASTEXITCODE
    }

    $ErrorActionPreference = $previousPreference

    Pop-Location

    if ($bundleExitCode -ne 0) { throw 'The host bundle failed.' }
    if ($pageExitCode -ne 0) { throw 'The control page bundle failed.' }

    Copy-Item (Join-Path $hostDir 'public') $hostOut -Recurse -Force
    Copy-Item $zxingUmd $zxingOut -Force

    #
    # Node itself, so that nobody who installs the release needs Node.js. The one this machine runs,
    # copied as is, which keeps the OpenJS Foundation's signature on it. It has to be what the
    # bundle was built for (--target=node20) and match the x64 release.
    #
    $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $nodeVersion = & $nodeExe -p 'process.versions.node'
    $nodeArch = & $nodeExe -p 'process.arch'

    if ([int]($nodeVersion -split '\.')[0] -lt 20 -or $nodeArch -ne 'x64') {
        throw "The release bundles this machine's Node.js, which has to be version 20 or newer and x64; found $nodeVersion $nodeArch."
    }

    Write-Host "Bundling Node.js $nodeVersion"

    $nodeOut = Join-Path $hostOut 'node'

    New-Item -ItemType Directory -Path $nodeOut -Force | Out-Null
    Copy-Item $nodeExe $nodeOut -Force
    Copy-Item (Join-Path $installerDir 'node-LICENSE.txt') (Join-Path $nodeOut 'LICENSE.txt') -Force

    # The launcher the Start menu and desktop shortcuts point at, and their icon. Only with a
    # bundled host, because that is what the launcher starts.
    Copy-Item (Join-Path $installerDir 'HidPosEmu.cmd') $packageDir
    & (Join-Path $installerDir 'make-icon.ps1') -Path (Join-Path $packageDir 'HidPosEmu.ico')
}

# 6. Package
Copy-Item $cerPath $packageDir
Copy-Item (Join-Path $installerDir 'install.ps1') $packageDir
Copy-Item (Join-Path $installerDir 'uninstall.ps1') $packageDir
Copy-Item (Join-Path $installerDir 'Install.cmd') $packageDir
Copy-Item (Join-Path $installerDir 'Uninstall.cmd') $packageDir
Copy-Item (Join-Path $installerDir 'README-install.md') $packageDir

$zipPath = Join-Path $outDir "HidPosEmu-$Version-x64.zip"

Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $zipPath -Force

Write-Host "Done: $zipPath"

# 7. Setup.exe, the one-file install for people who only use the emulator. Made from the same
#    package as the zip by Inno Setup; without Inno Setup the zip is still the whole release.
if (-not $SkipHost) {
    $iscc = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $iscc) {
        Write-Warning 'Inno Setup 6 not found, so no Setup.exe this time. Install it with: winget install JRSoftware.InnoSetup'
    }
    else {
        Write-Host 'Building Setup.exe'

        & $iscc /Q "/DVersion=$Version" "/DPackageDir=$packageDir" "/DOutputDir=$outDir" `
            (Join-Path $installerDir 'HidPosEmu.iss')

        if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed.' }

        $setupPath = Join-Path $outDir "HidPosEmu-$Version-Setup.exe"

        & $signtool sign /fd SHA256 /f $pfxPath /p $pfxPassword $setupPath

        if ($LASTEXITCODE -ne 0) { throw 'signtool failed on Setup.exe.' }

        Write-Host "Done: $setupPath"
    }
}
