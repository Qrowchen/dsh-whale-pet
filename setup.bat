@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Big Fat Fish pet - first time setup
echo ==========================================
echo.
echo This will install dependencies (electron ~380MB).
echo Your network cannot reach github.com, so we use the
echo npmmirror for the electron binary. The proxy is also
echo honored if you have one running.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it first: https://nodejs.org/
  echo         This is a SOURCE checkout - if you only want to RUN the pet,
  echo         use the packaged release instead ^(no Node needed^).
  pause
  exit /b 1
)

REM electron 二进制的下载源。默认走 GitHub Releases，你的网络到不了，
REM 所以强制指向 npmmirror 镜像。
set "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/"

REM npm 自己的包源也走镜像，快且稳
set "npm_config_registry=https://registry.npmmirror.com"

echo Installing...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [FAILED] npm install failed. If it is a network/proxy problem, try:
  echo          set HTTPS_PROXY=http://127.0.0.1:7897
  echo          and run this script again.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Done. Verifying...
echo ==========================================
if exist "node_modules\electron\dist\electron.exe" (
  echo   electron runtime: OK
) else (
  echo   [WARN] electron runtime missing - the binary download may have failed.
  echo          Re-run this script, or check your network.
)

if not exist "config.json" (
  echo.
  echo   [NOTE] config.json not found. Copy config.example.json to config.json
  echo          and fill in your apiKey, otherwise balance/chat will not work.
)

echo.
echo Next: double-click start-pet.vbs to launch.
echo.
pause
endlocal
