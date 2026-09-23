@echo off
rem Starts the emulator's host and opens its page in an app window. The shortcuts point here and
rem start this window minimised; closing it stops the emulator.
rem Arguments are passed to the host, so HidPosEmu.cmd --port 7500 works.
rem
rem The release carries its own node.exe in host\node\, so nothing else has to be installed.

title HID-POS emulator
cd /d "%~dp0"

"host\node\node.exe" host\bin\server.mjs --open %*

if errorlevel 1 pause
