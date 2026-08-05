$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:4173/'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$installedNode = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeExe = if ($installedNode) { $installedNode.Source } else { $bundledNode }
$viteScript = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$pidFile = Join-Path $projectRoot '.game-server.pid'
$outputLog = Join-Path $projectRoot '.game-server-output.log'
$errorLog = Join-Path $projectRoot '.game-server-error.log'

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw 'Node.js was not found. Please reinstall the project runtime.'
}

if (-not (Test-Path -LiteralPath $viteScript)) {
  throw 'Game dependencies were not found. Check the node_modules folder.'
}

function Test-GameServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-GameServer)) {
  $server = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList @($viteScript, '--host', '127.0.0.1', '--port', '4173') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outputLog `
    -RedirectStandardError $errorLog `
    -PassThru

  Set-Content -LiteralPath $pidFile -Value $server.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-GameServer) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "The game server failed to start. Check: $errorLog"
  }
}

Start-Process $url
