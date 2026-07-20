param(
  [string]$TaskName = "JobTgBot",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RunnerPath = Join-Path $PSScriptRoot "run-bot.ps1"
$PowerShellPath = Join-Path $PSHOME "powershell.exe"
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
  throw "Create and configure $ProjectRoot\.env before installing the task."
}

& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  throw "Build failed. Scheduled task was not installed."
}

$Action = New-ScheduledTaskAction `
  -Execute $PowerShellPath `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`"" `
  -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Local job-tg-bot supervisor. Starts at user logon and restarts the bot after failures." `
  -RunLevel Limited `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Scheduled task '$TaskName' installed for $CurrentUser."
Write-Host "Use npm run local:status to check it."

