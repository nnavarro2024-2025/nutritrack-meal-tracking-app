$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root "policy-service\.venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
  throw "Python environment not found. Create policy-service\.venv and install policy-service\requirements.txt first."
}

$policyCommand = "& `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
$backendCommand = "pnpm --dir backend dev"
$frontendCommand = "pnpm dev"

Start-Process powershell.exe -WorkingDirectory (Join-Path $root "policy-service") -ArgumentList @("-NoExit", "-Command", $policyCommand) | Out-Null
Start-Process powershell.exe -WorkingDirectory $root -ArgumentList @("-NoExit", "-Command", $backendCommand) | Out-Null
Start-Process powershell.exe -WorkingDirectory $root -ArgumentList @("-NoExit", "-Command", $frontendCommand) | Out-Null

Write-Host "Started policy service, Express API, and Vite frontend in separate PowerShell windows."
