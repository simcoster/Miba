# Miba - Network diagnostics for Expo "Failed to download remote update"
# Run: .\scripts\diagnose-network.ps1
#      .\scripts\diagnose-network.ps1 -TestPort  # run connection test (Metro must be running)

param([switch]$TestPort)

Write-Host "=== Miba Network Diagnostics ===" -ForegroundColor Cyan
Write-Host ""

# 0. Port 8081 connection test (run with -TestPort, Metro must be running)
if ($TestPort) {
    Write-Host "0. Testing port 8081 reachability (Metro must be running)..." -ForegroundColor Yellow
    $listening = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
    if (-not $listening) {
        Write-Host "  FAIL: Nothing listening on 8081. Start Metro first: npx expo start" -ForegroundColor Red
    } else {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress
        if (-not $ip) { $ip = "127.0.0.1" }
        Write-Host "  Metro listening on 8081. Testing connection to ${ip}:8081..." -ForegroundColor Gray
        $result = Test-NetConnection -ComputerName $ip -Port 8081 -WarningAction SilentlyContinue
        if ($result.TcpTestSucceeded) {
            Write-Host "  OK: Port 8081 reachable at ${ip}:8081 (firewall likely allows it)" -ForegroundColor Green
        } else {
            Write-Host "  FAIL: Cannot connect to ${ip}:8081 - firewall may be blocking" -ForegroundColor Red
            Write-Host "  Run as Admin: New-NetFirewallRule -DisplayName 'Expo Metro' -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow" -ForegroundColor Gray
        }
    }
    Write-Host ""
}

# 1. IP addresses
Write-Host "1. Your machine's IP addresses:" -ForegroundColor Yellow
ipconfig | Select-String -Pattern "IPv4|adapter"
Write-Host ""

# 2. Network profile (Public blocks device-to-device)
Write-Host "2. Network profile (Public = blocks connections, need Private):" -ForegroundColor Yellow
try {
    Get-NetConnectionProfile | Format-Table InterfaceAlias, NetworkCategory, IPv4Connectivity -AutoSize
} catch {
    Write-Host "  Run as Admin to see. Or: Settings > Network > Wi-Fi > your network > set to Private" -ForegroundColor Gray
}
Write-Host ""

# 3. Firewall rules for Node/Metro
Write-Host "3. Firewall - Node.js allowed?" -ForegroundColor Yellow
$nodeRules = Get-NetFirewallRule -DisplayName "*Node*" -ErrorAction SilentlyContinue
if ($nodeRules) { $nodeRules | Format-Table DisplayName, Enabled, Direction -AutoSize }
else { Write-Host "  No Node.js firewall rules found. Add: Allow Node.js in Windows Firewall" -ForegroundColor Gray }
Write-Host ""

# 4. Metro port
Write-Host "4. Port 8081 (Metro) - add rule if needed:" -ForegroundColor Yellow
Write-Host "  Run as Admin: New-NetFirewallRule -DisplayName 'Expo Metro' -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow" -ForegroundColor Gray
Write-Host ""

# 5. USB bypass (works when network is blocked)
Write-Host "5. USB device connected?" -ForegroundColor Yellow
$adbOut = adb devices 2>&1 | Out-String
if ($adbOut -match "\tdevice\s*") {
    Write-Host "  Yes. Run: .\scripts\fix-expo-usb.ps1" -ForegroundColor Green
    Write-Host "  Then set Dev settings > Debug server host = 127.0.0.1:8081" -ForegroundColor Gray
} else {
    Write-Host "  No device. Connect via USB for the USB tunnel fix." -ForegroundColor Gray
}
Write-Host ""

# 6. Likely culprit: router/AP isolation
Write-Host "6. Router/AP isolation (common when firewalls are off):" -ForegroundColor Yellow
Write-Host "  Some routers block device-to-device traffic. Same Wi-Fi, but PC and phone can't talk." -ForegroundColor Gray
Write-Host "  Fix: Use USB tunnel (fix-expo-usb.ps1) or try a different router/network." -ForegroundColor Gray
Write-Host ""

# 7. Summary
Write-Host "=== Fixes to try ===" -ForegroundColor Cyan
Write-Host "BEST: .\scripts\fix-expo-usb.ps1  (USB tunnel - bypasses network entirely)" -ForegroundColor Green
Write-Host "A. Set network to Private: Settings > Network & Internet > Wi-Fi > Properties > Network profile: Private"
Write-Host "B. Allow Node.js: Windows Firewall > Allow an app > Node.js (check Private + Public)"
Write-Host "C. Allow port 8081: Run PowerShell as Admin, then:"
Write-Host "   New-NetFirewallRule -DisplayName 'Expo Metro' -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow"
Write-Host "D. Router isolation: Try different network or use USB tunnel"
Write-Host "E. Use development build: npx expo run:android (avoids Expo Go + dev server)"
Write-Host ""
