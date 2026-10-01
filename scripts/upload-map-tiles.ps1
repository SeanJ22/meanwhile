param([Parameter(Mandatory=$true)][string]$File, [Parameter(Mandatory=$true)][string]$SiteId)
$ErrorActionPreference = 'Stop'
$archiveFile = (Resolve-Path -LiteralPath $File).Path
$secureToken = Read-Host 'Netlify token for the live site (hidden)' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$priorToken = $env:WTP_BLOBS_TOKEN
$priorSite = $env:WTP_BLOBS_SITE_ID
try {
  $env:WTP_BLOBS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  $site = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$SiteId" -Headers @{Authorization="Bearer $env:WTP_BLOBS_TOKEN"}
  if (-not $site.id) { throw "No Netlify site found for $SiteId." }
  $env:WTP_BLOBS_SITE_ID = $site.id
  Write-Host "Public Census archive destination: $($site.name) ($($site.id)), map-tiles"
  $archiveHash = (Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0,16)
  & node --experimental-strip-types (Join-Path $PSScriptRoot 'publish-boundaries.mts') $archiveFile "census-2025-$archiveHash.pmtiles"
  if ($LASTEXITCODE -ne 0) { throw "Archive upload failed ($LASTEXITCODE)." }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  $env:WTP_BLOBS_TOKEN = $priorToken
  $env:WTP_BLOBS_SITE_ID = $priorSite
}
