/*++

Module Name:

    properties.h

Abstract:

    Device property keys and limits shared by the HidPosEmu driver and HidPosEmuSvc. The service
    sets these properties in SwDeviceCreate, the driver reads them back in EvtDeviceAdd, so both
    sides must agree on the key set - hence one header, included by both projects.

--*/

#pragma once

#include <devpropdef.h>

//
// {7B0F3C4E-6D2A-4E7B-9C1F-2A8D5B6E1F03} - HidPosEmu device property set.
//
// One driver serves every scanner profile: vendor ids, strings and the report descriptor arrive
// per device instead of being compiled in, so a new profile needs no driver rebuild.
//
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_VendorId,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 2);     // DEVPROP_TYPE_UINT16
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_ProductId,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 3);     // DEVPROP_TYPE_UINT16
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_VersionNumber,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 4);     // DEVPROP_TYPE_UINT16
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_Manufacturer,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 5);     // DEVPROP_TYPE_STRING
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_Product,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 6);     // DEVPROP_TYPE_STRING
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_SerialNumber,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 7);     // DEVPROP_TYPE_STRING
DEFINE_DEVPROPKEY(DEVPKEY_HidPosEmu_ReportDescriptor,
    0x7b0f3c4e, 0x6d2a, 0x4e7b, 0x9c, 0x1f, 0x2a, 0x8d, 0x5b, 0x6e, 0x1f, 0x03, 8);     // DEVPROP_TYPE_BINARY

//
// Hardware id the INF matches; the service passes the same string in pszzHardwareIds.
//
#define HIDPOSEMU_HARDWARE_ID           L"HidPosEmu\\Scanner"
#define HIDPOSEMU_ENUMERATOR_NAME       L"HidPosEmu"

//
// USB string descriptors are limited to 126 characters, and the HID string IOCTLs inherit that
// limit; the strings are stored in the device context, so the cap is also the buffer size.
//
#define HIDPOSEMU_MAX_STRING_CCH        126

//
// A HID report descriptor for one scanner collection is well under this; the cap keeps the device
// context a fixed size and bounds what an untrusted property value can allocate.
//
#define HIDPOSEMU_MAX_REPORT_DESCRIPTOR 512

//
// One input report on the wire: at most a report id byte plus 64 report bytes.
//
#define HIDPOSEMU_MAX_REPORT_BYTES      65

//
// Input reports emitted while no application is reading are held here; 32 covers the longest
// scan the host can produce several times over.
//
#define HIDPOSEMU_RING_ENTRIES          32

//
// HID string indices for IOCTL_HID_GET_INDEXED_STRING, mirroring iManufacturer / iProduct /
// iSerialNumber of a USB device descriptor.
//
#define HIDPOSEMU_STRING_INDEX_MANUFACTURER 1
#define HIDPOSEMU_STRING_INDEX_PRODUCT      2
#define HIDPOSEMU_STRING_INDEX_SERIAL       3
