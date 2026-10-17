param([string]$Vbs)
# Registers a per-user "at logon" task that starts Tamam Pro (no admin rights needed).
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $Vbs + '"')
$trg = New-ScheduledTaskTrigger -AtLogOn -User $me
$trg.Delay = 'PT20S'
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'TamamPro' -Action $act -Trigger $trg -Settings $set -User $me -RunLevel Limited -Force | Out-Null
Write-Host 'Scheduled task TamamPro registered for' $me
