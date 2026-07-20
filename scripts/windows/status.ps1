param(
  [string]$TaskName = "JobTgBot"
)

$ErrorActionPreference = "Continue"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Task) {
  $Info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task: $TaskName"
  Write-Host "State: $($Task.State)"
  Write-Host "Last run: $($Info.LastRunTime)"
  Write-Host "Last result: $($Info.LastTaskResult)"
} else {
  Write-Host "Task '$TaskName' is not installed."
}

Set-Location $ProjectRoot
if (Test-Path (Join-Path $ProjectRoot "dist\healthcheck.js")) {
  & node.exe (Join-Path $ProjectRoot "dist\healthcheck.js")
  exit $LASTEXITCODE
}

Write-Host "Build output is missing. Run npm run build."
exit 1

