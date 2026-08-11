@echo off
setlocal
cd /d "%~dp0"
title Codk7 - UTAS Smart Academic Advising System

echo.
echo ===========================================================
echo  Codk7 - UTAS Smart Academic Advising System
echo ===========================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js is not installed or is not on PATH.
  echo     Install Node.js 22.13 or newer, then run this file again.
  pause
  exit /b 1
)

set "NODE_OK=0"
for /f %%v in ('node -p "const [M,m]=process.versions.node.split('.').map(Number); Number(M^>22 ^|^| (M===22 ^&^& m^>=13))"') do set "NODE_OK=%%v"
if not "%NODE_OK%"=="1" (
  echo [X] Node.js 22.13 or newer is required.
  echo     Installed version:
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [1/2] Installing locked dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto fail
) else (
  echo [1/2] Dependencies are already installed.
)

echo [2/2] Starting the application at http://localhost:5173
echo Use the official email and password from the approved login PDF.
echo Keep this window open while using the system.
echo.
start "" /b cmd /c "ping -n 7 127.0.0.1 >nul & start "" http://localhost:5173"
call npm run dev
exit /b %errorlevel%

:fail
echo.
echo [X] Setup failed. Review the error messages above.
pause
exit /b 1
