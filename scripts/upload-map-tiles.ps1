param([Parameter(Mandatory=$true)][string]$File, [string]$SiteId)
$ErrorActionPreference = 'Stop'
$archiveFile = (Resolve-Path -LiteralPath $File).Path
$secureToken = Read-Host 'Netlify token for sparkwtp (hidden)' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$priorToken = $env:WTP_BLOBS_TOKEN
$priorSite = $env:WTP_BLOBS_SITE_ID
try {
  $env:WTP_BLOBS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  $siteLookup = if ($SiteId) { $SiteId } else { 'sparkwtp.netlify.app' }
  $site = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteLookup" -Headers @{Authorization="Bearer $env:WTP_BLOBS_TOKEN"}
  if ($site.name -ne 'sparkwtp') { throw 'The selected Netlify site is not sparkwtp.' }
  $env:WTP_BLOBS_SITE_ID = $site.id
  Write-Host "Public Census archive destination: sparkwtp ($($site.id)), map-tiles"
  $archiveHash = (Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0,16)
  & node --experimental-strip-types (Join-Path $PSScriptRoot 'publish-boundaries.mts') $archiveFile "census-2025-$archiveHash.pmtiles"
  if ($LASTEXITCODE -ne 0) { throw "Archive upload failed ($LASTEXITCODE)." }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  $env:WTP_BLOBS_TOKEN = $priorToken
  $env:WTP_BLOBS_SITE_ID = $priorSite
}
