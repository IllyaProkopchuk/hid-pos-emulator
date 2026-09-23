<#
Enumerates GUID_DEVINTERFACE_HID the way an application such as Chrome does, and reports for each
interface what WebHID would surface: vendor id, product id, product name, serial number and the
top level collection's usage page and usage.
#>

Add-Type -Namespace HidProbe -Name Native -MemberDefinition @'
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

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    public static extern bool CloseHandle(System.IntPtr handle);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_GetAttributes(System.IntPtr handle, ref HIDD_ATTRIBUTES attributes);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_GetProductString(System.IntPtr handle, byte[] buffer, int length);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_GetSerialNumberString(System.IntPtr handle, byte[] buffer, int length);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_GetPreparsedData(System.IntPtr handle, out System.IntPtr preparsed);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern bool HidD_FreePreparsedData(System.IntPtr preparsed);

    [System.Runtime.InteropServices.DllImport("hid.dll")]
    public static extern int HidP_GetCaps(System.IntPtr preparsed, byte[] caps);

    public static string[] Enumerate(string filter) {
        System.Guid hid;
        HidD_GetHidGuid(out hid);

        System.IntPtr set = SetupDiGetClassDevs(ref hid, System.IntPtr.Zero, System.IntPtr.Zero, 0x12);
        System.Collections.Generic.List<string> found = new System.Collections.Generic.List<string>();

        SP_DEVICE_INTERFACE_DATA data = new SP_DEVICE_INTERFACE_DATA();
        data.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(data);

        for (uint i = 0; SetupDiEnumDeviceInterfaces(set, System.IntPtr.Zero, ref hid, i, ref data); i++) {
            uint required = 0;
            SetupDiGetDeviceInterfaceDetail(set, ref data, System.IntPtr.Zero, 0, out required, System.IntPtr.Zero);

            System.IntPtr detail = System.Runtime.InteropServices.Marshal.AllocHGlobal((int)required);
            System.Runtime.InteropServices.Marshal.WriteInt32(detail, System.IntPtr.Size == 8 ? 8 : 6);

            string path = null;

            if (SetupDiGetDeviceInterfaceDetail(set, ref data, detail, required, out required, System.IntPtr.Zero)) {
                path = System.Runtime.InteropServices.Marshal.PtrToStringUni(new System.IntPtr(detail.ToInt64() + 4));
            }

            System.Runtime.InteropServices.Marshal.FreeHGlobal(detail);

            if (path == null || path.ToLower().IndexOf(filter.ToLower()) < 0) { continue; }

            // 0 desired access: enough to read attributes and capabilities, same as an enumerator does.
            System.IntPtr handle = CreateFileW(path, 0, 3, System.IntPtr.Zero, 3, 0, System.IntPtr.Zero);

            if (handle.ToInt64() == -1) {
                found.Add(path + "|OPEN FAILED " + System.Runtime.InteropServices.Marshal.GetLastWin32Error());
                continue;
            }

            HIDD_ATTRIBUTES attributes = new HIDD_ATTRIBUTES();
            attributes.Size = System.Runtime.InteropServices.Marshal.SizeOf(attributes);
            HidD_GetAttributes(handle, ref attributes);

            byte[] product = new byte[512];
            byte[] serial = new byte[512];
            HidD_GetProductString(handle, product, product.Length);
            HidD_GetSerialNumberString(handle, serial, serial.Length);

            string usagePage = "?", usage = "?", lengths = "?";
            System.IntPtr preparsed;

            if (HidD_GetPreparsedData(handle, out preparsed)) {
                byte[] caps = new byte[256];

                if (HidP_GetCaps(preparsed, caps) == 0x00110000) {
                    usage     = "0x" + System.BitConverter.ToUInt16(caps, 0).ToString("x");
                    usagePage = "0x" + System.BitConverter.ToUInt16(caps, 2).ToString("x");
                    lengths   = System.BitConverter.ToUInt16(caps, 4) + "/" +
                                System.BitConverter.ToUInt16(caps, 6) + "/" +
                                System.BitConverter.ToUInt16(caps, 8);
                }

                HidD_FreePreparsedData(preparsed);
            }

            CloseHandle(handle);

            found.Add(string.Join("|", new string[] {
                path,
                "0x" + attributes.VendorID.ToString("x4"),
                "0x" + attributes.ProductID.ToString("x4"),
                System.Text.Encoding.Unicode.GetString(product).TrimEnd('\0'),
                System.Text.Encoding.Unicode.GetString(serial).TrimEnd('\0'),
                usagePage,
                usage,
                lengths
            }));
        }

        SetupDiDestroyDeviceInfoList(set);

        return found.ToArray();
    }
'@

$rows = [HidProbe.Native]::Enumerate('hidposemu')

if ($rows.Count -eq 0) {
    Write-Host 'No HidPosEmu HID interface found.'
    return
}

foreach ($row in $rows) {
    $f = $row -split '\|'

    if ($f.Count -lt 8) { Write-Host $row; continue }

    Write-Host ''
    Write-Host ('  productName  : {0}' -f $f[3])
    Write-Host ('  vendorId     : {0}' -f $f[1])
    Write-Host ('  productId    : {0}' -f $f[2])
    Write-Host ('  serialNumber : {0}' -f $f[4])
    Write-Host ('  usagePage    : {0}' -f $f[5])
    Write-Host ('  usage        : {0}' -f $f[6])
    Write-Host ('  in/out/feat  : {0}' -f $f[7])
    Write-Host ('  path         : {0}' -f $f[0])
}
