# Third party code in `driver/`

`hidposemu.c`, `hidposemu.h`, `HidPosEmu.inx`, `HidPosEmu.rc`, `HidPosEmu.vcxproj` and
`HidPosEmu.vcxproj.filters` are derived from the Microsoft Windows driver samples:

- Source: <https://github.com/microsoft/Windows-driver-samples>, sample `hid/vhidmini2`
- Files used: `driver/vhidmini.c`, `driver/vhidmini.h`, `driver/umdf2/util.c`,
  `driver/umdf2/VhidminiUm.inx`, `driver/umdf2/vhidmini.rc`, `driver/umdf2/VhidminiUm.vcxproj`
  and `driver/umdf2/VhidminiUm.vcxproj.Filters`
- Copyright (c) Microsoft Corporation. All rights reserved.

The repository states its license in its `LICENSE` file as the **Microsoft Public License (MS-PL)**,
not MIT. MS-PL section 3(D) requires that source distributions of any portion of the software carry
a complete copy of the license, so the full text is reproduced below and the Microsoft copyright
headers are kept in the derived files.

## What was changed

- Every device attribute is read from device properties in `EvtDeviceAdd` instead of being
  compiled in, and the registry descriptor path of the sample was dropped.
- The periodic timer that faked input reports was removed. Input reports arrive through
  `IOCTL_HID_WRITE_REPORT` and are either handed to a pending read or queued in a ring.
- `IOCTL_UMDF_HID_GET_FEATURE` reports driver status instead of the sample's device attributes;
  `SET_FEATURE`, `GET_INPUT_REPORT` and `SET_OUTPUT_REPORT` return `STATUS_NOT_SUPPORTED`.
- The string IOCTLs return the per-device strings, indexed 1 to 3.
- The `_KERNEL_MODE` branches were dropped; this driver is UMDF 2 only.

## Microsoft Public License (MS-PL)

Copyright (c) 2015 Microsoft

This license governs use of the accompanying software. If you use the software, you accept this
license. If you do not accept the license, do not use the software.

1. Definitions

The terms "reproduce," "reproduction," "derivative works," and "distribution" have the same meaning
here as under U.S. copyright law. A "contribution" is the original software, or any additions or
changes to the software. A "contributor" is any person that distributes its contribution under this
license. "Licensed patents" are a contributor's patent claims that read directly on its
contribution.

2. Grant of Rights

(A) Copyright Grant- Subject to the terms of this license, including the license conditions and
limitations in section 3, each contributor grants you a non-exclusive, worldwide, royalty-free
copyright license to reproduce its contribution, prepare derivative works of its contribution, and
distribute its contribution or any derivative works that you create.

(B) Patent Grant- Subject to the terms of this license, including the license conditions and
limitations in section 3, each contributor grants you a non-exclusive, worldwide, royalty-free
license under its licensed patents to make, have made, use, sell, offer for sale, import, and/or
otherwise dispose of its contribution in the software or derivative works of the contribution in
the software.

3. Conditions and Limitations

(A) No Trademark License- This license does not grant you rights to use any contributors' name,
logo, or trademarks.

(B) If you bring a patent claim against any contributor over patents that you claim are infringed
by the software, your patent license from such contributor to the software ends automatically.

(C) If you distribute any portion of the software, you must retain all copyright, patent, trademark,
and attribution notices that are present in the software.

(D) If you distribute any portion of the software in source code form, you may do so only under this
license by including a complete copy of this license with your distribution. If you distribute any
portion of the software in compiled or object code form, you may only do so under a license that
complies with this license.

(E) The software is licensed "as-is." You bear the risk of using it. The contributors give no
express warranties, guarantees or conditions. You may have additional consumer rights under your
local laws which this license cannot change. To the extent permitted under your local laws, the
contributors exclude the implied warranties of merchantability, fitness for a particular purpose and
non-infringement.
