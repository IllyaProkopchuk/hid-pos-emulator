<#
Opens the Newland emulator's HID interface for reading, exactly as an application does after
device.open(), and prints the first input report that arrives. A GENERIC_READ handle is what makes
hidclass keep a read pending on the driver, so this is the same path a WebHID app uses.
#>

Add-Type -Namespace HidRead -Name Native -MemberDefinition @'
    public struct SP_DEVICE_INTERFACE_DATA {
        public int cbSize;
        public System.Guid InterfaceClassGuid;
        public int Flags;
        public System.IntPtr Reserved;
    }

    public struct HIDD_ATTRIBUTES {
        public int Size;
        public ushort VendorID;
        public ushort ProductID;
        public ushort VersionNumber;
    }

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern void HidD_GetHidGuid(out System.Guid guid);

    [System.Runtime.InteropServices.DllImport("setupapi.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    public static extern System.IntPtr SetupDiGetClassDevs(ref System.Guid guid, System.IntPtr enumerator, System.IntPtr parent, uint flags);

    [System.Runtime.InteropServices.DllImport("setupapi.dll")]
    public static extern bool SetupDiEnumDeviceInterfaces(System.IntPtr set, System.IntPtr devInfo, ref System.Guid guid, uint index, ref SP_DEVICE_INTERFACE_DATA data);

    [System.Runtime.InteropServices.DllImport("setupapi.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    public static extern bool SetupDiGetDeviceInterfaceDetail(System.IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, System.IntPtr detail, uint detailSize, out uint required, System.IntPtr devInfoData);

    [System.Runtime.InteropServices.DllImport("setupapi.dll")]
    public static extern bool SetupDiDestroyDeviceInfoList(System.IntPtr set);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    public static extern System.IntPtr CreateFileW(string name, uint access, uint share, System.IntPtr security, uint disposition, uint flags, System.IntPtr template);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadFile(System.IntPtr handle, byte[] buffer, uint toRead, out uint read, System.IntPtr overlapped);

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    public static extern bool CloseHandle(System.IntPtr handle);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_GetAttributes(System.IntPtr handle, ref HIDD_ATTRIBUTES attributes);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_GetPreparsedData(System.IntPtr handle, out System.IntPtr preparsed);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_FreePreparsedData(System.IntPtr preparsed);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern int HidP_GetCaps(System.IntPtr preparsed, byte[] caps);

    public static string FindPath(ushort vendorId) {
        System.Guid hid;
        HidD_GetHidGuid(out hid);

        System.IntPtr set = SetupDiGetClassDevs(ref hid, System.IntPtr.Zero, System.IntPtr.Zero, 0x12);

        SP_DEVICE_INTERFACE_DATA data = new SP_DEVICE_INTERFACE_DATA();
        data.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(data);

        string match = null;

        for (uint i = 0; match == null && SetupDiEnumDeviceInterfaces(set, System.IntPtr.Zero, ref hid, i, ref data); i++) {
            uint required = 0;
            SetupDiGetDeviceInterfaceDetail(set, ref data, System.IntPtr.Zero, 0, out required, System.IntPtr.Zero);

            System.IntPtr detail = System.Runtime.InteropServices.Marshal.AllocHGlobal((int)required);
            System.Runtime.InteropServices.Marshal.WriteInt32(detail, System.IntPtr.Size == 8 ? 8 : 6);

            string path = null;

            if (SetupDiGetDeviceInterfaceDetail(set, ref data, detail, required, out required, System.IntPtr.Zero)) {
                path = System.Runtime.InteropServices.Marshal.PtrToStringUni(new System.IntPtr(detail.ToInt64() + 4));
            }

            System.Runtime.InteropServices.Marshal.FreeHGlobal(detail);

            if (path == null || path.ToLower().IndexOf("hidposemu") < 0) { continue; }

            System.IntPtr probe = CreateFileW(path, 0, 3, System.IntPtr.Zero, 3, 0, System.IntPtr.Zero);

            if (probe.ToInt64() == -1) { continue; }

            HIDD_ATTRIBUTES attributes = new HIDD_ATTRIBUTES();
            attributes.Size = System.Runtime.InteropServices.Marshal.SizeOf(attributes);

            if (HidD_GetAttributes(probe, ref attributes) && attributes.VendorID == vendorId) { match = path; }

            CloseHandle(probe);
        }

        SetupDiDestroyDeviceInfoList(set);

        return match;
    }
'@

$vendorId = if ($args.Count -gt 0) { [uint16]$args[0] } else { [uint16]0x1eab }
$reportCount = if ($args.Count -gt 1) { [int]$args[1] } else { 1 }

$path = [HidRead.Native]::FindPath($vendorId)

if (-not $path) { Write-Host 'newland interface not found'; exit 1 }

Write-Host "opening $path"

# GENERIC_READ, share read/write, OPEN_EXISTING. Written as a decimal cast because PowerShell 5.1
# parses 0x80000000 as a negative Int32, which will not convert to the UInt32 the API wants.
$genericRead = [uint32]2147483648
$handle = [HidRead.Native]::CreateFileW($path, $genericRead, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)

if ($handle.ToInt64() -eq -1) {
    Write-Host ('open failed, win32 {0}' -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())
    exit 1
}

# ReadFile on a HID device wants exactly InputReportByteLength bytes, and that differs per profile:
# 64 where the descriptor declares report ids, 65 where it does not and the id byte is a leading 0.
$preparsed = [IntPtr]::Zero
$inputLength = 0

if ([HidRead.Native]::HidD_GetPreparsedData($handle, [ref]$preparsed)) {
    $caps = New-Object byte[] 256

    if ([HidRead.Native]::HidP_GetCaps($preparsed, $caps) -eq 0x00110000) {
        $inputLength = [BitConverter]::ToUInt16($caps, 4)
    }

    [HidRead.Native]::HidD_FreePreparsedData($preparsed) | Out-Null
}

if ($inputLength -eq 0) { Write-Host 'could not read input report length'; exit 1 }

Write-Host ('handle open, input report is {0} bytes, waiting...' -f $inputLength)

for ($n = 1; $n -le $reportCount; $n++) {
    $buffer = New-Object byte[] $inputLength
    $read = 0

    if (-not [HidRead.Native]::ReadFile($handle, $buffer, $inputLength, [ref]$read, [IntPtr]::Zero)) {
        Write-Host ('read {0} failed, win32 {1}' -f $n, [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        [HidRead.Native]::CloseHandle($handle) | Out-Null
        exit 1
    }

    # Everything printable is shown as itself, everything else as a dot, so a frame can be read at
    # a glance without deciding in advance where the length byte or the terminator sit.
    $printable = -join ($buffer | ForEach-Object {
        if ($_ -ge 0x20 -and $_ -lt 0x7f) { [char]$_ } else { '.' }
    })

    $trimmed = $buffer.Length
    while ($trimmed -gt 1 -and $buffer[$trimmed - 1] -eq 0) { $trimmed-- }

    Write-Host ''
    Write-Host ('--- report {0} of {1} ---' -f $n, $reportCount)
    Write-Host ('bytes read : {0}' -f $read)
    Write-Host ('reportId   : {0}' -f $buffer[0])
    Write-Host ('payload    : {0} bytes before the zero padding' -f ($trimmed - 1))
    Write-Host ('hex        : {0}' -f (($buffer[0..([Math]::Min($trimmed, 40) - 1)] | ForEach-Object { '{0:x2}' -f $_ }) -join ' '))
    Write-Host ('ascii      : {0}' -f $printable.Substring(0, [Math]::Min($trimmed, 60)))
}

[HidRead.Native]::CloseHandle($handle) | Out-Null
