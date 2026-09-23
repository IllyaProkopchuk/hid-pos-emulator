#include "hid.h"

#include <initguid.h>

#include <cfgmgr32.h>
#include <hidsdi.h>
#include <hidclass.h>

#include <cstring>
#include <memory>

namespace hidposemu {

namespace {

struct PreparsedDataDeleter
{
    void operator()(PHIDP_PREPARSED_DATA data) const
    {
        ::HidD_FreePreparsedData(data);
    }
};

using PreparsedData = std::unique_ptr<_HIDP_PREPARSED_DATA, PreparsedDataDeleter>;

//
// CM_Get_Device_Interface_ListW returns a REG_MULTI_SZ; only the first interface is of interest,
// a HidPosEmu device declares exactly one collection.
//
bool GetFirstInterfaceOfDevice(const std::wstring& deviceInstanceId,
                               std::wstring& interfacePath,
                               DWORD& win32Error)
{
    ULONG   length = 0;
    CONFIGRET result = ::CM_Get_Device_Interface_List_SizeW(&length,
                            const_cast<LPGUID>(&GUID_DEVINTERFACE_HID),
                            const_cast<DEVINSTID_W>(deviceInstanceId.c_str()),
                            CM_GET_DEVICE_INTERFACE_LIST_PRESENT);

    if (result != CR_SUCCESS || length <= 1) {
        win32Error = ::CM_MapCrToWin32Err(result, ERROR_NOT_FOUND);
        return false;
    }

    std::vector<wchar_t> buffer(length, L'\0');

    result = ::CM_Get_Device_Interface_ListW(const_cast<LPGUID>(&GUID_DEVINTERFACE_HID),
                            const_cast<DEVINSTID_W>(deviceInstanceId.c_str()),
                            buffer.data(),
                            length,
                            CM_GET_DEVICE_INTERFACE_LIST_PRESENT);

    if (result != CR_SUCCESS || buffer[0] == L'\0') {
        win32Error = ::CM_MapCrToWin32Err(result, ERROR_NOT_FOUND);
        return false;
    }

    interfacePath.assign(buffer.data());

    return true;
}

bool GetDeviceInstanceId(DEVINST devInst, std::wstring& instanceId)
{
    wchar_t buffer[MAX_DEVICE_ID_LEN] = { 0 };

    if (::CM_Get_Device_IDW(devInst, buffer, ARRAYSIZE(buffer), 0) != CR_SUCCESS) {
        return false;
    }

    instanceId.assign(buffer);

    return true;
}

uint8_t FirstReportId(PHIDP_PREPARSED_DATA preparsedData, HIDP_REPORT_TYPE reportType, USHORT capsCount)
{
    if (capsCount == 0) {
        return 0;
    }

    std::vector<HIDP_VALUE_CAPS> caps(capsCount);
    USHORT count = capsCount;

    if (::HidP_GetValueCaps(reportType, caps.data(), &count, preparsedData) != HIDP_STATUS_SUCCESS ||
        count == 0) {
        return 0;
    }

    return caps[0].ReportID;
}

}  // namespace

bool FindHidInterfacePath(const std::wstring& deviceInstanceId,
                          std::wstring& interfacePath,
                          DWORD& win32Error)
{
    DEVINST devInst = 0;

    win32Error = ERROR_SUCCESS;

    const CONFIGRET located = ::CM_Locate_DevNodeW(&devInst,
                            const_cast<DEVINSTID_W>(deviceInstanceId.c_str()),
                            CM_LOCATE_DEVNODE_NORMAL);

    if (located != CR_SUCCESS) {
        win32Error = ::CM_MapCrToWin32Err(located, ERROR_NOT_FOUND);
        return false;
    }

    if (GetFirstInterfaceOfDevice(deviceInstanceId, interfacePath, win32Error)) {
        return true;
    }

    //
    // hidclass exposes the HID interface on a collection child of the minidriver's device node,
    // so the interface normally sits one level below the software device.
    //
    DEVINST child = 0;

    if (::CM_Get_Child(&child, devInst, 0) != CR_SUCCESS) {
        win32Error = ERROR_NOT_FOUND;
        return false;
    }

    for (;;) {
        std::wstring childInstanceId;

        if (GetDeviceInstanceId(child, childInstanceId) &&
            GetFirstInterfaceOfDevice(childInstanceId, interfacePath, win32Error)) {
            return true;
        }

        DEVINST sibling = 0;

        if (::CM_Get_Sibling(&sibling, child, 0) != CR_SUCCESS) {
            break;
        }

        child = sibling;
    }

    win32Error = ERROR_NOT_FOUND;

    return false;
}

HANDLE OpenHidInterface(const std::wstring& interfacePath,
                        DWORD desiredAccess,
                        DWORD& win32Error,
                        DWORD flagsAndAttributes)
{
    const HANDLE device = ::CreateFileW(interfacePath.c_str(),
                            desiredAccess,
                            FILE_SHARE_READ | FILE_SHARE_WRITE,
                            nullptr,
                            OPEN_EXISTING,
                            flagsAndAttributes,
                            nullptr);

    win32Error = (device == INVALID_HANDLE_VALUE) ? ::GetLastError() : ERROR_SUCCESS;

    return device;
}

bool ReadReportLayout(HANDLE device, HidReportLayout& layout, DWORD& win32Error)
{
    PHIDP_PREPARSED_DATA rawPreparsedData = nullptr;

    if (!::HidD_GetPreparsedData(device, &rawPreparsedData)) {
        win32Error = ::GetLastError();
        return false;
    }

    const PreparsedData preparsedData(rawPreparsedData);
    HIDP_CAPS caps = { 0 };

    if (::HidP_GetCaps(preparsedData.get(), &caps) != HIDP_STATUS_SUCCESS) {
        win32Error = ERROR_INVALID_DATA;
        return false;
    }

    layout.inputReportByteLength = caps.InputReportByteLength;
    layout.outputReportByteLength = caps.OutputReportByteLength;
    layout.featureReportByteLength = caps.FeatureReportByteLength;
    layout.outputReportId = FirstReportId(preparsedData.get(), HidP_Output, caps.NumberOutputValueCaps);
    layout.featureReportId = FirstReportId(preparsedData.get(), HidP_Feature, caps.NumberFeatureValueCaps);
    win32Error = ERROR_SUCCESS;

    return layout.outputReportByteLength > 1 && layout.featureReportByteLength > 1;
}

bool WriteOutputReport(HANDLE device,
                       const HidReportLayout& layout,
                       const std::vector<uint8_t>& report,
                       DWORD& win32Error)
{
    //
    // WriteFile wants exactly OutputReportByteLength bytes: the report id (0 when the collection
    // declares none) followed by the report body, zero padded.
    //
    if (report.size() + 1 > layout.outputReportByteLength) {
        win32Error = ERROR_INSUFFICIENT_BUFFER;
        return false;
    }

    std::vector<uint8_t> buffer(layout.outputReportByteLength, 0);

    buffer[0] = layout.outputReportId;
    ::memcpy(buffer.data() + 1, report.data(), report.size());

    DWORD written = 0;

    if (!::WriteFile(device, buffer.data(), static_cast<DWORD>(buffer.size()), &written, nullptr)) {
        win32Error = ::GetLastError();
        return false;
    }

    win32Error = ERROR_SUCCESS;

    return true;
}

bool ReadStatusFeature(HANDLE device,
                       const HidReportLayout& layout,
                       uint8_t& pendingReadCount,
                       uint8_t& ringDepth,
                       DWORD& win32Error)
{
    std::vector<uint8_t> buffer(layout.featureReportByteLength, 0);

    buffer[0] = layout.featureReportId;

    if (!::HidD_GetFeature(device, buffer.data(), static_cast<ULONG>(buffer.size()))) {
        win32Error = ::GetLastError();
        return false;
    }

    pendingReadCount = buffer[1];
    ringDepth = (buffer.size() > 2) ? buffer[2] : 0;
    win32Error = ERROR_SUCCESS;

    return true;
}

}  // namespace hidposemu
