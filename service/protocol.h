//
// JSON lines protocol between the Node host and HidPosEmuSvc. One object per line, UTF-8, over
// the named pipe. The types mirror host/src/server/serviceClient.ts.
//

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#define HIDPOSEMU_SERVICE_VERSION "1.0.0"

namespace hidposemu {

struct ServiceProfile
{
    std::wstring            instanceId;
    uint16_t                vendorId = 0;
    uint16_t                productId = 0;
    uint16_t                versionNumber = 0;
    std::wstring            manufacturer;
    std::wstring            product;
    std::wstring            serialNumber;
    std::vector<uint8_t>    reportDescriptor;
};

struct ServiceDevice
{
    std::wstring    instanceId;
    std::wstring    devicePath;
    bool            readerActive = false;
};

enum class RequestOp
{
    List,
    Plug,
    Unplug,
    Emit
};

struct ServiceRequest
{
    int64_t                             id = 0;
    RequestOp                           op = RequestOp::List;
    ServiceProfile                      profile;
    std::wstring                        instanceId;
    std::vector<std::vector<uint8_t>>   reports;
    uint32_t                            delayMs = 0;
};

enum class DeviceEventState
{
    Plugged,
    Unplugged,
    Reader
};

std::string Utf8FromWide(const std::wstring& value);
std::wstring WideFromUtf8(const std::string& value);

//
// Parses one request line. On a malformed line the request id is 0 and `error` explains why, so
// the caller can still answer with a well formed failure.
//
bool ParseRequest(const std::string& line, ServiceRequest& request, std::string& error);

std::string MakeOkResponse(int64_t id);
std::string MakeDevicesResponse(int64_t id, const std::vector<ServiceDevice>& devices);
std::string MakeReportCountResponse(int64_t id, size_t reportCount);
std::string MakeErrorResponse(int64_t id, const std::string& error);
std::string MakeErrorResponse(int64_t id, const std::string& error, uint32_t win32);
std::string MakeHelloEvent(bool driverInstalled);
std::string MakeDeviceEvent(const ServiceDevice& device, DeviceEventState state);

}  // namespace hidposemu
