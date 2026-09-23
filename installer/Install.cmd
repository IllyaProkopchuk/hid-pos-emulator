@echo off
rem Double-click to install. Windows does not run a downloaded .ps1 under its default execution
rem policy, and its own "Run with PowerShell" does not get past that, so this runs install.ps1 with
rem the policy bypassed for that one process. The script asks for administrator rights itself.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

if errorlevel 1 pause
