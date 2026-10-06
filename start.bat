@echo off
setlocal
rem Starts the Panzi app for phones on ANY network (Wi-Fi or cellular data).
rem Opens a QR code image: scan it with Expo Go's scanner.
rem Keep this window open while people use the app; close it to stop everything.
rem For development mode (red error screens, slower): start.bat -Dev

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again.
  pause
  exit /b 1
)

if not exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" (
  echo cloudflared is not installed. It makes the app reachable over cellular data.
  echo Install it with:  winget install --id Cloudflare.cloudflared
  echo then run this again.
  pause
  exit /b 1
)

rem The key files are sent separately, never inside the zip.
set MISSING=
if not exist "%~dp0.env" set MISSING=%MISSING% .env
if not exist "%~dp0server\.env" set MISSING=%MISSING% server\.env
if not exist "%~dp0server\serviceAccount.json" set MISSING=%MISSING% server\serviceAccount.json
if defined MISSING (
  echo Missing key files:%MISSING%
  echo Ask for them and put each one in the folder shown, then run this again.
  pause
  exit /b 1
)

rem First run on a new computer: install packages once. Later runs skip this.
if not exist "%~dp0node_modules" (
  echo Installing app packages, this takes a few minutes the first time...
  call npm install
)
if not exist "%~dp0server\node_modules" (
  echo Installing API packages, this takes a minute the first time...
  pushd "%~dp0server" && call npm install && popd
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0present.ps1" %*
echo.
echo Stopped. Run start.bat again to get a new QR code.
pause
