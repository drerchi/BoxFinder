# Registers (or replaces) the "BoxFinder scan" scheduled task for the current
# Windows user. Run from PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
#
# - Runs only while you're signed in (needed: Alza's Cloudflare only lets a
#   visible Chrome through), but works fine with the screen locked.
# - Wakes the laptop from sleep for a run when it can (usually only on AC power).
# - A run missed because the laptop was off/asleep starts as soon as it's back.
param(
    [string[]]$Times = @('08:00', '11:00', '14:00', '17:00', '20:00', '23:00')
)

$ErrorActionPreference = 'Stop'
$taskName = 'BoxFinder scan'
$runner = Join-Path $PSScriptRoot 'run-scan.cmd'
$repoRoot = Split-Path $PSScriptRoot -Parent

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`"" -WorkingDirectory $repoRoot
$triggers = $Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -RunOnlyIfNetworkAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$taskName' at $($Times -join ', ') daily."
