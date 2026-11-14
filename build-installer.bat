@echo off
cd /d "%~dp0"
echo Building Island. This takes a few minutes. Internet is required.
echo.
call npm install
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
echo.
echo DONE! Files are in the dist folder: Island-Setup.exe and Island-Portable.exe
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo.
echo ERROR. Copy the text above and send it to Claude.
echo If you see a symbolic link error, run this file as Administrator (right click, Run as administrator).
pause
exit /b 1
