# Write-path smoke test against live engine (ASCII-only). Cleans up after itself.
$ErrorActionPreference = "Continue"
$base = "http://127.0.0.1:7700"

Write-Output "=== 1. font download (inter, already installed -> expect short-circuit) ==="
try {
  $r = Invoke-WebRequest -Uri "$base/api/fonts/download" -Method Post -Body '{"key":"inter"}' -ContentType "application/json" -TimeoutSec 60 -UseBasicParsing
  Write-Output $r.Content
} catch { Write-Output "FONT FAIL: $_" }

Write-Output "=== 2. create test txt ==="
$doc = "$PSScriptRoot\test-import-018.txt"
$text = "Regression smoke test document. " * 5 + "`r`n`r`n" +
        "This article argues that automated testing improves software quality. " * 8 + "`r`n`r`n" +
        "Evidence: projects with CI pipelines ship fewer regressions per release. " * 8
Set-Content -Path $doc -Value $text -Encoding UTF8
Write-Output "created $doc"

Write-Output "=== 3. import preview ==="
$body = @{ source = $doc; summary_strategy = "auto" } | ConvertTo-Json
try {
  $pv = Invoke-RestMethod -Uri "$base/api/import" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 240
  $docId = $pv.doc_id
  Write-Output ("preview ok doc_id=" + $docId + " title=" + $pv.title)
} catch { Write-Output "PREVIEW FAIL: $_"; exit 1 }

Write-Output "=== 4. import confirm (stance=empirical, archive=none) ==="
$body = @{ doc_id = $docId; stance = "empirical"; archive = "none" } | ConvertTo-Json
try {
  $cf = Invoke-RestMethod -Uri "$base/api/import/confirm" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 240
  Write-Output ("confirm ok: " + ($cf | ConvertTo-Json -Compress -Depth 3))
} catch { Write-Output "CONFIRM FAIL: $_" }

Write-Output "=== 5. basket add referencing test doc ==="
$body = @{ item_type = "doc"; ref_id = $docId; excerpt = "smoke test excerpt"; source = "test-import-018" } | ConvertTo-Json
try {
  $ba = Invoke-RestMethod -Uri "$base/api/basket" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 30
  Write-Output ("basket add: " + ($ba | ConvertTo-Json -Compress -Depth 3))
} catch { Write-Output "BASKET ADD FAIL: $_" }

Write-Output "=== 6. health before delete ==="
(Invoke-RestMethod "$base/api/health" -TimeoutSec 10).sqlite | ConvertTo-Json -Compress

Write-Output "=== 7. delete test doc ==="
try {
  $dl = Invoke-RestMethod -Uri "$base/api/import/$docId" -Method Delete -TimeoutSec 60
  Write-Output ("delete: " + ($dl | ConvertTo-Json -Compress -Depth 3))
} catch { Write-Output "DELETE FAIL: $_" }

Write-Output "=== 8. basket after delete (dangling check R1) ==="
try {
  $bl = Invoke-RestMethod "$base/api/basket" -TimeoutSec 10
  $mine = $bl | Where-Object { $_.ref_id -eq $docId }
  if ($mine) { Write-Output ("DANGLING CONFIRMED: " + ($mine | ConvertTo-Json -Compress -Depth 3)) }
  else { Write-Output "no dangling item (cascade exists?)" }
  # cleanup our basket item if present
  foreach ($m in $mine) {
    try { Invoke-RestMethod -Uri "$base/api/basket/$($m.id)" -Method Delete -TimeoutSec 10 | Out-Null; Write-Output ("cleaned basket id=" + $m.id) }
    catch { Write-Output ("basket cleanup FAIL id=" + $m.id + ": $_") }
  }
} catch { Write-Output "BASKET LIST FAIL: $_" }

Write-Output "=== 9. health after cleanup ==="
(Invoke-RestMethod "$base/api/health" -TimeoutSec 10).sqlite | ConvertTo-Json -Compress
Remove-Item $doc -ErrorAction SilentlyContinue
Write-Output "SMOKE-DONE"
