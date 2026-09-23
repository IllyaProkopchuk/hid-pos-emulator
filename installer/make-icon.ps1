<#
.SYNOPSIS
    Writes the shortcut icon: host\public\favicon.svg redrawn as a Windows .ico.

.DESCRIPTION
    A shortcut cannot use an SVG and Windows has no SVG renderer to call from here, so the favicon's
    stripes are drawn again with System.Drawing, at the sizes Explorer asks for. Keep the shapes in
    step with favicon.svg; the coordinates below are its own, on the same 32 by 32 grid.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Path
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

# Each stripe from favicon.svg: x at the top, width, and how far the bottom edge leans left.
$stripes = @(
    @(3.4, 3.1, 0.8), @(8.4, 1.5, 0.5), @(11.8, 3.8, 0.9), @(17.6, 1.3, 0.4),
    @(20.8, 2.6, 0.7), @(25.4, 1.1, 0.3), @(28.6, 2.4, 0.6)
)
$sizes = @(16, 24, 32, 48, 256)

function New-IconImage([int]$size) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 32, $size / 32)

    # The rounded square, rx 7, that clips everything as in the SVG.
    $corner = New-Object System.Drawing.Drawing2D.GraphicsPath
    $corner.AddArc(0, 0, 14, 14, 180, 90)
    $corner.AddArc(18, 0, 14, 14, 270, 90)
    $corner.AddArc(18, 18, 14, 14, 0, 90)
    $corner.AddArc(0, 18, 14, 14, 90, 90)
    $corner.CloseFigure()

    $graphics.SetClip($corner)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#14161a'))), $corner)

    $stripeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#eef0f3'))

    foreach ($stripe in $stripes) {
        $x, $width, $lean = $stripe
        $graphics.FillPolygon($stripeBrush, [System.Drawing.PointF[]]@(
            (New-Object System.Drawing.PointF ([single]$x), -1),
            (New-Object System.Drawing.PointF ([single]($x + $width)), -1),
            (New-Object System.Drawing.PointF ([single]($x + $width - $lean)), 33),
            (New-Object System.Drawing.PointF ([single]($x - $lean)), 33)
        ))
    }

    $graphics.Dispose()

    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()

    return , $stream.ToArray()
}

# ICO: a 6 byte header, a 16 byte entry per image, then the images, here PNG, which Windows Vista
# and later accept at every size.
$images = foreach ($size in $sizes) { , (New-IconImage $size) }
$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $output

$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count

for ($index = 0; $index -lt $sizes.Count; $index++) {
    $size = $sizes[$index]
    $bytes = $images[$index]

    # 256 is written as 0: the field is one byte.
    $writer.Write([byte]($size % 256))
    $writer.Write([byte]($size % 256))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$bytes.Length)
    $writer.Write([uint32]$offset)

    $offset += $bytes.Length
}

foreach ($bytes in $images) {
    $writer.Write([byte[]]$bytes)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($Path, $output.ToArray())
$writer.Dispose()
