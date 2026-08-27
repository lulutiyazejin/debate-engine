# S1b: coordinate-zero root cause probe (ASCII-only). Imports test doc, checks preview coordinates, deletes.
$ErrorActionPreference = "Continue"
$base = "http://127.0.0.1:7700"
$wd = Split-Path -Parent $PSScriptRoot  # backend dir

Write-Output "=== restart source serve on real KB ==="
Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*chat-3*" } | Stop-Process -Force
Start-Sleep -Seconds 2
$env:KB_PATH = "Z:\DebateEngine\knowledge_base"
Start-Process -FilePath "$wd\.venv\Scripts\python.exe" -ArgumentList "cli.py","serve" -WorkingDirectory $wd -WindowStyle Hidden
Start-Sleep -Seconds 10
$h = Invoke-RestMethod "$base/api/health" -TimeoutSec 8
Write-Output ("docs=" + $h.sqlite.documents + " deepseek=" + $h.providers.deepseek)

Write-Output "=== import preview: check coordinates ==="
$doc = "$PSScriptRoot\test-coord-018.txt"
$text = "This essay argues that market economies concentrate wealth upward. " * 6 + "`r`n`r`n" +
        "Evidence shows monopoly capital captures regulatory bodies over time. " * 6 + "`r`n`r`n" +
        "Therefore workers must organize independent unions to bargain collectively. " * 6
Set-Content -Path $doc -Value $text -Encoding UTF8
$body = @{ source = $doc; summary_strategy = "auto" } | ConvertTo-Json
$body | Set-Content -Path "$PSScriptRoot\coord-req.json" -Encoding UTF8
curl.exe -s -X POST "$base/api/import" -H "Content-Type: application/json" --data "@$PSScriptRoot\coord-req.json" -o "$PSScriptRoot\coord-preview.json"
& "$wd\.venv\Scripts\python.exe" -c @"
import json
d = json.load(open(r'$PSScriptRoot\coord-preview.json', encoding='utf-8'))
print('keys:', sorted(d.keys())[:20])
doc_id = d.get('doc_id','')
print('doc_id:', doc_id)
coords = d.get('coordinates') or (d.get('classification') or {}).get('coordinates') or {}
nz = {k:v for k,v in coords.items() if isinstance(v,(int,float)) and v != 0}
print('coord_keys:', len(coords), 'nonzero:', len(nz))
print('sample_nonzero:', dict(list(nz.items())[:5]))
open(r'$PSScriptRoot\coord-docid.txt','w').write(doc_id)
"@

Write-Output "=== cleanup: delete test doc ==="
$docId = Get-Content "$PSScriptRoot\coord-docid.txt" -Raw
if ($docId) {
  try { Invoke-RestMethod -Uri "$base/api/import/$docId" -Method Delete -TimeoutSec 60 | Out-Null; Write-Output "deleted $docId" }
  catch { Write-Output "DELETE note: $_ (preview-only docs may not need delete)" }
}
$s = Invoke-RestMethod "$base/api/health" -TimeoutSec 10
Write-Output ("docs after=" + $s.sqlite.documents)
Remove-Item $doc, "$PSScriptRoot\coord-req.json" -ErrorAction SilentlyContinue
Write-Output "S1B-DONE"
