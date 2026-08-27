# ASCII-only logic (PS5.1 reads BOM-less ps1 as ANSI; Chinese lives in txt)
# Insert resource-premise section right after AGENTS.md frontmatter + intro lines.
$ErrorActionPreference = "Stop"
$p = Join-Path $env:USERPROFILE ".qoder\rules\AGENTS.md"
$secPath = Join-Path $PSScriptRoot "agents-resource-section.txt"
$utf8 = New-Object System.Text.UTF8Encoding $false
$sec = [System.IO.File]::ReadAllText($secPath, $utf8)
$c = [System.IO.File]::ReadAllText($p, $utf8)
$firstLine = ($sec -split "`n")[0].Trim()
if ($c.Contains($firstLine)) { "already present, skip"; exit 0 }
$marker = "##"
$i = $c.IndexOf($marker, 10)   # first section heading after frontmatter
if ($i -lt 0) { "marker not found"; exit 1 }
$c2 = $c.Substring(0, $i) + $sec + "`n" + $c.Substring($i)
[System.IO.File]::WriteAllText($p, $c2, $utf8)
"AGENTS.md updated"
