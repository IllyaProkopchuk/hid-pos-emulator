#include "service.h"

#include <cstdio>
#include <cstring>
#include <iterator>
#include <memory>
#include <string>
#include <vector>

#include "hid.h"
#include "protocol.h"
#include "swdevice.h"

namespace hidposemu {

namespace {

constexpr DWORD kReadTimeoutMs = 2000;
constexpr DWORD kInterfaceWaitMs = 5000;
constexpr DWORD kInterfaceRetryMs = 100;

//
// The newland report descriptor as host/src/shared/descriptor.ts builds it: input 63 bytes report id 2,
// output 64 bytes report id 3, feature 2 bytes report id 4, all on usage page 0x8C.
//
const uint8_t kNewlandReportDescriptor[] = {
    0x05, 0x8c, 0x09, 0x03, 0xa1, 0x01,
    0x85, 0x02, 0x09, 0xfe, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x3f, 0x81, 0x02,
    0x85, 0x03, 0x06, 0x00, 0xff, 0x09, 0x01, 0x95, 0x40, 0x91, 0x02,
    0x85, 0x04, 0x09, 0x02, 0x95, 0x02, 0xb1, 0x02,
    0xc0
};

//
// The ticketBarcode preset framed by host/src/shared/framing.ts: report id, the Newland length byte
// (12 characters plus the terminator), the text and CR, zero padded to 63 report bytes.
//
const uint8_t kExpectedPrefix[] = {
    0x02, 0x0d, '2', '2', '1', '-', '3', '3', '5', '1', '-', '7', '5', '3', 0x0d
};

int Fail(const char* reason)
{
    ::printf("selftest FAILED: %s\n", reason);

    return 1;
}

int FailWithError(const char* reason, DWORD win32Error)
{
    ::printf("selftest FAILED: %s (win32 %lu)\n", reason, win32Error);

    return 1;
}

ServiceProfile MakeNewlandProfile()
{
    ServiceProfile profile;

    profile.instanceId = L"selftest";
    profile.vendorId = 0x1eab;
    profile.productId = 0x3910;
    profile.versionNumber = 0x0100;
    profile.manufacturer = L"Newland Auto-ID";
    profile.product = L"NLS-HR22";
    profile.serialNumber = L"EMU-NEWLAND-0001";
    profile.reportDescriptor.assign(std::begin(kNewlandReportDescriptor),
                                    std::end(kNewlandReportDescriptor));

    return profile;
}

std::vector<uint8_t> MakeTicketBarcodeReport()
{
    std::vector<uint8_t> report(sizeof(kExpectedPrefix) + 49, 0);

    ::memcpy(report.data(), kExpectedPrefix, sizeof(kExpectedPrefix));

    return report;
}

bool WaitForInterface(const std::wstring& deviceInstancePath, std::wstring& interfacePath)
{
    DWORD win32Error = ERROR_SUCCESS;

    for (DWORD waited = 0; waited < kInterfaceWaitMs; waited += kInterfaceRetryMs) {
        if (FindHidInterfacePath(deviceInstancePath, interfacePath, win32Error)) {
            return true;
        }

        ::Sleep(kInterfaceRetryMs);
    }

    return false;
}

}  // namespace

int RunSelfTest()
{
    if (!IsDriverInstalled()) {
        return Fail("driver not installed, run install.ps1");
    }

    std::string errorMessage;
    DWORD win32Error = ERROR_SUCCESS;
    std::unique_ptr<SoftwareDevice> device = SoftwareDevice::Create(MakeNewlandProfile(),
                            errorMessage, win32Error);

    if (device == nullptr) {
        return FailWithError(errorMessage.c_str(), win32Error);
    }

    std::wstring interfacePath;

    if (!WaitForInterface(device->DeviceInstancePath(), interfacePath)) {
        return Fail("the device has no HID interface, check Device Manager for a yellow bang");
    }

    //
    // This handle is the application in the test: opened for read, so hidclass keeps a read
    // request pending on the driver, exactly like Chrome after device.open().
    //
    const HANDLE reader = OpenHidInterface(interfacePath, GENERIC_READ, win32Error,
                            FILE_FLAG_OVERLAPPED);

    if (reader == INVALID_HANDLE_VALUE) {
        return FailWithError("cannot open the HID interface for reading", win32Error);
    }

    HidReportLayout layout;

    if (!ReadReportLayout(reader, layout, win32Error)) {
        ::CloseHandle(reader);
        return FailWithError("cannot read the HID capabilities", win32Error);
    }

    std::vector<uint8_t> readBuffer(layout.inputReportByteLength, 0);
    OVERLAPPED overlapped = {};

    overlapped.hEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

    if (overlapped.hEvent == nullptr) {
        ::CloseHandle(reader);
        return FailWithError("cannot create the read event", ::GetLastError());
    }

    DWORD read = 0;
    bool pending = ::ReadFile(reader, readBuffer.data(), static_cast<DWORD>(readBuffer.size()),
                              &read, &overlapped) == FALSE;

    if (pending && ::GetLastError() != ERROR_IO_PENDING) {
        const DWORD error = ::GetLastError();

        ::CloseHandle(overlapped.hEvent);
        ::CloseHandle(reader);

        return FailWithError("cannot start the read", error);
    }

    const std::vector<std::vector<uint8_t>> reports = { MakeTicketBarcodeReport() };

    if (!device->EmitReports(reports, 0, errorMessage, win32Error)) {
        ::CancelIoEx(reader, &overlapped);
        ::CloseHandle(overlapped.hEvent);
        ::CloseHandle(reader);

        return FailWithError(errorMessage.c_str(), win32Error);
    }

    if (pending) {
        if (::WaitForSingleObject(overlapped.hEvent, kReadTimeoutMs) != WAIT_OBJECT_0) {
            ::CancelIoEx(reader, &overlapped);
            ::CloseHandle(overlapped.hEvent);
            ::CloseHandle(reader);

            return Fail("no input report arrived within 2 s");
        }

        if (!::GetOverlappedResult(reader, &overlapped, &read, FALSE)) {
            const DWORD error = ::GetLastError();

            ::CloseHandle(overlapped.hEvent);
            ::CloseHandle(reader);

            return FailWithError("the read failed", error);
        }
    }

    ::CloseHandle(overlapped.hEvent);
    ::CloseHandle(reader);

    if (read < sizeof(kExpectedPrefix)) {
        ::printf("selftest FAILED: the input report is %lu bytes\n", read);
        return 1;
    }

    if (::memcmp(readBuffer.data(), kExpectedPrefix, sizeof(kExpectedPrefix)) != 0) {
        ::printf("selftest FAILED: the input report does not start with the expected bytes\n");
        return 1;
    }

    ::printf("selftest OK: %lu bytes, report id %u, text 221-3351-753\n",
             read, static_cast<unsigned>(readBuffer[0]));

    return 0;
}

}  // namespace hidposemu
