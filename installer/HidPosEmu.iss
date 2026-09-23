; HidPosEmu-<version>-Setup.exe: one file that installs the whole emulator, for people who only want
; to use it. build.ps1 compiles it with Inno Setup from the same out\package\ the zip is made of.
;
; Setup only places the files, makes the shortcuts, registers the uninstaller in Settings > Apps and
; asks for the restart. install.ps1 and uninstall.ps1 still do the actual work, run with -Setup, so
; installing from the zip and from Setup.exe end up as the same install.

#ifndef PackageDir
  #error Pass /DPackageDir=<out\package> (build.ps1 does)
#endif
#ifndef OutputDir
  #error Pass /DOutputDir=<out> (build.ps1 does)
#endif
#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
; Never change the AppId: it is how a newer Setup.exe finds the install it upgrades.
AppId={{3FBF84C3-86B6-4E6F-8446-0DB57D978714}
AppName=HID-POS emulator
AppVersion={#Version}
AppVerName=HID-POS emulator {#Version}
AppPublisher=HidPosEmu
; install.ps1 puts the service in %ProgramFiles%\HidPosEmu, so this has to be that folder and the
; user cannot pick another.
DefaultDirName={autopf}\HidPosEmu
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.22000
OutputDir={#OutputDir}
OutputBaseFilename=HidPosEmu-{#Version}-Setup
SetupIconFile={#PackageDir}\HidPosEmu.ico
UninstallDisplayIcon={app}\HidPosEmu.ico
UninstallDisplayName=HID-POS emulator
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; An emulator still running from an older install holds node.exe open; offer to close it.
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Everything but the zip's double-click scripts, which Setup replaces.
Source: "{#PackageDir}\*"; DestDir: "{app}"; Excludes: "\Install.cmd,\Uninstall.cmd"; Flags: recursesubdirs ignoreversion

[Icons]
; The same shortcuts install.ps1 makes for a zip install, owned here so the uninstaller removes them.
; Minimised: the page opens in its own window, and the console only has to be there to close.
Name: "{commonprograms}\HID-POS emulator"; Filename: "{app}\HidPosEmu.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\HidPosEmu.ico"; Comment: "Virtual HID-POS barcode scanner"; Flags: runminimized
Name: "{commondesktop}\HID-POS emulator"; Filename: "{app}\HidPosEmu.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\HidPosEmu.ico"; Comment: "Virtual HID-POS barcode scanner"; Flags: runminimized; Tasks: desktopicon

[Run]
; Through cmd.exe, and as the user who started Setup rather than as administrator.
Filename: "{cmd}"; Parameters: "/c ""{app}\HidPosEmu.cmd"""; WorkingDir: "{app}"; Description: "Start the HID-POS emulator"; Flags: postinstall nowait skipifsilent runasoriginaluser runminimized; Check: not NeedRestart

[UninstallDelete]
; install.ps1 adds files Setup did not place: the service binary it copies and install.log.
Type: filesandordirs; Name: "{app}"

[Code]
var
  IsRestartNeeded: Boolean;

function PowerShell(): String;
begin
  // The 64-bit one: Setup is a 32-bit process, and a 32-bit PowerShell would see Program Files (x86)
  // and no pnputil.
  Result := ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe');
end;

function RunScript(const Script: String): Integer;
begin
  if not Exec(PowerShell(), '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\' + Script) + '" -Setup',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Result) then
    Result := -1;
end;

function InitializeSetup(): Boolean;
var
  State: Cardinal;
begin
  Result := True;

  // Smart App Control refuses the self signed service. Say so before anything changes; turning it
  // off is the user's decision, and Windows cannot turn it back on without a reset.
  if RegQueryDWordValue(HKLM64, 'SYSTEM\CurrentControlSet\Control\CI\Policy', 'VerifiedAndReputablePolicyState', State) then
  begin
    if State = 1 then
    begin
      MsgBox('Smart App Control is on, and it blocks the emulator''s self signed service.' + #13#10#13#10 +
        'Turn it off in Windows Security > App & browser control > Smart App Control settings, then run Setup again. ' +
        'Windows cannot turn it back on without a reset, so decide with that in mind.', mbCriticalError, MB_OK);
      Result := False;
    end
    else if State = 2 then
      MsgBox('Smart App Control is in evaluation mode. If Windows later switches it on, the emulator''s service stops starting; ' +
        'turning it off in Windows Security avoids that.', mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Installing the driver and the service...';
    ExitCode := RunScript('install.ps1');

    // 3010 is Windows' own "succeeded, restart required": the first install on a machine.
    if ExitCode = 3010 then
      IsRestartNeeded := True
    else if ExitCode <> 0 then
      MsgBox('Installing the driver and the service failed (exit code ' + IntToStr(ExitCode) + ').' + #13#10#13#10 +
        'What went wrong is in ' + ExpandConstant('{app}\install.log') + '.', mbCriticalError, MB_OK);
  end;
end;

function NeedRestart(): Boolean;
begin
  Result := IsRestartNeeded;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // Before the files go: stop the emulator and the service, remove the driver and the certificate.
  if CurUninstallStep = usUninstall then
    RunScript('uninstall.ps1');
end;
