@echo off
setlocal
cd /d "%~dp0"

set "APP=%~dp0WhalePet.exe"
set "LOG=%~dp0_launch.log"

if not exist "%APP%" (
  echo [ERROR] WhalePet.exe not found next to this script.
  pause
  exit /b 1
)

if not exist "%~dp0resources\app\config.json" (
  echo [WARN] resources\app\config.json is missing.
  echo        Copy config.example.json to config.json and fill in your apiKey,
  echo        otherwise balance and chat will not work.
  echo.
)

echo Starting Big Fat Fish desktop pet...
echo.
"%APP%" --no-sandbox > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

echo Exit code: %RC%
if not "%RC%"=="0" (
  echo.
  echo [FAILED] Log:
  echo         %LOG%
  echo.
  if exist "%LOG%" type "%LOG%"
  echo.
  pause
)
endlocal
