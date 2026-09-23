#include "swdevice.h"

#include <initguid.h>

#include <cctype>

#include "../driver/properties.h"

namespace hidposemu {

namespace {

constexpr DWORD kCreateTimeoutMs = 10000;
constexpr DWORD kStatusPollIntervalMs = 500;

//
// The poll sleeps in slices so that an unplug does not have to wait out a whole interval.
//
constexpr DWORD kStatusPollSliceMs = 50;

//
// The driver needs a moment after SwDeviceCreate returns before hidclass has published the HID
// interface; the first emit or status poll would otherwise fail on a device that is fine.
//
constexpr DWORD kInterfaceWaitMs = 5000;
constexpr DWORD kInterfaceRetryMs = 100;

bool FileContainsHidPosEmu(const std::wstring& path)
{
    const HANDLE file = ::CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);

    if (file == INVALID_HANDLE_VALUE) {
        return false;
    }

    std::string content;
    char buffer[4096];
    DWORD read = 0;

    while (::ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
        content.append(buffer, read);
    }

    ::CloseHandle(file);

    for (char& character : content) {
        character = static_cast<char>(::tolower(static_cast<unsigned char>(character)));
    }

    return content.find("hidposemu") != std::string::npos;
}

bool WaitForHidInterface(const std::wstring& deviceInstancePath,
                         std::wstring& interfacePath,
                         DWORD& win32Error)
{
    for (DWORD waited = 0; waited < kInterfaceWaitMs; waited += kInterfaceRetryMs) {
        if (FindHidInterfacePath(deviceInstancePath, interfacePath, win32Error)) {
            return true;
        }

        ::Sleep(kInterfaceRetryMs);
    }

    return false;
}

}  // namespace

bool IsDriverInstalled()
{
    wchar_t windowsDirectory[MAX_PATH] = { 0 };

    if (::GetWindowsDirectoryW(windowsDirectory, ARRAYSIZE(windowsDirectory)) == 0) {
        return false;
    }

    const std::wstring infDirectory = std::wstring(windowsDirectory) + L"\\INF\\";
    WIN32_FIND_DATAW findData = { 0 };
    const HANDLE find = ::FindFirstFileW((infDirectory + L"oem*.inf").c_str(), &findData);

    if (find == INVALID_HANDLE_VALUE) {
        return false;
    }

    bool found = false;

    do {
        if (FileContainsHidPosEmu(infDirectory + findData.cFileName)) {
            found = true;
            break;
        }
    } while (::FindNextFileW(find, &findData));

    ::FindClose(find);

    return found;
}

void WINAPI SoftwareDevice::OnCreated(HSWDEVICE swDevice,
                                      HRESULT createResult,
                                      PVOID context,
                                      PCWSTR deviceInstanceId)
{
    SoftwareDevice* device = static_cast<SoftwareDevice*>(context);

    UNREFERENCED_PARAMETER(swDevice);

    device->createResult_ = createResult;

    if (SUCCEEDED(createResult) && deviceInstanceId != nullptr) {
        device->deviceInstancePath_ = deviceInstanceId;
    }

    ::SetEvent(device->createdEvent_);
}

std::unique_ptr<SoftwareDevice> SoftwareDevice::Create(const ServiceProfile& profile,
                                                       std::string& errorMessage,
                                                       DWORD& win32Error)
{
    std::unique_ptr<SoftwareDevice> device(new SoftwareDevice());

    win32Error = ERROR_SUCCESS;
    device->instanceId_ = profile.instanceId;
    device->createdEvent_ = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);

    if (device->createdEvent_ == nullptr) {
        errorMessage = "cannot create the device creation event";
        win32Error = ::GetLastError();
        return nullptr;
    }

    uint16_t vendorId = profile.vendorId;
    uint16_t productId = profile.productId;
    uint16_t versionNumber = profile.versionNumber;
    std::vector<uint8_t> reportDescriptor = profile.reportDescriptor;

    DEVPROPERTY properties[7] = {};

    const auto setProperty = [&properties](size_t index,
                                           const DEVPROPKEY& key,
                                           DEVPROPTYPE type,
                                           const void* buffer,
                                           size_t size) {
        properties[index].CompKey.Key = key;
        properties[index].CompKey.Store = DEVPROP_STORE_SYSTEM;
        properties[index].CompKey.LocaleName = nullptr;
        properties[index].Type = type;
        properties[index].BufferSize = static_cast<ULONG>(size);
        properties[index].Buffer = const_cast<void*>(buffer);
    };

    const auto stringSize = [](const std::wstring& value) {
        return (value.size() + 1) * sizeof(wchar_t);
    };

    setProperty(0, DEVPKEY_HidPosEmu_VendorId, DEVPROP_TYPE_UINT16, &vendorId, sizeof(vendorId));
    setProperty(1, DEVPKEY_HidPosEmu_ProductId, DEVPROP_TYPE_UINT16, &productId, sizeof(productId));
    setProperty(2, DEVPKEY_HidPosEmu_VersionNumber, DEVPROP_TYPE_UINT16, &versionNumber,
                sizeof(versionNumber));
    setProperty(3, DEVPKEY_HidPosEmu_Manufacturer, DEVPROP_TYPE_STRING, profile.manufacturer.c_str(),
                stringSize(profile.manufacturer));
    setProperty(4, DEVPKEY_HidPosEmu_Product, DEVPROP_TYPE_STRING, profile.product.c_str(),
                stringSize(profile.product));
    setProperty(5, DEVPKEY_HidPosEmu_SerialNumber, DEVPROP_TYPE_STRING, profile.serialNumber.c_str(),
                stringSize(profile.serialNumber));
    setProperty(6, DEVPKEY_HidPosEmu_ReportDescriptor, DEVPROP_TYPE_BINARY, reportDescriptor.data(),
                reportDescriptor.size());

    SW_DEVICE_CREATE_INFO createInfo = {};

    createInfo.cbSize = sizeof(createInfo);
    createInfo.pszInstanceId = profile.instanceId.c_str();
    createInfo.pszzHardwareIds = HIDPOSEMU_HARDWARE_ID L"\0";
    createInfo.pszzCompatibleIds = nullptr;
    createInfo.pContainerId = nullptr;
    createInfo.CapabilityFlags = SWDeviceCapabilitiesRemovable |
                                 SWDeviceCapabilitiesSilentInstall |
                                 SWDeviceCapabilitiesDriverRequired;
    createInfo.pszDeviceDescription = profile.product.c_str();
    createInfo.pszDeviceLocation = nullptr;
    createInfo.pSecurityDescriptor = nullptr;

    const HRESULT created = ::SwDeviceCreate(HIDPOSEMU_ENUMERATOR_NAME,
                            L"HTREE\\ROOT\\0",
                            &createInfo,
                            ARRAYSIZE(properties),
                            properties,
                            SoftwareDevice::OnCreated,
                            device.get(),
                            &device->handle_);

    if (FAILED(created)) {
        errorMessage = "SwDeviceCreate failed";
        win32Error = static_cast<DWORD>(created);
        return nullptr;
    }

    if (::WaitForSingleObject(device->createdEvent_, kCreateTimeoutMs) != WAIT_OBJECT_0) {
        errorMessage = "the device was not created within 10 s";
        win32Error = WAIT_TIMEOUT;
        return nullptr;
    }

    if (FAILED(device->createResult_)) {
        errorMessage = "the driver did not start the device";
        win32Error = static_cast<DWORD>(device->createResult_);
        return nullptr;
    }

    return device;
}

SoftwareDevice::~SoftwareDevice()
{
    if (handle_ != nullptr) {
        ::SwDeviceClose(handle_);
        handle_ = nullptr;
    }

    if (createdEvent_ != nullptr) {
        ::CloseHandle(createdEvent_);
        createdEvent_ = nullptr;
    }
}

bool SoftwareDevice::EmitReports(const std::vector<std::vector<uint8_t>>& reports,
                                 uint32_t delayMs,
                                 std::string& errorMessage,
                                 DWORD& win32Error)
{
    std::wstring interfacePath;

    if (!WaitForHidInterface(deviceInstancePath_, interfacePath, win32Error)) {
        errorMessage = "the HID interface of the device is not available";
        return false;
    }

    const HANDLE hidDevice = OpenHidInterface(interfacePath, GENERIC_WRITE, win32Error);

    if (hidDevice == INVALID_HANDLE_VALUE) {
        errorMessage = "cannot open the HID interface of the device";
        return false;
    }

    HidReportLayout layout;
    bool ok = ReadReportLayout(hidDevice, layout, win32Error);

    if (!ok) {
        errorMessage = "cannot read the HID capabilities of the device";
    }

    for (size_t index = 0; ok && index < reports.size(); ++index) {
        if (reports[index].size() + 1 > layout.outputReportByteLength) {
            errorMessage = "report too long";
            win32Error = ERROR_SUCCESS;
            ok = false;
            break;
        }

        if (index > 0 && delayMs > 0) {
            ::Sleep(delayMs);
        }

        if (!WriteOutputReport(hidDevice, layout, reports[index], win32Error)) {
            errorMessage = "cannot write the report to the device";
            ok = false;
        }
    }

    ::CloseHandle(hidDevice);

    return ok;
}

bool SoftwareDevice::ReadReaderActive(bool& readerActive)
{
    std::wstring interfacePath;
    DWORD win32Error = ERROR_SUCCESS;

    if (!FindHidInterfacePath(deviceInstancePath_, interfacePath, win32Error)) {
        return false;
    }

    //
    // Access 0 keeps hidclass from starting its read pump for this handle, so polling the status
    // never makes the service look like an application reading the scanner.
    //
    const HANDLE hidDevice = OpenHidInterface(interfacePath, 0, win32Error);

    if (hidDevice == INVALID_HANDLE_VALUE) {
        return false;
    }

    HidReportLayout layout;
    uint8_t pendingReadCount = 0;
    uint8_t ringDepth = 0;
    bool ok = ReadReportLayout(hidDevice, layout, win32Error) &&
              ReadStatusFeature(hidDevice, layout, pendingReadCount, ringDepth, win32Error);

    ::CloseHandle(hidDevice);

    if (ok) {
        readerActive = pendingReadCount > 0;
    }

    return ok;
}

DeviceManager::DeviceManager(EventSink eventSink)
    : eventSink_(std::move(eventSink))
{
}

DeviceManager::~DeviceManager()
{
    UnplugAll();
}

void DeviceManager::UnplugAll()
{
    std::map<std::wstring, std::shared_ptr<PluggedDevice>> devices;

    {
        std::lock_guard<std::mutex> guard(mutex_);

        devices.swap(devices_);
    }

    for (auto& entry : devices) {
        entry.second->stopStatusThread = true;

        if (entry.second->statusThread.joinable()) {
            entry.second->statusThread.join();
        }
    }
}

std::string DeviceManager::HandleRequestLine(const std::string& line)
{
    ServiceRequest request;
    std::string error;

    if (!ParseRequest(line, request, error)) {
        return MakeErrorResponse(request.id, error);
    }

    switch (request.op) {
    case RequestOp::List:
        return HandleList(request.id);
    case RequestOp::Plug:
        return HandlePlug(request);
    case RequestOp::Unplug:
        return HandleUnplug(request);
    case RequestOp::Emit:
        return HandleEmit(request);
    }

    return MakeErrorResponse(request.id, "unknown operation");
}

std::string DeviceManager::HandleList(int64_t id)
{
    std::vector<ServiceDevice> devices;

    {
        std::lock_guard<std::mutex> guard(mutex_);

        for (const auto& entry : devices_) {
            ServiceDevice device;

            device.instanceId = entry.first;
            device.devicePath = entry.second->device->DeviceInstancePath();
            device.readerActive = entry.second->readerActive;
            devices.push_back(device);
        }
    }

    return MakeDevicesResponse(id, devices);
}

std::string DeviceManager::HandlePlug(const ServiceRequest& request)
{
    {
        std::lock_guard<std::mutex> guard(mutex_);

        if (devices_.find(request.profile.instanceId) != devices_.end()) {
            return MakeErrorResponse(request.id, "already plugged");
        }
    }

    if (!IsDriverInstalled()) {
        return MakeErrorResponse(request.id, "driver not installed, run install.ps1");
    }

    std::string errorMessage;
    DWORD win32Error = ERROR_SUCCESS;
    std::unique_ptr<SoftwareDevice> created = SoftwareDevice::Create(request.profile,
                            errorMessage, win32Error);

    if (created == nullptr) {
        return MakeErrorResponse(request.id, errorMessage, win32Error);
    }

    ServiceDevice event;

    event.instanceId = created->InstanceId();
    event.devicePath = created->DeviceInstancePath();
    event.readerActive = false;

    auto plugged = std::make_shared<PluggedDevice>();

    plugged->device = std::move(created);

    {
        // Publishing the device and starting its poll thread under one lock keeps an unplug that
        // arrives right now from missing the thread and leaving it unjoined.
        std::lock_guard<std::mutex> guard(mutex_);

        devices_[request.profile.instanceId] = plugged;
        plugged->statusThread = std::thread(&DeviceManager::RunStatusPoll, this, plugged);
    }

    eventSink_(MakeDeviceEvent(event, DeviceEventState::Plugged));

    return MakeOkResponse(request.id);
}

std::string DeviceManager::HandleUnplug(const ServiceRequest& request)
{
    std::shared_ptr<PluggedDevice> plugged;

    {
        std::lock_guard<std::mutex> guard(mutex_);
        const auto entry = devices_.find(request.instanceId);

        if (entry == devices_.end()) {
            return MakeErrorResponse(request.id, "not plugged");
        }

        plugged = entry->second;
        devices_.erase(entry);
    }

    ServiceDevice event;

    event.instanceId = plugged->device->InstanceId();
    event.devicePath = plugged->device->DeviceInstancePath();
    event.readerActive = false;

    plugged->stopStatusThread = true;

    if (plugged->statusThread.joinable()) {
        plugged->statusThread.join();
    }

    eventSink_(MakeDeviceEvent(event, DeviceEventState::Unplugged));

    return MakeOkResponse(request.id);
}

std::string DeviceManager::HandleEmit(const ServiceRequest& request)
{
    std::shared_ptr<PluggedDevice> plugged;

    {
        std::lock_guard<std::mutex> guard(mutex_);
        const auto entry = devices_.find(request.instanceId);

        if (entry == devices_.end()) {
            return MakeErrorResponse(request.id, "not plugged");
        }

        plugged = entry->second;
    }

    std::string errorMessage;
    DWORD win32Error = ERROR_SUCCESS;

    if (!plugged->device->EmitReports(request.reports, request.delayMs, errorMessage, win32Error)) {
        if (win32Error == ERROR_SUCCESS) {
            return MakeErrorResponse(request.id, errorMessage);
        }

        return MakeErrorResponse(request.id, errorMessage, win32Error);
    }

    return MakeReportCountResponse(request.id, request.reports.size());
}

void DeviceManager::RunStatusPoll(std::shared_ptr<PluggedDevice> plugged)
{
    while (!plugged->stopStatusThread) {
        bool readerActive = false;

        if (plugged->device->ReadReaderActive(readerActive) &&
            readerActive != plugged->readerActive) {
            plugged->readerActive = readerActive;

            ServiceDevice event;

            event.instanceId = plugged->device->InstanceId();
            event.devicePath = plugged->device->DeviceInstancePath();
            event.readerActive = readerActive;

            eventSink_(MakeDeviceEvent(event, DeviceEventState::Reader));
        }

        for (DWORD waited = 0;
             waited < kStatusPollIntervalMs && !plugged->stopStatusThread;
             waited += kStatusPollSliceMs) {
            ::Sleep(kStatusPollSliceMs);
        }
    }
}

}  // namespace hidposemu
