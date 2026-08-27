# Settings sections audit: open settings, click each nav item, screenshot (ASCII-only)
param([string]$OutDir = "audit2")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Audit2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[Audit2]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-Win {
  $p = Get-Process | Where-Object { $_.MainWindowTitle -like "Debate Engine*" } | Select-Object -First 1
  if (-not $p) { throw "NO-WINDOW" }
  return $p
}
function Click-At([int]$ox, [int]$oy, [bool]$fromRight) {
  $p = Get-Win
  [Audit2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 400
  $r = New-Object Audit2+RECT
  [Audit2]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $x = if ($fromRight) { $r.Right + $ox } else { $r.Left + $ox }
  $y = $r.Top + $oy
  [Audit2]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 250
  [Audit2]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [Audit2]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 900
}
function Shot([string]$name) {
  $p = Get-Win
  $r = New-Object Audit2+RECT
  [Audit2]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $dc = $g.GetHdc()
  [Audit2]::PrintWindow($p.MainWindowHandle, $dc, 2) | Out-Null
  $g.ReleaseHdc($dc); $g.Dispose()
  $f = Join-Path $OutDir ($name + ".png")
  $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("SHOT " + $name + " " + $w + "x" + $ht)
}

# open settings via top-right gear (window-right relative)
Click-At -219 24 $true
Start-Sleep -Milliseconds 800

# nav items: window-left relative x=328, y per 12-settings reference shot
$sections = @(
  @("s01-providers", 184), @("s02-localmodel", 227), @("s03-components", 269),
  @("s04-network", 312), @("s05-tasks", 354), @("s06-genretrieval", 397),
  @("s07-kb", 439), @("s08-stancemgr", 482), @("s09-kbfiles", 524),
  @("s10-fonts", 567), @("s11-diagnostics", 610), @("s12-ui", 652),
  @("s13-about", 694)
)
foreach ($s in $sections) {
  Click-At 328 ([int]$s[1]) $false
  Start-Sleep -Milliseconds 600
  Shot $s[0]
}
Write-Output "AUDIT2-DONE"
