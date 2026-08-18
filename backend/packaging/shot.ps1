param([string]$Out = "shot.png", [int]$WaitSec = 25)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinShot3 {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$deadline = (Get-Date).AddSeconds($WaitSec)
$proc = $null
while ((Get-Date) -lt $deadline) {
  $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "Debate Engine*" } | Select-Object -First 1
  if ($proc) { break }
  Start-Sleep -Milliseconds 800
}
if (-not $proc) { Write-Output "NO-WINDOW"; exit 1 }
Write-Output ("TITLE: " + $proc.MainWindowTitle)
Start-Sleep -Seconds 3
$h = $proc.MainWindowHandle
$r = New-Object WinShot3+RECT
[WinShot3]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[WinShot3]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("SAVED: " + (Resolve-Path $Out) + " " + $w + "x" + $ht)
