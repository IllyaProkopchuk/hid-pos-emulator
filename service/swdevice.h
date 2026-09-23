//
// Software device lifecycle and the request handling on top of it. SwDeviceCreate needs
// administrator rights, which is why this lives in the service and not in the Node host.
//

#pragma once

#include <windows.h>
#include <swdevice.h>

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "hid.h"
#include "protocol.h"

namespace hidposemu {

//
// True when a driver package for HidPosEmu.inf is staged in the driver store. Checked by scanning
// the published INFs in %SystemRoot%\INF for the HidPosEmu hardware id, which needs no elevation
// and no SetupAPI enumeration of the whole HID class.
//
bool IsDriverInstalled();

class SoftwareDevice
{
public:
    ~SoftwareDevice();

    SoftwareDevice(const SoftwareDevice&) = delete;
    SoftwareDevice& operator=(const SoftwareDevice&) = delete;

    //
    // Creates the devnode and waits for the creation callback. Returns nullptr and fills
    // `errorMessage` / `win32Error` when the device could not be created or the driver did not
    // start it in time.
    //
    static std::unique_ptr<SoftwareDevice> Create(const ServiceProfile& profile,
                                                  std::string& errorMessage,
                                                  DWORD& win32Error);

    const std::wstring& InstanceId() const { return instanceId_; }
    const std::wstring& DeviceInstancePath() const { return deviceInstancePath_; }

    //
    // Opens the HID interface for the duration of one call so that the service's own handle is
    // never counted as an application reading the device.
    //
    bool EmitReports(const std::vector<std::vector<uint8_t>>& reports,
                     uint32_t delayMs,
                     std::string& errorMessage,
                     DWORD& win32Error);

    bool ReadReaderActive(bool& readerActive);

private:
    SoftwareDevice() = default;

    static void WINAPI OnCreated(HSWDEVICE swDevice,
                                 HRESULT createResult,
                                 PVOID context,
                                 PCWSTR deviceInstanceId);

    HSWDEVICE       handle_ = nullptr;
    HANDLE          createdEvent_ = nullptr;
    HRESULT         createResult_ = E_FAIL;
    std::wstring    instanceId_;
    std::wstring    deviceInstancePath_;
};

class DeviceManager
{
public:
    using EventSink = std::function<void(const std::string& line)>;

    explicit DeviceManager(EventSink eventSink);
    ~DeviceManager();

    //
    // Answers one request line with one response line. Never throws: a malformed line is answered
    // with `ok: false`.
    //
    std::string HandleRequestLine(const std::string& line);

    void UnplugAll();

private:
    struct PluggedDevice
    {
        std::unique_ptr<SoftwareDevice>     device;
        std::thread                         statusThread;
        std::atomic<bool>                   stopStatusThread{ false };
        std::atomic<bool>                   readerActive{ false };
    };

    std::string HandleList(int64_t id);
    std::string HandlePlug(const ServiceRequest& request);
    std::string HandleUnplug(const ServiceRequest& request);
    std::string HandleEmit(const ServiceRequest& request);

    void RunStatusPoll(std::shared_ptr<PluggedDevice> plugged);

    EventSink                                               eventSink_;
    std::mutex                                              mutex_;
    std::map<std::wstring, std::shared_ptr<PluggedDevice>>  devices_;
};

}  // namespace hidposemu
