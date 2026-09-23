#include <windows.h>

#include <cstdio>
#include <cstring>
#include <cwchar>

#include "service.h"

namespace {

bool HasArgument(int argc, wchar_t** argv, const wchar_t* name)
{
    for (int index = 1; index < argc; ++index) {
        if (::_wcsicmp(argv[index], name) == 0) {
            return true;
        }
    }

    return false;
}

}  // namespace

int wmain(int argc, wchar_t** argv)
{
    if (HasArgument(argc, argv, L"--help")) {
        ::printf("HidPosEmuSvc: virtual HID-POS scanner service\n"
                 "  (no arguments)  run under the service control manager\n"
                 "  --console       run in the foreground, Ctrl+C to stop\n"
                 "  --selftest      plug, inject one report, read it back, unplug\n");

        return 0;
    }

    if (HasArgument(argc, argv, L"--selftest")) {
        return hidposemu::RunSelfTest();
    }

    if (HasArgument(argc, argv, L"--console")) {
        return hidposemu::RunEmulator(true);
    }

    return hidposemu::RunAsService();
}
