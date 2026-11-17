@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -Command "Get-LocalGroup -SID S-1-5-32-559 | Add-LocalGroupMember -Member $env:USERNAME -ErrorAction SilentlyContinue"
echo.
echo Done. Now sign out of Windows and sign in again (or restart the PC).
pause
