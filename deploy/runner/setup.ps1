[CmdletBinding()]
param(
    [string]$Server = '146.190.74.145',
    [string]$SshKey = "$env:USERPROFILE\.ssh\wtp-deploy",
    [string]$Settings = 'C:\Users\seanj\dev\meanwhile-worktrees\.env.staging'
)
$ErrorActionPreference = 'Stop'

function Invoke-RunnerCommand {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Installation stopped; no runner was started." }
}

function ConvertTo-LinuxRunnerSettings {
    param([string]$Text)
    $overrides = [ordered]@{
        WTP_RUNTIME_MODE = 'staging'
        WTP_DB_ROLE = 'local'
        WTP_RUNTIME_REPO = '/opt/meanwhile'
        WTP_BILLING_ENV_FILE = '/etc/meanwhile/runner.env'
        WTP_MIRROR = '/opt/meanwhile/.mirror'
        WTP_OCR_BINARY = '/usr/bin/tesseract'
        WTP_PDF_RASTERIZER = '/usr/bin/pdftoppm'
        PLAYWRIGHT_BROWSERS_PATH = '/var/lib/meanwhile/browsers'
    }
    $lines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in ($Text.TrimStart([char]0xFEFF) -split '\r?\n')) {
        if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            $name = $Matches[1]
            # A local reader folder would divert reader pages away from the live site, so it never reaches the runner.
            if ($name -match 'PROD' -or $name -eq 'WTP_ADMIN_SESSION_KEY' -or $name -eq 'WTP_READER_EDGE_DIR' -or $overrides.Contains($name)) { continue }
        }
        $lines.Add($line)
    }
    foreach ($entry in $overrides.GetEnumerator()) { $lines.Add("$($entry.Key)=$($entry.Value)") }
    return ($lines -join "`n") + "`n"
}

# Dot-sourcing exposes the converter for local verification without connecting.
if ($MyInvocation.InvocationName -eq '.') { return }
if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) { throw "SSH private key not found: $SshKey" }
if (-not (Test-Path -LiteralPath $Settings -PathType Leaf)) { throw "Staging settings not found: $Settings" }
$sshProgram = (Get-Command ssh.exe -ErrorAction Stop).Source
$scpProgram = (Get-Command scp.exe -ErrorAction Stop).Source
$sshOptions = @('-i', $SshKey, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new')
$destination = "root@$Server"
$remoteDirectory = '/root/meanwhile-bootstrap-' + [guid]::NewGuid().ToString('N')
$localDirectory = Join-Path ([IO.Path]::GetTempPath()) ('meanwhile-bootstrap-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $localDirectory | Out-Null
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $settingsText = ConvertTo-LinuxRunnerSettings ([IO.File]::ReadAllText($Settings))
    [IO.File]::WriteAllText((Join-Path $localDirectory 'runner.env'), $settingsText, $utf8)
    foreach ($name in @('install.sh', 'meanwhile-runner.service')) {
        $text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name)).Replace("`r`n", "`n")
        [IO.File]::WriteAllText((Join-Path $localDirectory $name), $text, $utf8)
    }
    Write-Host 'Copying staging settings securely. Their contents will not be printed.'
    Write-Host 'Setting names being uploaded:'
    foreach ($line in ($settingsText -split "`n")) {
        if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=') { Write-Host "  $($Matches[1])" }
    }
    Invoke-RunnerCommand $sshProgram ($sshOptions + @($destination, "umask 077; mkdir -p '$remoteDirectory'"))
    $uploads = @('runner.env', 'install.sh', 'meanwhile-runner.service') | ForEach-Object { Join-Path $localDirectory $_ }
    Invoke-RunnerCommand $scpProgram ($sshOptions + $uploads + @("${destination}:$remoteDirectory/"))
    Write-Host 'Opening GitHub sign-in on your PC. When the terminal displays a one-time code, enter it in the browser and approve the sign-in.'
    Start-Process 'https://github.com/login/device'
    $remoteCommand = "chmod 600 '$remoteDirectory/runner.env'; bash '$remoteDirectory/install.sh' --ref main --env-file '$remoteDirectory/runner.env'; result=`$?; rm -f '$remoteDirectory/runner.env'; exit `$result"
    Invoke-RunnerCommand $sshProgram ($sshOptions + @('-t', $destination, $remoteCommand))
} finally {
    # Remove only this invocation's temporary upload files, never the source settings.
    foreach ($name in @('runner.env', 'install.sh', 'meanwhile-runner.service')) {
        $temporaryFile = Join-Path $localDirectory $name
        if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
    }
    Remove-Item -LiteralPath $localDirectory -Force
}
