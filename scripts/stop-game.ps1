$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.game-server.pid'

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host 'No launcher-managed game server was found.'
  exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$server = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($server) {
  Stop-Process -Id $serverPid -Force
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'The game server has been stopped.'
