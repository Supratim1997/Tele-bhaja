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

:: Allow override from arg
if not "%~1"=="" (
  if /i "%~1"=="--dev" (
    set DEV_MODE=true
    if not "%~2"=="" set MEDIA_STORAGE_PATH=%~2
  ) else (
    set MEDIA_STORAGE_PATH=%~1
  )
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

:: Save to .env if .env doesn't exist, so 'npm run dev' also remembers it
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
)

echo.
echo   Media Path : %MEDIA_STORAGE_PATH%
echo   Port       : %PORT%
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

echo.
echo 🚀 Starting TeleBhaja...
echo    Local URL  : http://localhost:%PORT%
if defined LOCAL_IP echo    Network URL: http://%LOCAL_IP%:%PORT%
echo.
echo    Open the Network URL on your phone to stream!
echo    Press Ctrl+C to stop.
echo.

:: Start server
if /i "%DEV_MODE%"=="true" (
  call npx tsx watch src/server/index.ts
) else (
  node dist\server\index.js
)

pause
endlocal
