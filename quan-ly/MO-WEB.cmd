@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 24 tro len de chay may chu chung.
  pause
  exit /b 1
)
node server/index.mjs
if errorlevel 1 pause
endlocal
