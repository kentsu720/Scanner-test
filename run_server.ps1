# ==========================================================================
# Zero-Dependency PowerShell Web Server for LAN / Mobile Testing
# ==========================================================================
# This script starts a local web server listening on ALL interfaces (0.0.0.0).
# This allows mobile devices on the same Wi-Fi network to connect to the app.
# We use TcpListener instead of HttpListener to avoid requiring Administrator
# privileges on Windows to bind to external IP addresses.

$port = 8081
$localPath = Get-Location
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)

Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Inventory Barcode Scanner App Local Server" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "Server Root: $localPath" -ForegroundColor Gray

# Helper to find all active local IP addresses
$ips = @()
try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" 
    } | Select-Object -ExpandProperty IPAddress
} catch {}

try {
    $listener.Start()
    Write-Host "Server successfully started on all interfaces!" -ForegroundColor Green
    Write-Host "Local URL:  http://localhost:$port/" -ForegroundColor Cyan
    if ($ips.Count -gt 0) {
        Write-Host "Mobile URLs (choose the one matching your Wi-Fi network):" -ForegroundColor Gray
        foreach ($ip in $ips) {
            Write-Host "  http://${ip}:$port/" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Mobile URL: http://<your-computer-ip>:$port/" -ForegroundColor Yellow
    }
    Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Yellow
    Write-Host "--------------------------------------------------" -ForegroundColor Gray
    
    # Auto-open browser on local machine
    Start-Process "http://localhost:$port/"
    
    while ($true) {
        if ($listener.Pending()) {
            $client = $listener.AcceptTcpClient()
            try {
                $stream = $client.GetStream()
                $reader = New-Object System.IO.StreamReader($stream)
                
                # Read only the first line of the HTTP request
                $reqLine = $reader.ReadLine()
                if ($reqLine -and ($reqLine -match "GET\s+(/[^\s\?]*)\s+HTTP")) {
                    $urlPath = $Matches[1]
                    
                    # Unescape URL characters (like %20 to spaces)
                    try {
                        $urlPath = [System.Uri]::UnescapeDataString($urlPath)
                    } catch {}
                    
                    if ($urlPath -eq "/") { 
                        $urlPath = "/index.html" 
                    }
                    
                    # Clean up path to prevent directory traversal
                    $urlPath = $urlPath.Replace("..", "")
                    $filePath = Join-Path $localPath $urlPath
                    
                    if (Test-Path $filePath -PathType Leaf) {
                        $bytes = [System.IO.File]::ReadAllBytes($filePath)
                        
                        # Identify MIME types
                        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                        $contentType = "application/octet-stream"
                        switch ($ext) {
                            ".html" { $contentType = "text/html; charset=utf-8" }
                            ".css"  { $contentType = "text/css; charset=utf-8" }
                            ".js"   { $contentType = "application/javascript; charset=utf-8" }
                            ".json" { $contentType = "application/json; charset=utf-8" }
                            ".png"  { $contentType = "image/png" }
                            ".jpg"  { $contentType = "image/jpeg" }
                            ".svg"  { $contentType = "image/svg+xml" }
                            ".ico"  { $contentType = "image/x-icon" }
                        }
                        
                        $header = "HTTP/1.1 200 OK`r`n" +
                                  "Content-Type: $contentType`r`n" +
                                  "Content-Length: $($bytes.Length)`r`n" +
                                  "Cache-Control: no-store, no-cache, must-revalidate`r`n" +
                                  "Access-Control-Allow-Origin: *`r`n" +
                                  "Connection: close`r`n`r`n"
                        
                        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
                        $stream.Write($headerBytes, 0, $headerBytes.Length)
                        $stream.Write($bytes, 0, $bytes.Length)
                    } else {
                        # 404 response
                        $errText = "404 Not Found"
                        $errBytes = [System.Text.Encoding]::UTF8.GetBytes($errText)
                        $header = "HTTP/1.1 404 Not Found`r`n" +
                                  "Content-Type: text/plain`r`n" +
                                  "Content-Length: $($errBytes.Length)`r`n" +
                                  "Connection: close`r`n`r`n"
                        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
                        $stream.Write($headerBytes, 0, $headerBytes.Length)
                        $stream.Write($errBytes, 0, $errBytes.Length)
                    }
                }
                $stream.Close()
            } catch {
                # Silent catch for connection aborts or resets
            } finally {
                $client.Close()
            }
        }
        # Avoid high CPU utilization
        Start-Sleep -Milliseconds 15
    }
} catch {
    Write-Host "Server Error: $_" -ForegroundColor Red
} finally {
    $listener.Stop()
    Write-Host "Server stopped." -ForegroundColor Yellow
}
