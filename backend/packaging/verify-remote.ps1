$ErrorActionPreference = "Stop"
$token = $env:CI_GITHUB_TOKEN
if (-not $token) {
  $out = "url=https://github.com`n`n" | git credential fill 2>$null
  $token = ($out | Select-String "^password=(.+)$").Matches.Groups[1].Value
}
if (-not $token) { Write-Output "NO-TOKEN"; exit 1 }
$H = @{ Authorization = "Bearer $token"; "User-Agent" = "debate-engine-ci" }
$repo = "lulutiyazejin/debate-engine"
$r1 = Invoke-RestMethod "https://api.github.com/repos/$repo/git/refs/tags/v0.1.2" -Headers $H
Write-Output ("tag v0.1.2 -> " + $r1.object.sha.Substring(0,7))
$r2 = Invoke-RestMethod "https://api.github.com/repos/$repo/branches/main" -Headers $H
Write-Output ("main -> " + $r2.commit.sha.Substring(0,7) + " : " + $r2.commit.commit.message.Split("`n")[0])
$r3 = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/tags/v0.1.2" -Headers $H
Write-Output ("release: " + $r3.tag_name + " assets: " + ($r3.assets.name -join ",") +
  " size: " + [math]::Round($r3.assets[0].size/1MB, 1) + "MB")
Write-Output ("local HEAD: " + (git rev-parse --short HEAD))
