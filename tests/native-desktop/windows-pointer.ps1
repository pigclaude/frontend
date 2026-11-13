# 通过运行器的 Windows 桌面发送原生鼠标和键盘输入。
param([string]$Action, [string]$First = "", [string]$Second = "", [string]$Third = "", [string]$Fourth = "")
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativePointer {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][NativePointer]::SetProcessDPIAware()
function Move-Pointer([int]$X, [int]$Y) {
    if (![NativePointer]::SetCursorPos($X, $Y)) { throw "无法在 Windows 桌面定位鼠标" }
}
function Press-Mouse([uint32]$Flag, [uint32]$Data = 0) {
    [NativePointer]::mouse_event($Flag, 0, 0, $Data, [UIntPtr]::Zero)
}
switch ($Action) {
    "click" {
        Move-Pointer $First $Second
        Press-Mouse 2
        Press-Mouse 4
    }
    "drag" {
        Move-Pointer $First $Second
        Press-Mouse 2
        Start-Sleep -Milliseconds 125
        for ($step = 1; $step -le 8; $step++) {
            Move-Pointer ([int]$First + ([int]$Third - [int]$First) * $step / 8) ([int]$Second + ([int]$Fourth - [int]$Second) * $step / 8)
            Start-Sleep -Milliseconds 30
        }
        Press-Mouse 4
    }
    "key" {
        $keys = @{ Down = 0x28; Return = 0x0D; Escape = 0x1B }
        $key = $keys[$First]
        [NativePointer]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
        [NativePointer]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
    }
    "back" {
        Move-Pointer $First $Second
        Press-Mouse 0x80 1
        Press-Mouse 0x100 1
    }
    "forward" {
        Move-Pointer $First $Second
        Press-Mouse 0x80 2
        Press-Mouse 0x100 2
    }
    "capture" {
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $bitmap.Save($First, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
    default { throw "未知原生输入：$Action" }
}
