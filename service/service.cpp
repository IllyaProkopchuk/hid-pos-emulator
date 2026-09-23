#include "service.h"

#include <cstdio>
#include <memory>
#include <string>

#include "pipe.h"
#include "protocol.h"
#include "swdevice.h"

namespace hidposemu {

namespace {

SERVICE_STATUS_HANDLE   g_statusHandle = nullptr;
SERVICE_STATUS          g_status = {};
HANDLE                  g_stopEvent = nullptr;
bool                    g_logToConsole = false;

void Log(const char* message)
{
    if (g_logToConsole) {
        ::printf("%s\n", message);
        ::fflush(stdout);
    }
}

void SetServiceStatus(DWORD currentState, DWORD win32ExitCode, DWORD waitHintMs)
{
    if (g_statusHandle == nullptr) {
        return;
    }

    g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    g_status.dwCurrentState = currentState;
    g_status.dwWin32ExitCode = win32ExitCode;
    g_status.dwWaitHint = waitHintMs;
    g_status.dwControlsAccepted =
        (currentState == SERVICE_RUNNING) ? (SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN) : 0;
    g_status.dwCheckPoint =
        (currentState == SERVICE_RUNNING || currentState == SERVICE_STOPPED)
            ? 0
            : g_status.dwCheckPoint + 1;

    ::SetServiceStatus(g_statusHandle, &g_status);
}

DWORD WINAPI HandlerEx(DWORD control, DWORD eventType, LPVOID eventData, LPVOID context)
{
    UNREFERENCED_PARAMETER(eventType);
    UNREFERENCED_PARAMETER(eventData);
    UNREFERENCED_PARAMETER(context);

    switch (control) {
    case SERVICE_CONTROL_STOP:
    case SERVICE_CONTROL_SHUTDOWN:
        SetServiceStatus(SERVICE_STOP_PENDING, NO_ERROR, 5000);
        RequestStop();
        return NO_ERROR;

    case SERVICE_CONTROL_INTERROGATE:
        return NO_ERROR;

    default:
        return ERROR_CALL_NOT_IMPLEMENTED;
    }
}

VOID WINAPI ServiceMain(DWORD argc, LPWSTR* argv)
{
    UNREFERENCED_PARAMETER(argc);
    UNREFERENCED_PARAMETER(argv);

    g_statusHandle = ::RegisterServiceCtrlHandlerExW(HIDPOSEMU_SERVICE_NAME, HandlerEx, nullptr);

    if (g_statusHandle == nullptr) {
        return;
    }

    SetServiceStatus(SERVICE_START_PENDING, NO_ERROR, 5000);

    const int exitCode = RunEmulator(false);

    g_status.dwServiceSpecificExitCode = static_cast<DWORD>(exitCode);
    SetServiceStatus(SERVICE_STOPPED, (exitCode == 0) ? NO_ERROR : ERROR_SERVICE_SPECIFIC_ERROR, 0);
}

BOOL WINAPI ConsoleHandler(DWORD control)
{
    if (control == CTRL_C_EVENT || control == CTRL_BREAK_EVENT || control == CTRL_CLOSE_EVENT) {
        RequestStop();
        return TRUE;
    }

    return FALSE;
}

}  // namespace

void RequestStop()
{
    if (g_stopEvent != nullptr) {
        ::SetEvent(g_stopEvent);
    }
}

int RunEmulator(bool logToConsole)
{
    g_logToConsole = logToConsole;
    g_stopEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

    if (g_stopEvent == nullptr) {
        return 1;
    }

    if (logToConsole) {
        ::SetConsoleCtrlHandler(ConsoleHandler, TRUE);
    }

    std::unique_ptr<PipeServer> pipeServer;
    DeviceManager deviceManager([&pipeServer](const std::string& line) {
        if (pipeServer != nullptr) {
            pipeServer->Broadcast(line);
        }
    });

    pipeServer = std::make_unique<PipeServer>(
        [&deviceManager](const std::string& line) { return deviceManager.HandleRequestLine(line); },
        []() { return MakeHelloEvent(IsDriverInstalled()); });

    std::string errorMessage;
    DWORD win32Error = ERROR_SUCCESS;

    if (!pipeServer->Start(errorMessage, win32Error)) {
        Log(errorMessage.c_str());
        ::CloseHandle(g_stopEvent);
        g_stopEvent = nullptr;
        return 1;
    }

    Log("HidPosEmuSvc listening on \\\\.\\pipe\\HidPosEmu");
    SetServiceStatus(SERVICE_RUNNING, NO_ERROR, 0);

    ::WaitForSingleObject(g_stopEvent, INFINITE);

    Log("HidPosEmuSvc stopping");
    pipeServer->Stop();
    deviceManager.UnplugAll();

    ::CloseHandle(g_stopEvent);
    g_stopEvent = nullptr;

    return 0;
}

int RunAsService()
{
    SERVICE_TABLE_ENTRYW table[] = {
        { const_cast<LPWSTR>(HIDPOSEMU_SERVICE_NAME), ServiceMain },
        { nullptr, nullptr },
    };

    if (!::StartServiceCtrlDispatcherW(table)) {
        return static_cast<int>(::GetLastError());
    }

    return 0;
}

}  // namespace hidposemu
