# v0.1.6 Release 创建（Invoke-RestMethod 显式 -Proxy，修复 0.1.6 上传第 1 次失败：
# PS5.1 不读 HTTPS_PROXY 环境变量）；token 凭据管理器取，不落盘不回显。
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "v0.1.6"
$proxy = "http://127.0.0.1:7890"
$token = $env:CI_GITHUB_TOKEN
if (-not $token) {
    $out = "url=https://github.com`n`n" | git credential fill 2>$null
    $token = ($out | Select-String "^password=(.+)$").Matches.Groups[1].Value
}
if (-not $token) { Write-Error "no token"; exit 1 }
$H = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$notes = @"
0.1.6 修复与体验批：

下载链：跟随系统代理真解析（注册表），安装版干净环境也能走代理；bge-m3 改官方源多文件清单（ModelScope 主 + hf-mirror 备，逐文件断点续传、中途换源）；组件下载可暂停/取消（.part 保留续传）。

目录与设置：组件/模型独立文件夹（components/ models/，升级不再冲掉已装组件）；UI 偏好迁 settings.json（升级/换档案不丢）；软件信息显真实路径；GGUF 文件浏览选择。

UI：原生弹窗全换自绘对话框（11 处）；右键手势松手才切面；设置居中；任务分工两列等宽。

3D 立方重写：零依赖自绘 canvas（删 @antv 3D 链）——三轴 RGB 渐变场色可选、立场=1×1×1 小立方、内壁方格、轴尽头标名、透明度/反向/常显标签/复位；力导向图谱节点标签常显开关。

安装：源码构建（见 README）；安装包不随 Release 分发。
"@
$body = @{ tag_name = $tag; name = "Debate Engine $tag"; body = $notes } | ConvertTo-Json
try {
    $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" `
        -Headers $H -Body $body -ContentType "application/json" -Proxy $proxy
} catch {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" `
        -Headers $H -Proxy $proxy
}
"release id: $($rel.id) url: $($rel.html_url)"
