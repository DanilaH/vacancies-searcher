param(
  [int]$RestartDelaySeconds = 10
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LogDir = Join-Path $ProjectRoot "logs"
$LogPath = Join-Path $LogDir "local-bot.log"
$SupervisorLogPath = Join-Path $LogDir "local-supervisor.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
  throw "Missing .env in $ProjectRoot"
}

if (-not (Test-Path (Join-Path $ProjectRoot "dist\index.js"))) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Initial build failed with exit code $LASTEXITCODE."
  }
}

$CurrentRestartDelaySeconds = [Math]::Max(1, $RestartDelaySeconds)
while ($true) {
  $StartedAt = Get-Date
  Add-Content -LiteralPath $SupervisorLogPath -Value "[$(Get-Date -Format o)] Starting bot process."
  & node.exe (Join-Path $ProjectRoot "dist\index.js") 2>&1 |
    Tee-Object -LiteralPath $LogPath -Append
  $ExitCode = $LASTEXITCODE
  $LifetimeSeconds = ((Get-Date) - $StartedAt).TotalSeconds
  if ($LifetimeSeconds -ge 300) {
    $CurrentRestartDelaySeconds = [Math]::Max(1, $RestartDelaySeconds)
  } else {
    $CurrentRestartDelaySeconds = [Math]::Min(300, $CurrentRestartDelaySeconds * 2)
  }
  Add-Content -LiteralPath $SupervisorLogPath -Value "[$(Get-Date -Format o)] Bot exited with code $ExitCode after $([Math]::Round($LifetimeSeconds)) seconds. Restarting in $CurrentRestartDelaySeconds seconds."
  Start-Sleep -Seconds $CurrentRestartDelaySeconds
}
