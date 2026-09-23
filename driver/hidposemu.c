/*++

Copyright (C) Microsoft Corporation, All Rights Reserved.

Module Name:

    hidposemu.c

Abstract:

    HidPosEmu, a UMDF 2 virtual HID minidriver that presents a HID-POS barcode scanner. Derived
    from the Windows driver sample hid/vhidmini2 (driver/vhidmini.c and driver/umdf2/util.c); see
    THIRD_PARTY.md.

    Three things differ from the sample:

    1. Every device attribute (vendor id, product id, version, strings, report descriptor) comes
       from device properties that HidPosEmuSvc sets in SwDeviceCreate, so one driver serves every
       scanner profile.
    2. Input reports are injected through the output report path: the body of an output report is
       the exact input report to emit. A pending read is completed with it straight away,
       otherwise it waits in a ring.
    3. A feature report reports [pendingReadCount, ringDepth], which tells the host whether an
       application currently has the device open.

Environment:

    Windows Driver Framework (WDF), user mode

--*/

#include <initguid.h>

#include "hidposemu.h"

//
// Bytes of the status feature report, excluding the report id: pending reads and ring depth.
//
#define HIDPOSEMU_STATUS_REPORT_SIZE    2

//
// The HID descriptor is fixed except for wReportLength, which is the length of the report
// descriptor property of the device being added.
//
static const HID_DESCRIPTOR G_DefaultHidDescriptor = {
    0x09,   // length of HID descriptor
    0x21,   // descriptor type == HID  0x21
    0x0100, // hid spec release
    0x00,   // country code == Not Specified
    0x01,   // number of HID class descriptors
    {                   // DescriptorList[0]
        0x22,           // report descriptor type 0x22
        0x00            // total length of report descriptor, filled in per device
    }
};

NTSTATUS
DriverEntry(
    _In_  PDRIVER_OBJECT    DriverObject,
    _In_  PUNICODE_STRING   RegistryPath
    )
{
    WDF_DRIVER_CONFIG       config;
    NTSTATUS                status;

    KdPrint(("HidPosEmu: DriverEntry\n"));

    WDF_DRIVER_CONFIG_INIT(&config, EvtDeviceAdd);

    status = WdfDriverCreate(DriverObject,
                            RegistryPath,
                            WDF_NO_OBJECT_ATTRIBUTES,
                            &config,
                            WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfDriverCreate failed 0x%x\n", status));
    }

    return status;
}

NTSTATUS
EvtDeviceAdd(
    _In_  WDFDRIVER         Driver,
    _Inout_ PWDFDEVICE_INIT DeviceInit
    )
/*++
Routine Description:

    Creates the device object, reads the per-device configuration from the device properties that
    HidPosEmuSvc supplied to SwDeviceCreate, and creates the two queues. A missing or wrongly
    typed property fails the device with STATUS_INVALID_PARAMETER, which shows up as a yellow bang
    in Device Manager instead of a silently wrong scanner.

--*/
{
    NTSTATUS                status;
    WDF_OBJECT_ATTRIBUTES   deviceAttributes;
    WDFDEVICE               device;
    PDEVICE_CONTEXT         deviceContext;
    UNREFERENCED_PARAMETER  (Driver);

    KdPrint(("HidPosEmu: EvtDeviceAdd\n"));

    //
    // Mark ourselves as a filter, which also relinquishes power policy ownership.
    //
    WdfFdoInitSetFilter(DeviceInit);

    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&deviceAttributes, DEVICE_CONTEXT);

    status = WdfDeviceCreate(&DeviceInit, &deviceAttributes, &device);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfDeviceCreate failed 0x%x\n", status));
        return status;
    }

    deviceContext = GetDeviceContext(device);
    RtlZeroMemory(deviceContext, sizeof(DEVICE_CONTEXT));
    deviceContext->Device = device;
    deviceContext->HidDescriptor = G_DefaultHidDescriptor;

    status = WdfWaitLockCreate(WDF_NO_OBJECT_ATTRIBUTES, &deviceContext->StateLock);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfWaitLockCreate failed 0x%x\n", status));
        return status;
    }

    status = ReadDeviceProperties(device);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueueCreate(device, &deviceContext->DefaultQueue);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = ManualQueueCreate(device, &deviceContext->ManualQueue);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    return STATUS_SUCCESS;
}

static NTSTATUS
QueryDeviceProperty(
    _In_  WDFDEVICE         Device,
    _In_  const DEVPROPKEY *PropertyKey,
    _In_  DEVPROPTYPE       ExpectedType,
    _In_  PCSTR             PropertyName,
    _Out_ WDFMEMORY        *PropertyMemory,
    _Outptr_result_bytebuffer_(*BufferSize)
          PVOID            *Buffer,
    _Out_ size_t           *BufferSize
    )
/*++
Routine Description:

    Reads one device property that HidPosEmuSvc set through SW_DEVICE_CREATE_INFO. The caller owns
    the returned WDFMEMORY and deletes it once the value has been copied into the device context.

--*/
{
    WDF_DEVICE_PROPERTY_DATA    propertyData;
    WDF_OBJECT_ATTRIBUTES       memoryAttributes;
    DEVPROPTYPE                 propertyType;
    NTSTATUS                    status;

    UNREFERENCED_PARAMETER(PropertyName);

    *PropertyMemory = NULL;
    *Buffer = NULL;
    *BufferSize = 0;

    WDF_DEVICE_PROPERTY_DATA_INIT(&propertyData, PropertyKey);
    propertyData.Lcid = LOCALE_NEUTRAL;
    propertyData.Flags = 0;

    WDF_OBJECT_ATTRIBUTES_INIT(&memoryAttributes);
    memoryAttributes.ParentObject = Device;

    status = WdfDeviceAllocAndQueryPropertyEx(Device,
                            &propertyData,
                            NonPagedPool,
                            &memoryAttributes,
                            PropertyMemory,
                            &propertyType);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: device property %s is missing, 0x%x\n", PropertyName, status));
        return STATUS_INVALID_PARAMETER;
    }

    if (propertyType != ExpectedType) {
        KdPrint(("HidPosEmu: device property %s has type 0x%x, expected 0x%x\n",
                            PropertyName, propertyType, ExpectedType));
        WdfObjectDelete(*PropertyMemory);
        *PropertyMemory = NULL;
        return STATUS_INVALID_PARAMETER;
    }

    *Buffer = WdfMemoryGetBuffer(*PropertyMemory, BufferSize);

    return STATUS_SUCCESS;
}

static NTSTATUS
QueryUInt16Property(
    _In_  WDFDEVICE         Device,
    _In_  const DEVPROPKEY *PropertyKey,
    _In_  PCSTR             PropertyName,
    _Out_ USHORT           *Value
    )
{
    WDFMEMORY   memory;
    PVOID       buffer;
    size_t      size;
    NTSTATUS    status;

    *Value = 0;

    status = QueryDeviceProperty(Device, PropertyKey, DEVPROP_TYPE_UINT16, PropertyName,
                            &memory, &buffer, &size);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    if (size != sizeof(USHORT)) {
        KdPrint(("HidPosEmu: device property %s is %d bytes, expected %d\n",
                            PropertyName, (int)size, (int)sizeof(USHORT)));
        WdfObjectDelete(memory);
        return STATUS_INVALID_PARAMETER;
    }

    *Value = *(USHORT UNALIGNED *)buffer;
    WdfObjectDelete(memory);

    return STATUS_SUCCESS;
}

static NTSTATUS
QueryStringProperty(
    _In_  WDFDEVICE         Device,
    _In_  const DEVPROPKEY *PropertyKey,
    _In_  PCSTR             PropertyName,
    _Out_writes_z_(HIDPOSEMU_MAX_STRING_CCH + 1)
          PWSTR             Value
    )
/*++
Routine Description:

    Copies a string property into a context owned buffer, capped at 126 characters, which is the
    limit a USB string descriptor and therefore IOCTL_HID_GET_STRING can carry.

--*/
{
    WDFMEMORY   memory;
    PVOID       buffer;
    size_t      size;
    size_t      characters;
    NTSTATUS    status;

    Value[0] = L'\0';

    status = QueryDeviceProperty(Device, PropertyKey, DEVPROP_TYPE_STRING, PropertyName,
                            &memory, &buffer, &size);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    if (size < sizeof(WCHAR) || (size % sizeof(WCHAR)) != 0) {
        KdPrint(("HidPosEmu: device property %s is not a valid string, %d bytes\n",
                            PropertyName, (int)size));
        WdfObjectDelete(memory);
        return STATUS_INVALID_PARAMETER;
    }

    characters = (size / sizeof(WCHAR)) - 1;

    if (((PWSTR)buffer)[characters] != L'\0') {
        KdPrint(("HidPosEmu: device property %s is not null terminated\n", PropertyName));
        WdfObjectDelete(memory);
        return STATUS_INVALID_PARAMETER;
    }

    if (characters > (size_t)HIDPOSEMU_MAX_STRING_CCH) {
        KdPrint(("HidPosEmu: device property %s is %d characters, at most %d are allowed\n",
                            PropertyName, (int)characters, HIDPOSEMU_MAX_STRING_CCH));
        WdfObjectDelete(memory);
        return STATUS_INVALID_PARAMETER;
    }

    RtlCopyMemory(Value, buffer, size);
    WdfObjectDelete(memory);

    return STATUS_SUCCESS;
}

static NTSTATUS
QueryReportDescriptorProperty(
    _In_  WDFDEVICE         Device
    )
{
    PDEVICE_CONTEXT deviceContext = GetDeviceContext(Device);
    WDFMEMORY       memory;
    PVOID           buffer;
    size_t          size;
    NTSTATUS        status;

    status = QueryDeviceProperty(Device, &DEVPKEY_HidPosEmu_ReportDescriptor, DEVPROP_TYPE_BINARY,
                            "ReportDescriptor", &memory, &buffer, &size);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    if (size == 0 || size > (size_t)HIDPOSEMU_MAX_REPORT_DESCRIPTOR) {
        KdPrint(("HidPosEmu: device property ReportDescriptor is %d bytes, expected 1 to %d\n",
                            (int)size, HIDPOSEMU_MAX_REPORT_DESCRIPTOR));
        WdfObjectDelete(memory);
        return STATUS_INVALID_PARAMETER;
    }

    RtlCopyMemory(deviceContext->ReportDescriptor, buffer, size);
    deviceContext->ReportDescriptorLength = (USHORT)size;
    deviceContext->HidDescriptor.DescriptorList[0].wReportLength = (USHORT)size;
    WdfObjectDelete(memory);

    return STATUS_SUCCESS;
}

NTSTATUS
ReadDeviceProperties(
    _In_  WDFDEVICE         Device
    )
{
    PDEVICE_CONTEXT         deviceContext = GetDeviceContext(Device);
    PHID_DEVICE_ATTRIBUTES  hidAttributes = &deviceContext->HidDeviceAttributes;
    NTSTATUS                status;

    RtlZeroMemory(hidAttributes, sizeof(HID_DEVICE_ATTRIBUTES));
    hidAttributes->Size = sizeof(HID_DEVICE_ATTRIBUTES);

    status = QueryUInt16Property(Device, &DEVPKEY_HidPosEmu_VendorId, "VendorId",
                            &hidAttributes->VendorID);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueryUInt16Property(Device, &DEVPKEY_HidPosEmu_ProductId, "ProductId",
                            &hidAttributes->ProductID);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueryUInt16Property(Device, &DEVPKEY_HidPosEmu_VersionNumber, "VersionNumber",
                            &hidAttributes->VersionNumber);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueryStringProperty(Device, &DEVPKEY_HidPosEmu_Manufacturer, "Manufacturer",
                            deviceContext->Manufacturer);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueryStringProperty(Device, &DEVPKEY_HidPosEmu_Product, "Product",
                            deviceContext->Product);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueryStringProperty(Device, &DEVPKEY_HidPosEmu_SerialNumber, "SerialNumber",
                            deviceContext->SerialNumber);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = QueryReportDescriptorProperty(Device);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    KdPrint(("HidPosEmu: configured %04x:%04x, report descriptor %d bytes\n",
                        hidAttributes->VendorID,
                        hidAttributes->ProductID,
                        deviceContext->ReportDescriptorLength));

    return STATUS_SUCCESS;
}

NTSTATUS
QueueCreate(
    _In_  WDFDEVICE         Device,
    _Out_ WDFQUEUE          *Queue
    )
/*++
Routine Description:

    Creates the default, parallel queue that processes the IOCTLs from hidclass.sys.

--*/
{
    NTSTATUS                status;
    WDF_IO_QUEUE_CONFIG     queueConfig;
    WDF_OBJECT_ATTRIBUTES   queueAttributes;
    WDFQUEUE                queue;
    PQUEUE_CONTEXT          queueContext;

    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchParallel);

    //
    // hidclass uses INTERNAL_IOCTL, which UMDF does not support. mshidumdf.sys turns those into
    // DEVICE_CONTROL for the next stack and sends them down.
    //
    queueConfig.EvtIoDeviceControl = EvtIoDeviceControl;

    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&queueAttributes, QUEUE_CONTEXT);

    status = WdfIoQueueCreate(Device, &queueConfig, &queueAttributes, &queue);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfIoQueueCreate failed 0x%x\n", status));
        return status;
    }

    queueContext = GetQueueContext(queue);
    queueContext->Queue = queue;
    queueContext->DeviceContext = GetDeviceContext(Device);

    *Queue = queue;

    return status;
}

NTSTATUS
ManualQueueCreate(
    _In_  WDFDEVICE         Device,
    _Out_ WDFQUEUE          *Queue
    )
/*++
Routine Description:

    Creates the manual queue that holds IOCTL_HID_READ_REPORT requests until a report is injected.

    Unlike the sample there is no timer: the reports come from HidPosEmuSvc through the output
    report path, so a request waits here until one arrives or the application cancels it.

--*/
{
    NTSTATUS                status;
    WDF_IO_QUEUE_CONFIG     queueConfig;
    WDF_OBJECT_ATTRIBUTES   queueAttributes;
    WDFQUEUE                queue;
    PMANUAL_QUEUE_CONTEXT   queueContext;

    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchManual);

    //
    // Without this callback a cancelled read would leave PendingReadCount too high and the host
    // would keep showing a reader that is gone.
    //
    queueConfig.EvtIoCanceledOnQueue = EvtIoCanceledOnQueue;

    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&queueAttributes, MANUAL_QUEUE_CONTEXT);

    status = WdfIoQueueCreate(Device, &queueConfig, &queueAttributes, &queue);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfIoQueueCreate (manual) failed 0x%x\n", status));
        return status;
    }

    queueContext = GetManualQueueContext(queue);
    queueContext->Queue = queue;
    queueContext->DeviceContext = GetDeviceContext(Device);

    *Queue = queue;

    return status;
}

static VOID
AddPendingRead(
    _In_  PDEVICE_CONTEXT   DeviceContext,
    _In_  BOOLEAN           Added
    )
{
    WdfWaitLockAcquire(DeviceContext->StateLock, NULL);

    if (Added) {
        DeviceContext->PendingReadCount += 1;
    }
    else if (DeviceContext->PendingReadCount > 0) {
        DeviceContext->PendingReadCount -= 1;
    }

    WdfWaitLockRelease(DeviceContext->StateLock);
}

static VOID
RingPush(
    _In_  PDEVICE_CONTEXT   DeviceContext,
    _In_reads_bytes_(Length)
          const UCHAR      *Bytes,
    _In_  ULONG             Length
    )
{
    ULONG   index;

    WdfWaitLockAcquire(DeviceContext->StateLock, NULL);

    if (DeviceContext->RingCount == HIDPOSEMU_RING_ENTRIES) {
        KdPrint(("HidPosEmu: report ring is full, dropping the oldest report\n"));
        DeviceContext->RingHead = (DeviceContext->RingHead + 1) % HIDPOSEMU_RING_ENTRIES;
        DeviceContext->RingCount -= 1;
    }

    index = (DeviceContext->RingHead + DeviceContext->RingCount) % HIDPOSEMU_RING_ENTRIES;
    DeviceContext->Ring[index].Length = Length;
    RtlCopyMemory(DeviceContext->Ring[index].Bytes, Bytes, Length);
    DeviceContext->RingCount += 1;

    WdfWaitLockRelease(DeviceContext->StateLock);
}

static BOOLEAN
RingPop(
    _In_  PDEVICE_CONTEXT   DeviceContext,
    _Out_ PHIDPOSEMU_REPORT Report
    )
{
    BOOLEAN found = FALSE;

    WdfWaitLockAcquire(DeviceContext->StateLock, NULL);

    if (DeviceContext->RingCount > 0) {
        *Report = DeviceContext->Ring[DeviceContext->RingHead];
        DeviceContext->RingHead = (DeviceContext->RingHead + 1) % HIDPOSEMU_RING_ENTRIES;
        DeviceContext->RingCount -= 1;
        found = TRUE;
    }

    WdfWaitLockRelease(DeviceContext->StateLock);

    return found;
}

static NTSTATUS
CompleteReadRequest(
    _In_  WDFREQUEST        Request,
    _In_reads_bytes_(Length)
          const UCHAR      *Bytes,
    _In_  ULONG             Length
    )
/*++
Routine Description:

    Completes one IOCTL_HID_READ_REPORT with the bytes of an injected input report. The request is
    completed in every path, so the caller must not complete it again.

--*/
{
    NTSTATUS    status;
    WDFMEMORY   memory;
    size_t      outputBufferLength;

    status = WdfRequestRetrieveOutputMemory(Request, &memory);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestRetrieveOutputMemory failed 0x%x\n", status));
        WdfRequestComplete(Request, status);
        return status;
    }

    WdfMemoryGetBuffer(memory, &outputBufferLength);

    if (outputBufferLength < Length) {
        KdPrint(("HidPosEmu: read buffer too small. Size %d, report %d\n",
                            (int)outputBufferLength, (int)Length));
        WdfRequestComplete(Request, STATUS_INVALID_BUFFER_SIZE);
        return STATUS_INVALID_BUFFER_SIZE;
    }

    status = WdfMemoryCopyFromBuffer(memory, 0, (PVOID)Bytes, Length);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfMemoryCopyFromBuffer failed 0x%x\n", status));
        WdfRequestComplete(Request, status);
        return status;
    }

    WdfRequestCompleteWithInformation(Request, STATUS_SUCCESS, Length);

    return STATUS_SUCCESS;
}

VOID
EvtIoCanceledOnQueue(
    _In_  WDFQUEUE          Queue,
    _In_  WDFREQUEST        Request
    )
{
    PMANUAL_QUEUE_CONTEXT queueContext = GetManualQueueContext(Queue);

    AddPendingRead(queueContext->DeviceContext, FALSE);
    WdfRequestComplete(Request, STATUS_CANCELLED);
}

VOID
EvtIoDeviceControl(
    _In_  WDFQUEUE          Queue,
    _In_  WDFREQUEST        Request,
    _In_  size_t            OutputBufferLength,
    _In_  size_t            InputBufferLength,
    _In_  ULONG             IoControlCode
    )
{
    NTSTATUS                status;
    BOOLEAN                 completeRequest = TRUE;
    WDFDEVICE               device = WdfIoQueueGetDevice(Queue);
    PDEVICE_CONTEXT         deviceContext = GetDeviceContext(device);
    PQUEUE_CONTEXT          queueContext = GetQueueContext(Queue);
    UNREFERENCED_PARAMETER  (OutputBufferLength);
    UNREFERENCED_PARAMETER  (InputBufferLength);

    switch (IoControlCode)
    {
    case IOCTL_HID_GET_DEVICE_DESCRIPTOR:   // METHOD_NEITHER
        status = RequestCopyFromBuffer(Request,
                            &deviceContext->HidDescriptor,
                            deviceContext->HidDescriptor.bLength);
        break;

    case IOCTL_HID_GET_DEVICE_ATTRIBUTES:   // METHOD_NEITHER
        status = RequestCopyFromBuffer(Request,
                            &deviceContext->HidDeviceAttributes,
                            sizeof(HID_DEVICE_ATTRIBUTES));
        break;

    case IOCTL_HID_GET_REPORT_DESCRIPTOR:   // METHOD_NEITHER
        status = RequestCopyFromBuffer(Request,
                            deviceContext->ReportDescriptor,
                            deviceContext->ReportDescriptorLength);
        break;

    case IOCTL_HID_READ_REPORT:             // METHOD_NEITHER
        status = ReadReport(queueContext, Request, &completeRequest);
        break;

    case IOCTL_HID_WRITE_REPORT:            // METHOD_NEITHER
        status = WriteReport(queueContext, Request);
        break;

    //
    // HID minidriver IOCTLs use HID_XFER_PACKET, which contains an embedded pointer. UMDF cannot
    // marshal that between processes, so mshidumdf.sys converts those IRPs into IOCTL_UMDF_HID_Xxx
    // where the report buffer and the report id travel as two separate buffers.
    //
    case IOCTL_UMDF_HID_GET_FEATURE:        // METHOD_NEITHER
        status = GetFeature(queueContext, Request);
        break;

    case IOCTL_UMDF_HID_SET_FEATURE:        // METHOD_NEITHER
    case IOCTL_UMDF_HID_GET_INPUT_REPORT:   // METHOD_NEITHER
    case IOCTL_UMDF_HID_SET_OUTPUT_REPORT:  // METHOD_NEITHER
        //
        // The device has one writable channel, the output report, and it is reached through
        // IOCTL_HID_WRITE_REPORT above.
        //
        status = STATUS_NOT_SUPPORTED;
        break;

    case IOCTL_HID_GET_STRING:              // METHOD_NEITHER
        status = GetString(queueContext, Request);
        break;

    case IOCTL_HID_GET_INDEXED_STRING:      // METHOD_OUT_DIRECT
        status = GetIndexedString(queueContext, Request);
        break;

    case IOCTL_HID_ACTIVATE_DEVICE:                 // METHOD_NEITHER
    case IOCTL_HID_DEACTIVATE_DEVICE:               // METHOD_NEITHER
        //
        // hidclass activates the device on behalf of a collection when that collection's own
        // driver enters D0. There is nothing to power up here, but failing the request fails the
        // collection's start, which the child devnode reports as Code 10 with
        // STATUS_DEVICE_POWER_FAILURE.
        //
        status = STATUS_SUCCESS;
        break;

    case IOCTL_HID_SEND_IDLE_NOTIFICATION_REQUEST:  // METHOD_NEITHER
        //
        // A virtual device never idles. Not implemented, fall through.
        //
    case IOCTL_GET_PHYSICAL_DESCRIPTOR:             // METHOD_OUT_DIRECT
    default:
        status = STATUS_NOT_IMPLEMENTED;
        break;
    }

    if (completeRequest) {
        WdfRequestComplete(Request, status);
    }
}

NTSTATUS
RequestCopyFromBuffer(
    _In_  WDFREQUEST        Request,
    _In_  PVOID             SourceBuffer,
    _When_(NumBytesToCopyFrom == 0, __drv_reportError(NumBytesToCopyFrom cannot be zero))
    _In_  size_t            NumBytesToCopyFrom
    )
{
    NTSTATUS                status;
    WDFMEMORY               memory;
    size_t                  outputBufferLength;

    status = WdfRequestRetrieveOutputMemory(Request, &memory);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestRetrieveOutputMemory failed 0x%x\n", status));
        return status;
    }

    WdfMemoryGetBuffer(memory, &outputBufferLength);
    if (outputBufferLength < NumBytesToCopyFrom) {
        KdPrint(("HidPosEmu: RequestCopyFromBuffer: buffer too small. Size %d, expect %d\n",
                (int)outputBufferLength, (int)NumBytesToCopyFrom));
        return STATUS_INVALID_BUFFER_SIZE;
    }

    status = WdfMemoryCopyFromBuffer(memory, 0, SourceBuffer, NumBytesToCopyFrom);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfMemoryCopyFromBuffer failed 0x%x\n", status));
        return status;
    }

    WdfRequestSetInformation(Request, NumBytesToCopyFrom);

    return status;
}

NTSTATUS
ReadReport(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request,
    _Always_(_Out_)
          BOOLEAN*          CompleteRequest
    )
/*++
Routine Description:

    Handles IOCTL_HID_READ_REPORT. Reports injected before the application started reading are
    waiting in the ring, so those are handed over first; otherwise the request is parked in the
    manual queue until an output report arrives.

--*/
{
    PDEVICE_CONTEXT     deviceContext = QueueContext->DeviceContext;
    HIDPOSEMU_REPORT    report;
    NTSTATUS            status;

    if (RingPop(deviceContext, &report)) {
        *CompleteRequest = FALSE;
        return CompleteReadRequest(Request, report.Bytes, report.Length);
    }

    status = WdfRequestForwardToIoQueue(Request, deviceContext->ManualQueue);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestForwardToIoQueue failed 0x%x\n", status));
        *CompleteRequest = TRUE;
        return status;
    }

    AddPendingRead(deviceContext, TRUE);
    *CompleteRequest = FALSE;

    return status;
}

NTSTATUS
WriteReport(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    )
/*++
Routine Description:

    Handles IOCTL_HID_WRITE_REPORT, the injection path. The body of the output report is the exact
    input report to emit, including its own report id byte when the profile uses report ids.

    hidclass prefixes the buffer with the output report id exactly when the collection declares
    report ids, which is also when packet.reportId is non-zero; that prefix is not part of the
    input report and is skipped here.

--*/
{
    PDEVICE_CONTEXT     deviceContext = QueueContext->DeviceContext;
    HID_XFER_PACKET     packet;
    WDFREQUEST          readRequest;
    const UCHAR        *body;
    ULONG               bodyLength;
    ULONG               headerLength;
    NTSTATUS            status;

    status = RequestGetHidXferPacket_ToWriteToDevice(Request, &packet);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    headerLength = (packet.reportId != 0) ? 1 : 0;

    if (packet.reportBufferLen <= headerLength ||
        packet.reportBufferLen - headerLength > (ULONG)HIDPOSEMU_MAX_REPORT_BYTES) {
        KdPrint(("HidPosEmu: WriteReport: report is %d bytes, expected 1 to %d\n",
                            (int)packet.reportBufferLen, HIDPOSEMU_MAX_REPORT_BYTES));
        return STATUS_INVALID_BUFFER_SIZE;
    }

    body = packet.reportBuffer + headerLength;
    bodyLength = packet.reportBufferLen - headerLength;

    //
    // A read that is already waiting gets the report straight away; anything else goes into the
    // ring, so a scan sent before the application opened the device is not lost.
    //
    status = WdfIoQueueRetrieveNextRequest(deviceContext->ManualQueue, &readRequest);

    if (NT_SUCCESS(status)) {
        AddPendingRead(deviceContext, FALSE);
        status = CompleteReadRequest(readRequest, body, bodyLength);
    }
    else {
        RingPush(deviceContext, body, bodyLength);
        status = STATUS_SUCCESS;
    }

    if (!NT_SUCCESS(status)) {
        return status;
    }

    WdfRequestSetInformation(Request, packet.reportBufferLen);

    return STATUS_SUCCESS;
}

NTSTATUS
GetFeature(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    )
/*++
Routine Description:

    Handles IOCTL_UMDF_HID_GET_FEATURE for the status report: two bytes, the number of read
    requests hidclass currently has pending and the depth of the injection ring, each clamped to
    255. A non-zero pending read count means an application has the device open.

--*/
{
    PDEVICE_CONTEXT     deviceContext = QueueContext->DeviceContext;
    HID_XFER_PACKET     packet;
    ULONG               headerLength;
    ULONG               reportSize;
    ULONG               pendingReadCount;
    ULONG               ringCount;
    NTSTATUS            status;

    status = RequestGetHidXferPacket_ToReadFromDevice(Request, &packet);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    headerLength = (packet.reportId != 0) ? 1 : 0;
    reportSize = headerLength + HIDPOSEMU_STATUS_REPORT_SIZE;

    if (packet.reportBufferLen < reportSize) {
        KdPrint(("HidPosEmu: GetFeature: output buffer too small. Size %d, expect %d\n",
                            (int)packet.reportBufferLen, (int)reportSize));
        return STATUS_INVALID_BUFFER_SIZE;
    }

    WdfWaitLockAcquire(deviceContext->StateLock, NULL);
    pendingReadCount = deviceContext->PendingReadCount;
    ringCount = deviceContext->RingCount;
    WdfWaitLockRelease(deviceContext->StateLock);

    //
    // The output buffer is write only under UMDF, so the report id byte is left as hidclass
    // supplied it and only the two status bytes are written.
    //
    packet.reportBuffer[headerLength] = (UCHAR)(pendingReadCount > 255 ? 255 : pendingReadCount);
    packet.reportBuffer[headerLength + 1] = (UCHAR)(ringCount > 255 ? 255 : ringCount);

    WdfRequestSetInformation(Request, reportSize);

    return STATUS_SUCCESS;
}

NTSTATUS
GetStringId(
    _In_  WDFREQUEST        Request,
    _Out_ ULONG            *StringId,
    _Out_ ULONG            *LanguageId
    )
/*++
Routine Description:

    Decodes IOCTL_HID_GET_STRING and IOCTL_HID_GET_INDEXED_STRING. mshidumdf.sys passes the string
    id (or index) through the input buffer, correctly for each IOCTL buffer type.

--*/
{
    NTSTATUS                status;
    ULONG                   inputValue;
    WDFMEMORY               inputMemory;
    size_t                  inputBufferLength;
    PVOID                   inputBuffer;

    status = WdfRequestRetrieveInputMemory(Request, &inputMemory);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestRetrieveInputMemory failed 0x%x\n", status));
        return status;
    }
    inputBuffer = WdfMemoryGetBuffer(inputMemory, &inputBufferLength);

    if (inputBufferLength < sizeof(ULONG)) {
        KdPrint(("HidPosEmu: GetStringId: invalid input buffer. size %d, expect %d\n",
                            (int)inputBufferLength, (int)sizeof(ULONG)));
        return STATUS_INVALID_BUFFER_SIZE;
    }

    inputValue = (*(PULONG)inputBuffer);

    //
    // The least significant two bytes hold the string id, the most significant two the language
    // id (1033 is English).
    //
    *StringId = (inputValue & 0x0ffff);
    *LanguageId = (inputValue >> 16);

    return status;
}

static NTSTATUS
CopyStringToRequest(
    _In_  WDFREQUEST        Request,
    _In_  PCWSTR            String
    )
{
    return RequestCopyFromBuffer(Request, (PVOID)String, (wcslen(String) + 1) * sizeof(WCHAR));
}

NTSTATUS
GetIndexedString(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    )
{
    PDEVICE_CONTEXT deviceContext = QueueContext->DeviceContext;
    NTSTATUS        status;
    ULONG           languageId;
    ULONG           stringIndex;

    status = GetStringId(Request, &stringIndex, &languageId);

    UNREFERENCED_PARAMETER(languageId);

    if (!NT_SUCCESS(status)) {
        return status;
    }

    switch (stringIndex) {
    case HIDPOSEMU_STRING_INDEX_MANUFACTURER:
        return CopyStringToRequest(Request, deviceContext->Manufacturer);
    case HIDPOSEMU_STRING_INDEX_PRODUCT:
        return CopyStringToRequest(Request, deviceContext->Product);
    case HIDPOSEMU_STRING_INDEX_SERIAL:
        return CopyStringToRequest(Request, deviceContext->SerialNumber);
    default:
        KdPrint(("HidPosEmu: GetIndexedString: unknown string index %d\n", stringIndex));
        return STATUS_INVALID_PARAMETER;
    }
}

NTSTATUS
GetString(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    )
{
    PDEVICE_CONTEXT deviceContext = QueueContext->DeviceContext;
    NTSTATUS        status;
    ULONG           languageId;
    ULONG           stringId;

    status = GetStringId(Request, &stringId, &languageId);

    UNREFERENCED_PARAMETER(languageId);

    if (!NT_SUCCESS(status)) {
        return status;
    }

    switch (stringId) {
    case HID_STRING_ID_IMANUFACTURER:
        return CopyStringToRequest(Request, deviceContext->Manufacturer);
    case HID_STRING_ID_IPRODUCT:
        return CopyStringToRequest(Request, deviceContext->Product);
    case HID_STRING_ID_ISERIALNUMBER:
        return CopyStringToRequest(Request, deviceContext->SerialNumber);
    default:
        KdPrint(("HidPosEmu: GetString: unknown string id %d\n", stringId));
        return STATUS_INVALID_PARAMETER;
    }
}

NTSTATUS
RequestGetHidXferPacket_ToReadFromDevice(
    _In_  WDFREQUEST        Request,
    _Out_ HID_XFER_PACKET  *Packet
    )
/*++
Routine Description:

    The driver writes to the output buffer so the application can read from it:

      Report Buffer: Output Buffer
      Report Id    : Input Buffer

--*/
{
    NTSTATUS                status;
    WDFMEMORY               inputMemory;
    WDFMEMORY               outputMemory;
    size_t                  inputBufferLength;
    size_t                  outputBufferLength;
    PVOID                   inputBuffer;
    PVOID                   outputBuffer;

    status = WdfRequestRetrieveInputMemory(Request, &inputMemory);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestRetrieveInputMemory failed 0x%x\n", status));
        return status;
    }
    inputBuffer = WdfMemoryGetBuffer(inputMemory, &inputBufferLength);

    if (inputBufferLength < sizeof(UCHAR)) {
        KdPrint(("HidPosEmu: invalid input buffer. size %d, expect %d\n",
                            (int)inputBufferLength, (int)sizeof(UCHAR)));
        return STATUS_INVALID_BUFFER_SIZE;
    }

    Packet->reportId = *(PUCHAR)inputBuffer;

    status = WdfRequestRetrieveOutputMemory(Request, &outputMemory);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestRetrieveOutputMemory failed 0x%x\n", status));
        return status;
    }

    outputBuffer = WdfMemoryGetBuffer(outputMemory, &outputBufferLength);

    Packet->reportBuffer = (PUCHAR)outputBuffer;
    Packet->reportBufferLen = (ULONG)outputBufferLength;

    return status;
}

NTSTATUS
RequestGetHidXferPacket_ToWriteToDevice(
    _In_  WDFREQUEST        Request,
    _Out_ HID_XFER_PACKET  *Packet
    )
/*++
Routine Description:

    The driver reads from the input buffer, which the application wrote:

      Report Buffer: Input Buffer
      Report Id    : Output Buffer Length

    The report id is not stored inside the output buffer because the driver has no read access to
    it; mshidumdf.sys puts it in the output buffer length instead, which the driver can read.

    A collection that declares no report ids therefore arrives with a zero length output buffer,
    which WDF reports as STATUS_BUFFER_TOO_SMALL. That is report id 0, not a failure.

--*/
{
    NTSTATUS                status;
    WDFMEMORY               inputMemory;
    WDFMEMORY               outputMemory;
    size_t                  inputBufferLength;
    size_t                  outputBufferLength;
    PVOID                   inputBuffer;

    status = WdfRequestRetrieveOutputMemory(Request, &outputMemory);

    if (NT_SUCCESS(status)) {
        WdfMemoryGetBuffer(outputMemory, &outputBufferLength);
        Packet->reportId = (UCHAR)outputBufferLength;
    }
    else if (status == STATUS_BUFFER_TOO_SMALL) {
        //
        // The id-less case: a zero length output buffer is how mshidumdf spells report id 0, and
        // WDF refuses to hand out a zero length buffer. Failing here would break every profile
        // whose descriptor carries no Report ID item.
        //
        Packet->reportId = 0;
    }
    else {
        KdPrint(("HidPosEmu: WdfRequestRetrieveOutputMemory failed 0x%x\n", status));
        return status;
    }

    status = WdfRequestRetrieveInputMemory(Request, &inputMemory);
    if (!NT_SUCCESS(status)) {
        KdPrint(("HidPosEmu: WdfRequestRetrieveInputMemory failed 0x%x\n", status));
        return status;
    }
    inputBuffer = WdfMemoryGetBuffer(inputMemory, &inputBufferLength);

    Packet->reportBuffer = (PUCHAR)inputBuffer;
    Packet->reportBufferLen = (ULONG)inputBufferLength;

    return status;
}
