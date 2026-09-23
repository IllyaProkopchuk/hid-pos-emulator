/*++

Copyright (C) Microsoft Corporation, All Rights Reserved.

Module Name:

    hidposemu.h

Abstract:

    Type definitions for the HidPosEmu UMDF 2 HID minidriver. Derived from the Windows driver
    sample hid/vhidmini2 (driver/vhidmini.h); see THIRD_PARTY.md.

Environment:

    Windows Driver Framework (WDF), user mode

--*/

#pragma once

#include <windows.h>
#include <string.h>

#include <wdf.h>
#include <hidport.h>

#include "properties.h"

typedef UCHAR HID_REPORT_DESCRIPTOR, *PHID_REPORT_DESCRIPTOR;

DRIVER_INITIALIZE                       DriverEntry;
EVT_WDF_DRIVER_DEVICE_ADD               EvtDeviceAdd;
EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL      EvtIoDeviceControl;
EVT_WDF_IO_QUEUE_IO_CANCELED_ON_QUEUE   EvtIoCanceledOnQueue;

//
// One input report as it goes on the wire, including its report id byte when the profile uses
// report ids. The driver never looks inside; it only stores and re-emits the bytes.
//
typedef struct _HIDPOSEMU_REPORT
{
    ULONG                   Length;
    UCHAR                   Bytes[HIDPOSEMU_MAX_REPORT_BYTES];

} HIDPOSEMU_REPORT, *PHIDPOSEMU_REPORT;

typedef struct _DEVICE_CONTEXT
{
    WDFDEVICE               Device;
    WDFQUEUE                DefaultQueue;
    WDFQUEUE                ManualQueue;

    //
    // Guards the ring and the two counters below. UMDF callbacks all run at passive level, so a
    // wait lock is the right primitive.
    //
    WDFWAITLOCK             StateLock;

    HID_DEVICE_ATTRIBUTES   HidDeviceAttributes;
    HID_DESCRIPTOR          HidDescriptor;

    UCHAR                   ReportDescriptor[HIDPOSEMU_MAX_REPORT_DESCRIPTOR];
    USHORT                  ReportDescriptorLength;

    WCHAR                   Manufacturer[HIDPOSEMU_MAX_STRING_CCH + 1];
    WCHAR                   Product[HIDPOSEMU_MAX_STRING_CCH + 1];
    WCHAR                   SerialNumber[HIDPOSEMU_MAX_STRING_CCH + 1];

    //
    // Reports injected while no read request was pending, oldest at RingHead.
    //
    HIDPOSEMU_REPORT        Ring[HIDPOSEMU_RING_ENTRIES];
    ULONG                   RingHead;
    ULONG                   RingCount;

    //
    // IOCTL_HID_READ_REPORT requests parked in ManualQueue. hidclass keeps read requests pending
    // only while some client handle is open, so a non-zero count means an application is reading.
    //
    ULONG                   PendingReadCount;

} DEVICE_CONTEXT, *PDEVICE_CONTEXT;

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(DEVICE_CONTEXT, GetDeviceContext);

typedef struct _QUEUE_CONTEXT
{
    WDFQUEUE                Queue;
    PDEVICE_CONTEXT         DeviceContext;

} QUEUE_CONTEXT, *PQUEUE_CONTEXT;

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(QUEUE_CONTEXT, GetQueueContext);

typedef struct _MANUAL_QUEUE_CONTEXT
{
    WDFQUEUE                Queue;
    PDEVICE_CONTEXT         DeviceContext;

} MANUAL_QUEUE_CONTEXT, *PMANUAL_QUEUE_CONTEXT;

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(MANUAL_QUEUE_CONTEXT, GetManualQueueContext);

NTSTATUS
QueueCreate(
    _In_  WDFDEVICE         Device,
    _Out_ WDFQUEUE          *Queue
    );

NTSTATUS
ManualQueueCreate(
    _In_  WDFDEVICE         Device,
    _Out_ WDFQUEUE          *Queue
    );

NTSTATUS
ReadDeviceProperties(
    _In_  WDFDEVICE         Device
    );

NTSTATUS
ReadReport(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request,
    _Always_(_Out_)
          BOOLEAN*          CompleteRequest
    );

NTSTATUS
WriteReport(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    );

NTSTATUS
GetFeature(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    );

NTSTATUS
GetString(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    );

NTSTATUS
GetIndexedString(
    _In_  PQUEUE_CONTEXT    QueueContext,
    _In_  WDFREQUEST        Request
    );

NTSTATUS
GetStringId(
    _In_  WDFREQUEST        Request,
    _Out_ ULONG            *StringId,
    _Out_ ULONG            *LanguageId
    );

NTSTATUS
RequestCopyFromBuffer(
    _In_  WDFREQUEST        Request,
    _In_  PVOID             SourceBuffer,
    _When_(NumBytesToCopyFrom == 0, __drv_reportError(NumBytesToCopyFrom cannot be zero))
    _In_  size_t            NumBytesToCopyFrom
    );

NTSTATUS
RequestGetHidXferPacket_ToReadFromDevice(
    _In_  WDFREQUEST        Request,
    _Out_ HID_XFER_PACKET  *Packet
    );

NTSTATUS
RequestGetHidXferPacket_ToWriteToDevice(
    _In_  WDFREQUEST        Request,
    _Out_ HID_XFER_PACKET  *Packet
    );
