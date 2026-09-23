//
// Service control manager plumbing. The same entry point runs the emulator as a service or, with
// --console, in the foreground for debugging.
//

#pragma once

#include <windows.h>

#define HIDPOSEMU_SERVICE_NAME L"HidPosEmuSvc"

namespace hidposemu {

//
// Starts the pipe server and the device manager, and blocks until the stop request arrives.
// `logToConsole` prints the same lines the service would otherwise keep to itself.
//
int RunEmulator(bool logToConsole);

//
// Hands the process to the SCM. Returns a process exit code.
//
int RunAsService();

//
// Signals a running RunEmulator to return; called from the SCM handler and from Ctrl+C.
//
void RequestStop();

//
// Plugs the newland profile, injects one report, reads it back through the HID interface and
// unplugs again. Returns 0 when the round trip produced the expected bytes.
//
int RunSelfTest();

}  // namespace hidposemu
