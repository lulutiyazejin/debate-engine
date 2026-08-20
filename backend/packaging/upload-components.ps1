# components-v1 运行时下载源资产上传（0.1.6 批 6）：ocr/docling 两 zip。
# curl 禁 Expect:100-continue（本机代理会吞终响应，记忆 tool_experience）；token 不落盘。
param([string[]]$Assets = @("..\..\release\ocr-win64.zip", "..\..\release\docling-win64.zip"))
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "components-v1"
$proxy = "http://127.0.0.1:7890"
$token = $env:CI_GITHUB_TOKEN
if (-not $token) {
    $out = "url=https://github.com`n`n" | git credential fill 2>$null
    $token = ($out | Select-String "^password=(.+)$").Matches.Groups[1].Value
}
if (-not $token) { Write-Error "no token"; exit 1 }
$H = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }

# Release 已存在则复用（tag 指向 main 当前提交）
try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $H -Proxy $proxy
} catch {
    $body = @{ tag_name = $tag; name = "组件资产 components-v1"
               body = "组件中心运行时下载源：ocr-win64.zip（RapidOCR+pypdfium2）、docling-win64.zip（Docling）。解压布局=site-packages 根，供引擎挂 sys.path。" } | ConvertTo-Json
    $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $H -Body $body -ContentType "application/json" -Proxy $proxy
}
"release id: $($rel.id)"

foreach ($asset in $Assets) {
    if (-not (Test-Path $asset)) { "skip (missing): $asset"; continue }
    $name = Split-Path $asset -Leaf
    $old = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($rel.id)/assets" -Headers $H -Proxy $proxy) | Where-Object { $_.name -eq $name }
    if ($old) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($old.id)" -Headers $H -Proxy $proxy | Out-Null }
    $up = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$name"
    curl.exe -s --http1.1 -x $proxy --connect-timeout 20 --max-time 3600 `
      -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/octet-stream" `
      -H "Expect:" --data-binary "@$asset" -w "upload $name http=%{http_code}`n" -o "$env:TEMP\gh-asset.json" $up
    $state = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($rel.id)/assets" -Headers $H -Proxy $proxy) | Where-Object { $_.name -eq $name }
    if ($state.state -ne "uploaded") { Write-Error "asset $name state=$($state.state)"; exit 1 }
    "uploaded: $($state.browser_download_url)"
}
