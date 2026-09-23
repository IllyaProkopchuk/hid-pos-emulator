//
// Opening the HID interface of a software device and talking to the HidPosEmu minidriver through
// it: writing output reports (the injection channel) and reading the status feature report.
//

#pragma once

#include <windows.h>

#include <cstdint>
#include <string>
#include <vector>

namespace hidposemu {

struct HidReportLayout
{
    size_t  inputReportByteLength = 0;
    size_t  outputReportByteLength = 0;
    size_t  featureReportByteLength = 0;
    uint8_t outputReportId = 0;
    uint8_t featureReportId = 0;
};

//
// The HID device interface lives on the collection child of the software device, not on the
// software device node itself, so the children of `deviceInstanceId` are walked as well.
//
bool FindHidInterfacePath(const std::wstring& deviceInstanceId,
                          std::wstring& interfacePath,
                          DWORD& win32Error);

//
// Opens the interface shared, so an application that already holds the device open is not
// disturbed. `desiredAccess` is deliberately explicit: hidclass starts its read pump for a handle
// that asks for GENERIC_READ, and such a handle would show up in the driver's pending read count
// as if it were an application reading the scanner. The service therefore opens with
// GENERIC_WRITE to inject and with 0 to poll the status report.
//
// `flagsAndAttributes` defaults to a synchronous handle, which is what the injection and status
// paths want. A caller that reads with an OVERLAPPED must pass FILE_FLAG_OVERLAPPED: on a
// synchronous handle ReadFile blocks inside the kernel until the report arrives and ignores the
// OVERLAPPED, so any timeout the caller layers on top is never reached.
//
HANDLE OpenHidInterface(const std::wstring& interfacePath,
                        DWORD desiredAccess,
                        DWORD& win32Error,
                        DWORD flagsAndAttributes = 0);

bool ReadReportLayout(HANDLE device, HidReportLayout& layout, DWORD& win32Error);

//
// Writes one output report. `report` is the input report to emit, verbatim; the driver strips the
// output report id and re-emits what is left.
//
bool WriteOutputReport(HANDLE device,
                       const HidReportLayout& layout,
                       const std::vector<uint8_t>& report,
                       DWORD& win32Error);

bool ReadStatusFeature(HANDLE device,
                       const HidReportLayout& layout,
                       uint8_t& pendingReadCount,
                       uint8_t& ringDepth,
                       DWORD& win32Error);

}  // namespace hidposemu
