@echo off
rem Double-click to uninstall. See Install.cmd for why this wraps the .ps1.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"

if errorlevel 1 pause
