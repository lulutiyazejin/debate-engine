# v0.1.3 GitHub Release 上传（AGENTS.md 发布规则：token 来自 CI_GITHUB_TOKEN 或本地凭据管理器，不落盘）
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "v0.1.3"
$asset = "release\DebateEngine-0.1.3-Setup.exe"

# 1. token：环境变量优先，否则从 Git 凭据管理器取
$token = $env:CI_GITHUB_TOKEN
if (-not $token) {
    $out = "url=https://github.com`n`n" | git credential fill 2>$null
    $token = ($out | Select-String "^password=(.+)$").Matches.Groups[1].Value
}
if (-not $token) { Write-Error "no token"; exit 1 }
$H = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }

# 2. 打标签并推送（git 正常信息走 stderr，不能让 Stop 误杀）
$ErrorActionPreference = "Continue"
git tag -f $tag 2>&1 | Out-Null
git push -f origin $tag 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "tag push failed"; exit 1 }
$ErrorActionPreference = "Stop"

# 3. 建 Release（已存在则复用）
$body = @{
    tag_name = $tag; name = "Debate Engine $tag"
    body = @"
0.1.3 纸感大版：无外框窗口（顶部功能条拖动/双击最大化/自绘窗控）+ v5 纸感视觉（双色板/发丝线/四书堆图标）。

新增：17 预置立场 + 立场管理（导入校验/删除/模板）、元数据全收集（确认屏八字段可编辑 + 联网补充维基/百科 + 手动永久优先）、本地模型一键下载（Ollama pull 进度条 + 热生效）、代理三态（直连/系统/自定义，本机始终直连）、连通自测、逻辑链垂直流程图、窗口记忆、字体外挂（knowledge_base/fonts 即放即用）。

安装：下载 DebateEngine-0.1.3-Setup.exe 双击安装，详见安装说明。
"@
} | ConvertTo-Json
try {
    $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $H -Body $body -ContentType "application/json"
} catch {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $H
}
"release id: $($rel.id)"

# 4. 上传安装包 asset（同名旧 asset 先删；curl + 禁用 Expect:100-continue——
#    本机代理会吞掉 100-continue 的终响应，导致 asset 卡 starter 态）
$name = Split-Path $asset -Leaf
$old = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($rel.id)/assets" -Headers $H) | Where-Object { $_.name -eq $name }
if ($old) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($old.id)" -Headers $H | Out-Null }
$up = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$name"
$proxyArgs = @(); if ($env:HTTPS_PROXY) { $proxyArgs = @("-x", $env:HTTPS_PROXY) }
curl.exe -s --http1.1 @proxyArgs --connect-timeout 20 --max-time 1600 `
  -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/octet-stream" `
  -H "Expect:" --data-binary "@$asset" -w "upload http=%{http_code}`n" -o "$env:TEMP\gh-asset.json" $up
$state = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($rel.id)/assets" -Headers $H) | Where-Object { $_.name -eq $name }
if ($state.state -ne "uploaded") { Write-Error "asset state=$($state.state), not uploaded"; exit 1 }
"asset uploaded: $($state.browser_download_url)"
