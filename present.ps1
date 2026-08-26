# present.ps1
#
# Starts two public Cloudflare tunnels - one for the Expo/Metro dev server,
# one for the backend API in server/ - and starts both dev servers pointed at
# them, so a phone anywhere with internet (e.g. at school) can load the app
# via Expo Go AND have it actually talk to your backend, without needing to
# be on your home Wi-Fi.
#
# Two separate problems, two separate fixes:
#
# 1. Expo Go couldn't load the app at all ("no usable data found" / "Could
#    not connect"). Expo's own --tunnel flag depends on ngrok, which now
#    requires a newer agent version than the one Expo bundles (see:
#    ERR_NGROK_121). This routes around that with cloudflared's "quick
#    tunnel" instead. The tunnel is started BEFORE Expo, and its URL is
#    passed via EXPO_PACKAGER_PROXY_URL - the hook Expo's CLI has for
#    "I'm running behind an external proxy". That is what makes Expo build a
#    correct "exp://<tunnel-host>" link and serve manifests assuming HTTPS,
#    instead of a hand-built URL that doesn't match what the dev server
#    reports about itself.
#
# 2. Once the app loaded, every API call (e.g. saving onboarding answers)
#    failed with "Could not reach the server at http://192.168.x.x:8080" -
#    that address is .env's EXPO_PUBLIC_API_URL, your PC's home LAN IP,
#    unreachable from outside your home network. EXPO_PUBLIC_* variables are
#    inlined into the JS bundle, so this script starts a second tunnel to the
#    backend (server/, port 8080) and overrides EXPO_PUBLIC_API_URL with that
#    tunnel's public URL before starting Expo, so the bundle Metro serves
#    points at a reachable address instead of the LAN one in .env.
#
# Usage: right-click this file -> Run with PowerShell, or from a terminal:
#   powershell -ExecutionPolicy Bypass -File present.ps1
#
# Leave the window open for the whole presentation - closing it stops the
# dev servers and both tunnels.

$ErrorActionPreference = "Stop"

$projectDir = $PSScriptRoot
$serverDir = Join-Path $projectDir "server"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflared)) {
    Write-Host "cloudflared.exe not found at $cloudflared - is it installed?" -ForegroundColor Red
    exit 1
}

# A previous run that was closed uncleanly (window closed instead of Ctrl+C,
# a crash) can leave its node/cloudflared processes still holding these
# ports. A leftover backend on 8080 answers /health just fine on its own, but
# it is not the one this run just started or that this run's tunnel points
# at reliably - so clear the decks first rather than let a stale process
# masquerade as this run's.
Write-Host "Clearing any leftover processes from a previous run..." -ForegroundColor Cyan
Get-Process | Where-Object { $_.ProcessName -match "^node$|^cloudflared$" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$metroPort = 8081
$apiPort = 8080

$allProcs = @()

function Start-CloudflareTunnel($port, $label) {
    $log = Join-Path $env:TEMP "cloudflared-$label.log"
    $errLog = Join-Path $env:TEMP "cloudflared-$label.err.log"
    if (Test-Path $log) { Remove-Item $log }
    if (Test-Path $errLog) { Remove-Item $errLog }
    $proc = Start-Process -FilePath $cloudflared `
        -ArgumentList "tunnel --url http://localhost:$port" `
        -PassThru -WindowStyle Minimized -RedirectStandardOutput $log -RedirectStandardError $errLog

    $url = $null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        foreach ($l in @($log, $errLog)) {
            if (Test-Path $l) {
                $match = Select-String -Path $l -Pattern "https://[a-zA-Z0-9\-]+\.trycloudflare\.com" | Select-Object -First 1
                if ($match) { $url = $match.Matches[0].Value; break }
            }
        }
        if ($url) { break }
    }
    return @{ Proc = $proc; Url = $url; Log = $log }
}

Write-Host "Starting Cloudflare tunnel for the backend API (localhost:$apiPort) ..." -ForegroundColor Cyan
$apiTunnel = Start-CloudflareTunnel -port $apiPort -label "api"
if (-not $apiTunnel.Url) {
    Write-Host "Could not find the API tunnel URL. Check $($apiTunnel.Log) for details." -ForegroundColor Red
    exit 1
}
$allProcs += $apiTunnel.Proc
Write-Host "API tunnel is up: $($apiTunnel.Url)" -ForegroundColor Green

Write-Host "Starting the backend API server ..." -ForegroundColor Cyan
$apiLog = Join-Path $env:TEMP "api-present.log"
$apiErrLog = Join-Path $env:TEMP "api-present.err.log"
$apiProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" `
    -WorkingDirectory $serverDir `
    -PassThru -WindowStyle Minimized -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
$allProcs += $apiProc

Write-Host "Waiting for the backend to come up..." -ForegroundColor Cyan
$apiReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$apiPort/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $apiReady = $true; break }
    } catch {}
}
if (-not $apiReady) {
    Write-Host "Backend did not come up in time. Check $apiLog / $apiErrLog for details." -ForegroundColor Red
    $allProcs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}
Write-Host "Backend is up." -ForegroundColor Green

Write-Host "Starting Cloudflare tunnel for Metro (localhost:$metroPort) ..." -ForegroundColor Cyan
$metroTunnel = Start-CloudflareTunnel -port $metroPort -label "metro"
if (-not $metroTunnel.Url) {
    Write-Host "Could not find the Metro tunnel URL. Check $($metroTunnel.Log) for details." -ForegroundColor Red
    $allProcs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}
$allProcs += $metroTunnel.Proc
Write-Host "Metro tunnel is up: $($metroTunnel.Url)" -ForegroundColor Green

Write-Host "Starting Expo (Metro bundler) on port $metroPort, pointed at both tunnels ..." -ForegroundColor Cyan
$expoLog = Join-Path $env:TEMP "expo-present.log"
$expoErrLog = Join-Path $env:TEMP "expo-present.err.log"
# EXPO_PACKAGER_PROXY_URL: Expo's UrlCreator builds the QR link, manifest
# responses and asset paths around this public HTTPS origin instead of
# localhost:8081.
# EXPO_PUBLIC_API_URL: overrides .env's LAN address for this run only, so the
# bundle Metro serves points the app at the backend's public tunnel instead.
$env:EXPO_PACKAGER_PROXY_URL = $metroTunnel.Url
$env:EXPO_PUBLIC_API_URL = $apiTunnel.Url
$expoProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx expo start --port $metroPort" `
    -WorkingDirectory $projectDir `
    -PassThru -WindowStyle Minimized -RedirectStandardOutput $expoLog -RedirectStandardError $expoErrLog
$allProcs += $expoProc

Write-Host "Waiting for Metro to come up..." -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$metroPort/status" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
if (-not $ready) {
    Write-Host "Metro did not come up in time. Check $expoLog for details." -ForegroundColor Red
    $allProcs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}
Write-Host "Metro is up." -ForegroundColor Green

$hostOnly = $metroTunnel.Url -replace "^https://", ""
$expUrl = "exp://$hostOnly"

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Green
Write-Host " App (Metro) public URL:" -ForegroundColor Green
Write-Host " $($metroTunnel.Url)"
Write-Host ""
Write-Host " Backend API public URL:" -ForegroundColor Green
Write-Host " $($apiTunnel.Url)"
Write-Host ""
Write-Host " Expo Go deep link:" -ForegroundColor Green
Write-Host " $expUrl"
Write-Host "=========================================================" -ForegroundColor Green
Write-Host ""
$qrPath = node (Join-Path $projectDir "scripts\print-qr.js") $expUrl | Select-Object -Last 1
if ($qrPath -and (Test-Path $qrPath)) {
    Write-Host "QR code saved to: $qrPath" -ForegroundColor Green
    Write-Host "Opening it now - scan it with Expo Go's scanner (not the plain camera app)." -ForegroundColor Green
    Start-Process $qrPath
} else {
    Write-Host "Could not generate the QR code image. Use the Expo Go deep link above instead." -ForegroundColor Red
}
Write-Host ""
Write-Host "Keep this window open for the whole presentation." -ForegroundColor Yellow
Write-Host "Press Ctrl+C here to stop everything (both dev servers, both tunnels)."
Write-Host ""

try {
    Wait-Process -Id $metroTunnel.Proc.Id
} finally {
    Write-Host "Stopping..." -ForegroundColor Cyan
    $allProcs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}
