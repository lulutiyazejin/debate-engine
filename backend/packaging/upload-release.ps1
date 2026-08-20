# v0.1.3 GitHub Release 上传（AGENTS.md 发布规则：token 来自 CI_GITHUB_TOKEN 或本地凭据管理器，不落盘）
# AGENTS.md（0.1.3 后修订）：默认只传源码（push+tag+Release 说明），软件本体不传；
# 确需上传安装包时加 -WithInstaller。
param([switch]$WithInstaller)
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "v0.1.6"
$asset = "release\DebateEngine-0.1.6-Setup.exe"

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
0.1.6 修复与体验批：

下载链：跟随系统代理真解析（注册表），安装版干净环境也能走代理；bge-m3 改官方源多文件清单（ModelScope 主 + hf-mirror 备，逐文件断点续传、中途换源）；组件下载可暂停/取消（.part 保留续传）。

目录与设置：组件/模型独立文件夹（components/ models/，升级不再冲掉已装组件）；UI 偏好迁 settings.json（升级/换档案不丢）；软件信息显真实路径；GGUF 文件浏览选择。

UI：原生弹窗全换自绘对话框（11 处）；右键手势松手才切面；设置居中；任务分工两列等宽。

3D 立方重写：零依赖自绘 canvas（删 @antv 3D 链）——三轴 RGB 渐变场色可选、立场=1×1×1 小立方、内壁方格、轴尽头标名、透明度/反向/常显标签/复位；力导向图谱节点标签常显开关。

安装：源码构建（见 README）；安装包不随 Release 分发。
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
