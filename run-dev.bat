@echo off
setlocal ENABLEEXTENSIONS

rem Resolve repo root (this script's directory)
set "ROOT=%~dp0"

echo Starting ReconX Backend (PowerShell)...
start "ReconX Backend" powershell -NoProfile -NoExit -Command "cd '%ROOT%'; .\.venv\Scripts\python.exe -m uvicorn reconx.api.main:app --host 127.0.0.1 --port 8000 --reload"

echo Starting ReconX Frontend (PowerShell)...
start "ReconX Frontend" powershell -NoProfile -NoExit -Command "cd '%ROOT%viz-recon-main'; npm run dev"

echo Launched backend and frontend in separate PowerShell windows.
exit /b 0
