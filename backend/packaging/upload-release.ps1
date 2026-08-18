# v0.1.1 GitHub Release 上传（AGENTS.md 发布规则：token 来自 CI_GITHUB_TOKEN 或本地凭据管理器，不落盘）
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "v0.1.1"
$asset = "release\DebateEngine-0.1.1-Setup.exe"

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
0.1.1 完整桌面版：Tauri 窗口软件（零 cmd 窗口）+ 隐藏引擎 sidecar。

新增：8 功能页（反驳/搜索/导入/对比/图谱/报告/溯源/设置）、对齐引擎（分歧地图/跨页对比/关系边/溯源）、跨立场综合报告、论证图谱可视化、知识库分享包（.debkb）、服务器级 SQLite Schema（查重/软删除/断点恢复）。

安装：下载 DebateEngine-0.1.1-Setup.exe 双击安装，详见安装说明。
"@
} | ConvertTo-Json
try {
    $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $H -Body $body -ContentType "application/json"
} catch {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $H
}
"release id: $($rel.id)"

# 4. 上传安装包 asset（同名旧 asset 先删）
$name = Split-Path $asset -Leaf
$old = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($rel.id)/assets" -Headers $H) | Where-Object { $_.name -eq $name }
if ($old) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($old.id)" -Headers $H | Out-Null }
$up = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$name"
$r = Invoke-RestMethod -Method Post -Uri $up -Headers $H -ContentType "application/octet-stream" -InFile $asset
"asset uploaded: $($r.browser_download_url)"
