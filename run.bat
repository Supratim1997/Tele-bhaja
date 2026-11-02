@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: TeleBhaja — Native startup script for Windows
:: Usage: run.bat [optional_media_path]
:: ─────────────────────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

echo ╔══════════════════════════════════════════════════════╗
echo ║           🎬  TeleBhaja OTT Platform                ║
echo ╚══════════════════════════════════════════════════════╝

:: Set working dir to script location
cd /d "%~dp0"

:: Load .env if present
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" (
      set %%A=%%B
    )
  )
)

:: Parse all command-line arguments (supports multiple drives, quotes, spaces, and --dev)
set DEV_MODE=false
set COLLECTED_PATHS=

for %%A in (%*) do (
  set "TOKEN=%%~A"
  if /i "!TOKEN!"=="--dev" (
    set DEV_MODE=true
  ) else if not "!TOKEN!"=="" (
    :: Strip any remaining stray quotes
    set "TOKEN=!TOKEN:"=!"
    if not "!TOKEN!"=="" (
      if "!COLLECTED_PATHS!"=="" (
        set "COLLECTED_PATHS=!TOKEN!"
      ) else (
        set "COLLECTED_PATHS=!COLLECTED_PATHS!;!TOKEN!"
      )
    )
  )
)

:: Override MEDIA_STORAGE_PATH if paths were provided as arguments
if not "!COLLECTED_PATHS!"=="" (
  set "MEDIA_STORAGE_PATH=!COLLECTED_PATHS!"
)

:: Set defaults
if not defined PORT set PORT=3000
if not defined HOST set HOST=0.0.0.0
if not defined NODE_ENV set NODE_ENV=production
if not defined DB_PATH set DB_PATH=.\data\telebhaja.db
if not defined SCAN_ON_STARTUP set SCAN_ON_STARTUP=true

:: Verify media path exists, or interactively prompt
:check_media_path
if not defined MEDIA_STORAGE_PATH set MEDIA_STORAGE_PATH=E:\Media
echo !MEDIA_STORAGE_PATH! | findstr /c:";" >nul
if errorlevel 1 (
  if not exist "!MEDIA_STORAGE_PATH!" (
    echo.
    echo  [Notice] Media path "!MEDIA_STORAGE_PATH!" was not found.
    set /p USER_PATH="  Enter media folder path(s) (use ; for multiple drives, e.g. E:\Media;F:\Movies): "
    if not "!USER_PATH!"=="" (
      set USER_PATH=!USER_PATH:"=!
      set MEDIA_STORAGE_PATH=!USER_PATH!
      goto :check_media_path
    )
  )
)

:: Save or update .env so future runs and dev servers remember configured paths
if not exist .env (
  (
    echo PORT=%PORT%
    echo HOST=%HOST%
    echo NODE_ENV=%NODE_ENV%
    echo MEDIA_STORAGE_PATH=!MEDIA_STORAGE_PATH!
    echo DB_PATH=%DB_PATH%
    echo SCAN_ON_STARTUP=%SCAN_ON_STARTUP%
  ) > .env
  echo   [Saved] Media path saved to .env for future runs.
) else (
  if not "!COLLECTED_PATHS!"=="" (
    node -e "const fs=require('fs'); let c=fs.readFileSync('.env','utf8'); if (/^MEDIA_STORAGE_PATH=/m.test(c)) { c=c.replace(/^MEDIA_STORAGE_PATH=.*$/m, 'MEDIA_STORAGE_PATH=' + process.env.MEDIA_STORAGE_PATH); } else { c += '\nMEDIA_STORAGE_PATH=' + process.env.MEDIA_STORAGE_PATH; } fs.writeFileSync('.env', c);" 2>nul
    echo   [Saved] Updated MEDIA_STORAGE_PATH in .env for future runs.
  )
)

echo.
echo   Media Storage Path(s):
for %%P in ("!MEDIA_STORAGE_PATH:;=" "!") do (
  set "P_CLEAN=%%~P"
  if not "!P_CLEAN!"=="" echo     - !P_CLEAN!
)
echo   Port                 : %PORT%
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Node.js not found.
  echo   Install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

:: Check Node version
for /f "tokens=1" %%v in ('node -e "process.stdout.write(process.versions.node.split('.')[0])"') do set NODE_VER=%%v
if %NODE_VER% LSS 20 (
  echo ERROR: Node.js 20+ required. Found version %NODE_VER%.
  pause
  exit /b 1
)

:: Check FFmpeg
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
  echo WARNING: ffmpeg not found in PATH. Transcoding will be unavailable.
  echo   Download from: https://ffmpeg.org/download.html
  echo.
)

:: Install dependencies
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

:: Build client and server
if not exist dist\server\index.js (
  echo Building application...
  call npm run build
  if %errorlevel% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
  )
)

:: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do (
    set LOCAL_IP=%%b
    goto :found_ip
  )
)
:found_ip

:: Detect Tailscale IP if available
set TAILSCALE_IP=
if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
  for /f "tokens=*" %%t in ('"%ProgramFiles%\Tailscale\tailscale.exe" ip -4 2^>nul') do (
    set "TAILSCALE_IP=%%t"
  )
) else (
  for /f "tokens=*" %%t in ('tailscale ip -4 2^>nul') do (
    set "TAILSCALE_IP=%%t"
  )
)

echo.
echo 🚀 Starting TeleBhaja with Two-Tier Remote Gatekeeper...
echo    Core App (Internal) : http://localhost:%PORT%
echo    Public Gate (Proxy) : http://localhost:4000 (Expose to Internet via Tunnel)
if defined TAILSCALE_IP echo    Admin Gate [Private]: http://!TAILSCALE_IP!:8080 [Tailscale Mesh Only]
if not defined TAILSCALE_IP echo    Admin Gate [Private]: http://127.0.0.1:8080 [Localhost Only]
if defined LOCAL_IP echo    Direct Wi-Fi / LAN  : http://%LOCAL_IP%:%PORT%
if defined TAILSCALE_IP echo    Direct Mesh VPN     : http://!TAILSCALE_IP!:%PORT%
echo.
echo    [Workflow]
echo    1. Expose public gate: open a second terminal and run .\tunnel.bat
echo    2. Remote users land on the /waiting-room page automatically.
echo    3. Approve or revoke access from your phone via the Admin Gate on Tailscale.
echo.
echo    Press Ctrl+C to stop.
echo.

:: Ensure ports are released from any previous instance
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT%,4000,8080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul

:: Start server
if /i "%DEV_MODE%"=="true" (
  call npx tsx watch src/server/index.ts
) else (
  node dist\server\index.js
)

pause
endlocal
