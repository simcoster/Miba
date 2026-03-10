# Miba - Fix Expo Go "Cannot connect to Metro" via USB (bypasses network entirely)
# Run: .\scripts\fix-expo-usb.ps1
# Prereq: Device connected via USB, USB debugging on, Metro running (npx expo start)
#
# This uses adb reverse to tunnel port 8081 over USB. The device connects to
# 127.0.0.1:8081 (its own localhost), which adb forwards to your PC's Metro.
# No Wi-Fi/firewall involved.

param([switch]$Quiet)

if (-not $Quiet) { Write-Host "=== Expo Go - USB tunnel fix ===" -ForegroundColor Cyan }

$devices = adb devices 2>&1 | Out-String
if ($devices -notmatch "\tdevice\s*") {
    Write-Host "No Android device found. Connect via USB, enable USB debugging, run: adb devices" -ForegroundColor Red
    exit 1
}

adb reverse tcp:8081 tcp:8081
if ($LASTEXITCODE -ne 0) {
    Write-Host "adb reverse failed" -ForegroundColor Red
    exit 1
}

if (-not $Quiet) {
    Write-Host "adb reverse tcp:8081 tcp:8081 - OK" -ForegroundColor Green
    Write-Host ""
    Write-Host "Now on your device:" -ForegroundColor Yellow
    Write-Host "  1. Shake the device (or shake gesture in emulator)" -ForegroundColor White
    Write-Host "  2. Tap 'Dev settings' (or open Expo Go menu)" -ForegroundColor White
    Write-Host "  3. Set 'Debug server host & port for device' to: 127.0.0.1:8081" -ForegroundColor White
    Write-Host "  4. Reload the app (shake > Reload)" -ForegroundColor White
    Write-Host ""
    Write-Host "This bypasses Wi-Fi entirely - connection goes over USB." -ForegroundColor Gray
}
