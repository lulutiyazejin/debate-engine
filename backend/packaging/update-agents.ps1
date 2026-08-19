# ASCII-only logic (PS5.1 reads BOM-less ps1 as ANSI; Chinese lives in agents-section.txt)
$ErrorActionPreference = "Stop"
$p = Join-Path $env:USERPROFILE ".qoder\rules\AGENTS.md"
$secPath = "C:\Users\Administrator\Documents\Qoder\2026-08-17\chat-3\backend\packaging\agents-section.txt"
$utf8 = New-Object System.Text.UTF8Encoding $false
$sec = [System.IO.File]::ReadAllText($secPath, $utf8)
$c = [System.IO.File]::ReadAllText($p, $utf8)
$s = $c.IndexOf("npm run tauri build")
if ($s -lt 0) { "start marker not found"; exit 1 }
$ls = $c.LastIndexOf("`n", $s) + 1
$be = $c.IndexOf("`n> ")
if ($be -lt 0) { "end marker not found"; exit 1 }
$be = $be + 1
$c2 = $c.Substring(0, $ls) + $sec + $c.Substring($be)
[System.IO.File]::WriteAllText($p, $c2, $utf8)
"AGENTS.md updated"
