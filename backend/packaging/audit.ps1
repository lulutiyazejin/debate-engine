# Layout audit: click through tabs and screenshot each face (ASCII-only)
param([string]$OutDir = "audit")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Audit1 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[Audit1]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-Win {
  $p = Get-Process | Where-Object { $_.MainWindowTitle -like "Debate Engine*" } | Select-Object -First 1
  if (-not $p) { throw "NO-WINDOW" }
  return $p
}

function Click-At([int]$ox, [int]$oy, [bool]$fromRight) {
  $p = Get-Win
  [Audit1]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 400
  $r = New-Object Audit1+RECT
  [Audit1]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $x = if ($fromRight) { $r.Right + $ox } else { $r.Left + $ox }
  $y = $r.Top + $oy
  [Audit1]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 250
  [Audit1]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [Audit1]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 1200
}

function Shot([string]$name) {
  $p = Get-Win
  $r = New-Object Audit1+RECT
  [Audit1]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $dc = $g.GetHdc()
  [Audit1]::PrintWindow($p.MainWindowHandle, $dc, 2) | Out-Null
  $g.ReleaseHdc($dc); $g.Dispose()
  $f = Join-Path $OutDir ($name + ".png")
  $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("SHOT " + $name + " " + $w + "x" + $ht)
}

# steps: name, offx, offy, fromRight (0/1); offx/offy = -1 means no click
$steps = @(
  @("01-collection", -1, -1, 0),
  @("02-graph-force", 113, 146, 0),
  @("03-graph-cube", 143, 201, 0),
  @("04-scatter", 239, 201, 0),
  @("05-radar", 339, 201, 0),
  @("06-xtab", 438, 201, 0),
  @("07-logic", 189, 146, 0),
  @("08-timeline", 263, 146, 0),
  @("09-compare", 331, 146, 0),
  @("10-archive", 399, 146, 0),
  @("11-respond", 310, 24, 0),
  @("12-settings", -219, 24, 1)
)
foreach ($s in $steps) {
  if ([int]$s[1] -ge 0 -or [int]$s[3] -eq 1) { Click-At ([int]$s[1]) ([int]$s[2]) ([int]$s[3] -eq 1) }
  Start-Sleep -Milliseconds 700
  Shot $s[0]
}
Write-Output "AUDIT-DONE"
