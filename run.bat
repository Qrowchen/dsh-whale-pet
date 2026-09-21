@echo off
setlocal
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  Big Fat Fish desktop pet - launcher
REM  Keep this file ASCII-only. Chinese text in a .bat gets mangled
REM  by the console codepage and breaks command parsing (it silently
REM  stops Electron from ever starting).
REM  Chinese docs: see README.md
REM ---------------------------------------------------------------

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
set "LOG=%~dp0_launch.log"

echo ==========================================
echo   Big Fat Fish desktop pet
echo ==========================================
echo.

if not exist "%ELECTRON%" (
  echo [ERROR] Electron not found:
  echo         %ELECTRON%
  echo.
  echo Run this first in the project folder:
  echo         npm install
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0config.json" (
  echo [WARN] config.json not found.
  echo        Copy config.example.json to config.json and fill in apiKey,
  echo        otherwise balance and chat will not work.
  echo.
)

echo Starting... the pet appears at the bottom-right of your screen.
echo Close it with Alt+F4 or from the taskbar.
echo.

"%ELECTRON%" "%~dp0." --no-sandbox > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

echo.
echo Exit code: %RC%
if not "%RC%"=="0" (
  echo.
  echo [FAILED] The app exited with an error. Log:
  echo         %LOG%
  echo.
  if exist "%LOG%" type "%LOG%"
  echo.
  pause
)

endlocal
