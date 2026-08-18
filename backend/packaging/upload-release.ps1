# v0.1.2 GitHub Release 涓婁紶锛圓GENTS.md 鍙戝竷瑙勫垯锛歵oken 鏉ヨ嚜 CI_GITHUB_TOKEN 鎴栨湰鍦板嚟鎹鐞嗗櫒锛屼笉钀界洏锛?
$ErrorActionPreference = "Stop"
$repo = "lulutiyazejin/debate-engine"
$tag = "v0.1.2"
$asset = "release\DebateEngine-0.1.2-Setup.exe"

# 1. token锛氱幆澧冨彉閲忎紭鍏堬紝鍚﹀垯浠?Git 鍑嵁绠＄悊鍣ㄥ彇
$token = $env:CI_GITHUB_TOKEN
if (-not $token) {
    $out = "url=https://github.com`n`n" | git credential fill 2>$null
    $token = ($out | Select-String "^password=(.+)$").Matches.Groups[1].Value
}
if (-not $token) { Write-Error "no token"; exit 1 }
$H = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }

# 2. 鎵撴爣绛惧苟鎺ㄩ€侊紙git 姝ｅ父淇℃伅璧?stderr锛屼笉鑳借 Stop 璇潃锛?
$ErrorActionPreference = "Continue"
git tag -f $tag 2>&1 | Out-Null
git push -f origin $tag 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "tag push failed"; exit 1 }
$ErrorActionPreference = "Stop"

# 3. 寤?Release锛堝凡瀛樺湪鍒欏鐢級
$body = @{
    tag_name = $tag; name = "Debate Engine $tag"
    body = @"
0.1.2 瀹屾暣妗岄潰鐗堬細Tauri 绐楀彛杞欢锛堥浂 cmd 绐楀彛锛? 闅愯棌寮曟搸 sidecar銆?

鏂板锛? 鍔熻兘椤碉紙鍙嶉┏/鎼滅储/瀵煎叆/瀵规瘮/鍥捐氨/鎶ュ憡/婧簮/璁剧疆锛夈€佸榻愬紩鎿庯紙鍒嗘鍦板浘/璺ㄩ〉瀵规瘮/鍏崇郴杈?婧簮锛夈€佽法绔嬪満缁煎悎鎶ュ憡銆佽璇佸浘璋卞彲瑙嗗寲銆佺煡璇嗗簱鍒嗕韩鍖咃紙.debkb锛夈€佹湇鍔″櫒绾?SQLite Schema锛堟煡閲?杞垹闄?鏂偣鎭㈠锛夈€?

瀹夎锛氫笅杞?DebateEngine-0.1.2-Setup.exe 鍙屽嚮瀹夎锛岃瑙佸畨瑁呰鏄庛€?
"@
} | ConvertTo-Json
try {
    $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $H -Body $body -ContentType "application/json"
} catch {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $H
}
"release id: $($rel.id)"

# 4. 涓婁紶瀹夎鍖?asset锛堝悓鍚嶆棫 asset 鍏堝垹锛?
$name = Split-Path $asset -Leaf
$old = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$($rel.id)/assets" -Headers $H) | Where-Object { $_.name -eq $name }
if ($old) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($old.id)" -Headers $H | Out-Null }
$up = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$name"
$r = Invoke-RestMethod -Method Post -Uri $up -Headers $H -ContentType "application/octet-stream" -InFile $asset
"asset uploaded: $($r.browser_download_url)"

