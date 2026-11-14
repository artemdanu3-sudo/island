@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. The website will open now. Install it and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules call npm install
wscript "%~dp0start-island.vbs"
