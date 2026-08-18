param([int]$OffX = -34, [int]$OffY = 64, [switch]$FromRight)
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Click3 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "Debate Engine*" } | Select-Object -First 1
if (-not $proc) { Write-Output "NO-WINDOW"; exit 1 }
[Click3]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600
$r = New-Object Click3+RECT
[Click3]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
$x = $r.Right + $OffX
$y = $r.Top + $OffY
if (-not $FromRight) { $x = $r.Left + $OffX }
[Click3]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 300
[Click3]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)   # LEFTDOWN
[Click3]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)   # LEFTUP
Start-Sleep -Milliseconds 800
$proc.Refresh()
Write-Output ("clicked ($x,$y) title now: " + $proc.MainWindowTitle)
