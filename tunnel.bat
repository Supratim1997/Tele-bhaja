@echo off
cd /d "%~dp0"
echo ╔══════════════════════════════════════════════════════╗
echo ║         🌐  TeleBhaja Public Tunnel Launcher        ║
echo ╚══════════════════════════════════════════════════════╝
echo.

if not exist cloudflared.exe (
  echo [Notice] cloudflared.exe not found. Downloading portable binary...
  curl.exe -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe
  if errorlevel 1 (
    echo [Error] Failed to download cloudflared.exe.
    pause
    exit /b 1
  )
)

echo 🚀 Starting Cloudflare Tunnel for Public Gate (Port 4000)...
echo    Look for the "https://....trycloudflare.com" link below.
echo    Share that link with your users!
echo.
echo Press Ctrl+C to stop the tunnel at any time.
echo.

.\cloudflared.exe tunnel --url http://localhost:4000

