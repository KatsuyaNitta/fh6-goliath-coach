@echo off
setlocal EnableExtensions
chcp 65001 >nul

for %%I in ("%~dp0.") do set "ROOT=%%~fI"
set "FH6_COACH_ROOT=%ROOT%"
set "API_URL=http://127.0.0.1:8765/api/health"
set "VIEWER_URL=http://127.0.0.1:5173"

title FH6 Goliath Coach Launcher

echo.
echo ========================================
echo   FH6 Goliath Coach - Development Mode
echo ========================================
echo.
echo Repository:
echo   %ROOT%
echo.

if not exist "%ROOT%\" (
    echo [ERROR] Repository directory not found:
    echo         %ROOT%
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%\README.md" (
    echo [ERROR] README.md not found. Place this launcher in the Repository root:
    echo         %ROOT%
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%\.venv\Scripts\python.exe" (
    echo [ERROR] Python virtual environment not found:
    echo         %ROOT%\.venv\Scripts\python.exe
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%\viewer\package.json" (
    echo [ERROR] Viewer package.json not found:
    echo         %ROOT%\viewer\package.json
    echo.
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm was not found in PATH.
    echo         Open a PowerShell window and confirm: pnpm --version
    echo.
    pause
    exit /b 1
)

echo [1/3] Checking API server...
powershell.exe -NoProfile -Command ^
  "try { Invoke-RestMethod '%API_URL%' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
    echo       Starting API server on 127.0.0.1:8765...
    start "FH6 Coach API" powershell.exe -NoExit -ExecutionPolicy Bypass -Command ^
      "Set-Location -LiteralPath $env:FH6_COACH_ROOT; $env:PYTHONPATH = (Join-Path $PWD 'backend'); & (Join-Path $PWD '.venv\Scripts\python.exe') -m goliath.cli serve --api-only"
) else (
    echo       API server is already running.
)

echo [2/3] Checking Vite viewer...
powershell.exe -NoProfile -Command ^
  "try { Invoke-WebRequest '%VIEWER_URL%' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
    echo       Starting Vite viewer on 127.0.0.1:5173...
    start "FH6 Coach Viewer" powershell.exe -NoExit -ExecutionPolicy Bypass -Command ^
      "Set-Location -LiteralPath (Join-Path $env:FH6_COACH_ROOT 'viewer'); pnpm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
) else (
    echo       Vite viewer is already running.
)

echo [3/3] Waiting for both services...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline = (Get-Date).AddSeconds(45);" ^
  "$apiReady = $false; $viewerReady = $false;" ^
  "do {" ^
  "  if (-not $apiReady) {" ^
  "    try { Invoke-RestMethod '%API_URL%' -TimeoutSec 1 | Out-Null; $apiReady = $true } catch {}" ^
  "  }" ^
  "  if (-not $viewerReady) {" ^
  "    try { Invoke-WebRequest '%VIEWER_URL%' -UseBasicParsing -TimeoutSec 1 | Out-Null; $viewerReady = $true } catch {}" ^
  "  }" ^
  "  if ($apiReady -and $viewerReady) { exit 0 }" ^
  "  Start-Sleep -Milliseconds 500;" ^
  "} while ((Get-Date) -lt $deadline);" ^
  "Write-Host 'API ready:' $apiReady;" ^
  "Write-Host 'Viewer ready:' $viewerReady;" ^
  "exit 1"

if errorlevel 1 (
    echo.
    echo [ERROR] Startup timed out.
    echo         Check the two PowerShell windows for error messages.
    echo.
    pause
    exit /b 1
)

echo.
echo Ready:
echo   %VIEWER_URL%
echo.
echo The API and viewer are running in separate PowerShell windows.
echo Close those two windows, or press Ctrl+C in each, to stop the servers.
echo.

start "" "%VIEWER_URL%"

timeout /t 3 /nobreak >nul
exit /b 0
