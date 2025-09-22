@echo off
setlocal
cd /d "%~dp0\.."
call run-dev.bat
echo.
echo Press any key to close this launcher window...
pause >nul
endlocal & exit /b 0
