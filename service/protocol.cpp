#include "protocol.h"

#include <windows.h>

#include "third_party/json.hpp"

namespace hidposemu {

namespace {

using nlohmann::json;

const char* const kStateNames[] = { "plugged", "unplugged", "reader" };

bool ParseHexBytes(const std::string& hex, std::vector<uint8_t>& bytes)
{
    if (hex.empty() || (hex.size() % 2) != 0) {
        return false;
    }

    bytes.clear();
    bytes.reserve(hex.size() / 2);

    for (size_t index = 0; index < hex.size(); index += 2) {
        int high = 0;
        int low = 0;

        for (int offset = 0; offset < 2; ++offset) {
            const char character = hex[index + static_cast<size_t>(offset)];
            int value = 0;

            if (character >= '0' && character <= '9') {
                value = character - '0';
            }
            else if (character >= 'a' && character <= 'f') {
                value = character - 'a' + 10;
            }
            else if (character >= 'A' && character <= 'F') {
                value = character - 'A' + 10;
            }
            else {
                return false;
            }

            if (offset == 0) {
                high = value;
            }
            else {
                low = value;
            }
        }

        bytes.push_back(static_cast<uint8_t>((high << 4) | low));
    }

    return true;
}

uint16_t ReadUInt16(const json& object, const char* name, bool& ok)
{
    if (!object.contains(name) || !object[name].is_number_unsigned()) {
        ok = false;
        return 0;
    }

    const uint64_t value = object[name].get<uint64_t>();

    if (value > 0xffff) {
        ok = false;
        return 0;
    }

    return static_cast<uint16_t>(value);
}

std::wstring ReadString(const json& object, const char* name, bool& ok)
{
    if (!object.contains(name) || !object[name].is_string()) {
        ok = false;
        return std::wstring();
    }

    return WideFromUtf8(object[name].get<std::string>());
}

json DeviceToJson(const ServiceDevice& device)
{
    return json{
        { "instanceId", Utf8FromWide(device.instanceId) },
        { "devicePath", Utf8FromWide(device.devicePath) },
        { "readerActive", device.readerActive },
    };
}

std::string ToLine(const json& value)
{
    return value.dump() + "\n";
}

}  // namespace

std::string Utf8FromWide(const std::wstring& value)
{
    if (value.empty()) {
        return std::string();
    }

    const int size = ::WideCharToMultiByte(CP_UTF8, 0, value.c_str(),
                            static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);

    if (size <= 0) {
        return std::string();
    }

    std::string result(static_cast<size_t>(size), '\0');

    ::WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                            result.data(), size, nullptr, nullptr);

    return result;
}

std::wstring WideFromUtf8(const std::string& value)
{
    if (value.empty()) {
        return std::wstring();
    }

    const int size = ::MultiByteToWideChar(CP_UTF8, 0, value.c_str(),
                            static_cast<int>(value.size()), nullptr, 0);

    if (size <= 0) {
        return std::wstring();
    }

    std::wstring result(static_cast<size_t>(size), L'\0');

    ::MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                            result.data(), size);

    return result;
}

bool ParseRequest(const std::string& line, ServiceRequest& request, std::string& error)
{
    json parsed = json::parse(line, nullptr, false);

    if (parsed.is_discarded() || !parsed.is_object()) {
        error = "malformed request";
        return false;
    }

    if (!parsed.contains("id") || !parsed["id"].is_number_integer()) {
        error = "malformed request";
        return false;
    }

    request.id = parsed["id"].get<int64_t>();

    if (!parsed.contains("op") || !parsed["op"].is_string()) {
        error = "malformed request";
        return false;
    }

    const std::string op = parsed["op"].get<std::string>();

    if (op == "list") {
        request.op = RequestOp::List;
        return true;
    }

    if (op == "unplug") {
        request.op = RequestOp::Unplug;

        bool ok = true;

        request.instanceId = ReadString(parsed, "instanceId", ok);

        if (!ok || request.instanceId.empty()) {
            error = "malformed request";
            return false;
        }

        return true;
    }

    if (op == "emit") {
        request.op = RequestOp::Emit;

        bool ok = true;

        request.instanceId = ReadString(parsed, "instanceId", ok);

        if (!ok || request.instanceId.empty() ||
            !parsed.contains("reportsHex") || !parsed["reportsHex"].is_array()) {
            error = "malformed request";
            return false;
        }

        for (const json& item : parsed["reportsHex"]) {
            std::vector<uint8_t> bytes;

            if (!item.is_string() || !ParseHexBytes(item.get<std::string>(), bytes)) {
                error = "malformed request";
                return false;
            }

            request.reports.push_back(std::move(bytes));
        }

        if (parsed.contains("delayMs") && parsed["delayMs"].is_number_unsigned()) {
            request.delayMs = parsed["delayMs"].get<uint32_t>();
        }

        return true;
    }

    if (op != "plug") {
        error = "unknown operation";
        return false;
    }

    request.op = RequestOp::Plug;

    if (!parsed.contains("profile") || !parsed["profile"].is_object()) {
        error = "malformed request";
        return false;
    }

    const json& profile = parsed["profile"];
    bool ok = true;

    request.profile.instanceId = ReadString(profile, "instanceId", ok);
    request.profile.vendorId = ReadUInt16(profile, "vendorId", ok);
    request.profile.productId = ReadUInt16(profile, "productId", ok);
    request.profile.versionNumber = ReadUInt16(profile, "versionNumber", ok);
    request.profile.manufacturer = ReadString(profile, "manufacturer", ok);
    request.profile.product = ReadString(profile, "product", ok);
    request.profile.serialNumber = ReadString(profile, "serialNumber", ok);

    if (!ok || request.profile.instanceId.empty() ||
        !profile.contains("reportDescriptorHex") || !profile["reportDescriptorHex"].is_string()) {
        error = "malformed request";
        return false;
    }

    if (!ParseHexBytes(profile["reportDescriptorHex"].get<std::string>(),
                       request.profile.reportDescriptor)) {
        error = "malformed report descriptor";
        return false;
    }

    request.instanceId = request.profile.instanceId;

    return true;
}

std::string MakeOkResponse(int64_t id)
{
    return ToLine(json{ { "id", id }, { "ok", true } });
}

std::string MakeDevicesResponse(int64_t id, const std::vector<ServiceDevice>& devices)
{
    json list = json::array();

    for (const ServiceDevice& device : devices) {
        list.push_back(DeviceToJson(device));
    }

    return ToLine(json{ { "id", id }, { "ok", true }, { "devices", list } });
}

std::string MakeReportCountResponse(int64_t id, size_t reportCount)
{
    return ToLine(json{ { "id", id }, { "ok", true }, { "reportCount", reportCount } });
}

std::string MakeErrorResponse(int64_t id, const std::string& error)
{
    return ToLine(json{ { "id", id }, { "ok", false }, { "error", error } });
}

std::string MakeErrorResponse(int64_t id, const std::string& error, uint32_t win32)
{
    return ToLine(json{ { "id", id }, { "ok", false }, { "error", error }, { "win32", win32 } });
}

std::string MakeHelloEvent(bool driverInstalled)
{
    return ToLine(json{
        { "event", "hello" },
        { "version", HIDPOSEMU_SERVICE_VERSION },
        { "driverInstalled", driverInstalled },
    });
}

std::string MakeDeviceEvent(const ServiceDevice& device, DeviceEventState state)
{
    return ToLine(json{
        { "event", "device" },
        { "device", DeviceToJson(device) },
        { "state", kStateNames[static_cast<size_t>(state)] },
    });
}

}  // namespace hidposemu
