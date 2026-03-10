# Miba - Debug EAS Updates / Expo Go with adb logcat
# Run: .\scripts\debug-updates-adb.ps1
#       .\scripts\debug-updates-adb.ps1 -Live   # stream to console
# Prereq: Android device connected via USB, USB debugging on, adb in PATH
#
# Note: In Expo Go, expo-updates may still try to fetch on launch. If you see
# "Failed to download remote update", add to app.config.ts updates:
#   checkAutomatically: 'NEVER'

param(
    [switch]$Live,      # Stream to console (default: save to file)
    [string]$OutFile = "expo-updates-debug-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
)

# dev.expo.updates = expo-updates native logs (errors, fetch, download)
# ReactNativeJS = JS errors (e.g. "Failed to download remote update")
# ReactNative = native bridge
$filters = "dev.expo.updates:V ReactNativeJS:V ReactNative:V"

Write-Host "=== EAS Updates / Expo Go - adb logcat ===" -ForegroundColor Cyan
Write-Host ""

# Check device (adb devices returns array; use Out-String for correct -match)
$devicesOutput = adb devices 2>&1 | Out-String
if ($devicesOutput -notmatch "\tdevice\s*") {
    Write-Host "No Android device found. Connect device, enable USB debugging, run: adb devices" -ForegroundColor Red
    exit 1
}

Write-Host "Device connected. Clearing logcat..." -ForegroundColor Yellow
adb logcat -c

Write-Host ""
if ($Live) {
    Write-Host "Streaming logs (Ctrl+C to stop)." -ForegroundColor Green
    adb logcat *:S $filters
} else {
    Write-Host "Capturing to $OutFile. Reproduce the issue, then Ctrl+C." -ForegroundColor Green
    adb logcat *:S $filters | Tee-Object -FilePath $OutFile
}
