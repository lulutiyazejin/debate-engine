# v0.1.3 GitHub Release 上传（AGENTS.md 发布规则：token 来自 CI_GITHUB_TOKEN 或本地凭据管理器，不落盘）
# AGENTS.md（0.1.3 后修订）：默认只传源码（push+tag+Release 说明），软件本体不传；
# 确需上传安装包时加 -WithInstaller。
param([switch]$WithInstaller)
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "v0.1.5"
$asset = "release\DebateEngine-0.1.5-Setup.exe"

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
0.1.5 机制批 + 入库增强 + 可视化：

本地模型自主：硬件探测推荐、模型矩阵单一真源、上下文五档显存预估、一键拉起 Ollama、GGUF 导入；超墙三选（分章/换大窗/仍投喂）；小档模板变体；交互槽失败 toast。

入库增强：中立评价存档、归档策略四选、版次联网补抓、附件批量导入、.xls 老格式、档案浏览树、迁移回滚、补生成摘要。

可视化：图谱区五段子投影——力导向 / 3D 立方（G2 point3D，22 轴任选，红蓝色标，无 WebGL 兜底）/ 坐标散点 / 立场雷达 / 交叉分析（含章节热力）。另：命令面板移除、滑移分段器全局统一、日期零依赖解析。

安装：下载 DebateEngine-0.1.5-Setup.exe 双击安装。
"@
} | ConvertTo-Json
try {
    $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $H -Body $body -ContentType "application/json"
} catch {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $H
}
"release id: $($rel.id)"

# AGENTS.md 规定默认不传软件本体（只传源码）；确需安装包时加 -WithInstaller
if (-not $WithInstaller) { "跳过资产上传（AGENTS.md：只传源码）"; exit 0 }

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
