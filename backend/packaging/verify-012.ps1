$ErrorActionPreference = "Continue"
# 1) 找引擎端口（7700 起步扫 10 个）
$port = 0
7700..7710 | ForEach-Object {
  if ($port -eq 0) {
    try {
      $r = Invoke-RestMethod "http://127.0.0.1:$_/api/health" -TimeoutSec 2
      if ($r) { $script:port = $_ }
    } catch {}
  }
}
if ($port -eq 0) { Write-Output "NO-ENGINE"; exit 1 }
Write-Output "ENGINE PORT: $port"
$B = "http://127.0.0.1:$port"

# 2) 0.1.2 新端点逐一验证
$ver = Invoke-RestMethod "$B/api/health"
Write-Output ("health: " + ($ver | ConvertTo-Json -Compress -Depth 3))

$basket = Invoke-RestMethod "$B/api/basket"
Write-Output ("basket: count=$($basket.count) cap=$($basket.cap)")

$add = Invoke-RestMethod "$B/api/basket" -Method Post -ContentType "application/json" `
  -Body (@{item_type="chunk"; ref_id="verify_c1"; excerpt="0.1.2 验证素材"; source="验收"} | ConvertTo-Json)
Write-Output ("basket add: id=$($add.id) dup=$($add.duplicated)")

$resp = Invoke-RestMethod "$B/api/responses"
Write-Output ("responses: items=$($resp.items.Count)")

$tasks = Invoke-RestMethod "$B/api/config/tasks"
Write-Output ("tasks: " + (($tasks.tasks | ForEach-Object { "$($_.task)->$($_.active)" }) -join " "))

$params = Invoke-RestMethod "$B/api/config/params"
Write-Output ("params: " + ($params | ConvertTo-Json -Compress))

try {
  $chain = Invoke-RestMethod "$B/api/analysis/chain?anchor=市场经济" -TimeoutSec 60
  Write-Output ("chain: nodes=$($chain.nodes.Count) hint=$($chain.hint)")
} catch { Write-Output "chain: ERR $_" }

$opt = Invoke-RestMethod "$B/api/rebuttal/options"
Write-Output ("intents: " + (($opt.intents.PSObject.Properties | ForEach-Object { $_.Name }) -join ","))

# 清理验证素材
Invoke-RestMethod "$B/api/basket/$($add.id)" -Method Delete | Out-Null
Write-Output "basket cleanup ok"

# 3) 切面（Ctrl+Tab）+ 截图由外部脚本做；此处仅激活窗口发键
$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate("Debate Engine") | Out-Null
Start-Sleep 1
$ws.SendKeys("^{TAB}")
Start-Sleep 2
Write-Output "sent Ctrl+Tab"
