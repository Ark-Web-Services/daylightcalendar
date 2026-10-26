param([string]$SourceDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$destination = 'C:\HAOS\jarvis-router'
New-Item -ItemType Directory -Force $destination | Out-Null
if (Get-ScheduledTask -TaskName 'Daylight-JarvisRouter' -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName 'Daylight-JarvisRouter'
  Get-CimInstance Win32_Process -Filter "name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$destination\jarvis-router.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
foreach ($name in @('jarvis-router.js', 'jarvis-router.example.json')) {
  if ((Join-Path $SourceDirectory $name) -ne (Join-Path $destination $name)) {
    Copy-Item (Join-Path $SourceDirectory $name) $destination -Force
  }
}
$configPath = Join-Path $destination 'jarvis-router.json'
if (!(Test-Path $configPath)) {
  Copy-Item (Join-Path $destination 'jarvis-router.example.json') $configPath
}
$node = (Get-Command node.exe).Source
$launch = @"
`$ErrorActionPreference = 'Continue'
while (`$true) {
  if ((Test-Path '$destination\router.log') -and (Get-Item '$destination\router.log').Length -gt 1MB) {
    Move-Item '$destination\router.log' '$destination\router.log.1' -Force
  }
  & '$node' '$destination\jarvis-router.js' '$configPath' >> '$destination\router.log' 2>&1
  Start-Sleep -Seconds 5
}
"@
Set-Content (Join-Path $destination 'run.ps1') $launch
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$destination\run.ps1`""
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Daylight-JarvisRouter' -Action $action -Trigger @($logon, $watchdog) -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
# The listener is bound only to HA-Link and has its own source allowlist as well.
if (!(Get-NetFirewallRule -DisplayName 'Jarvis router - HA VM only' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Jarvis router - HA VM only' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 10.77.77.1 -LocalPort 11435 -RemoteAddress 10.77.77.2 | Out-Null
}
Start-ScheduledTask -TaskName 'Daylight-JarvisRouter' -ErrorAction Stop
Write-Output 'Jarvis router installed. HA Ollama URL: http://10.77.77.1:11435; model: jarvis-auto:latest'
