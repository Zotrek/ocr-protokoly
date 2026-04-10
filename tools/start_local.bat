@echo off
REM Statyczny serwer dla OCR_protokoly (Windows). Wymaga Pythona w PATH.
cd /d "%~dp0\.."
set PORT=8765
if not "%~1"=="" set PORT=%~1
echo OCR_protokoly: http://127.0.0.1:%PORT%/
echo Zatrzymanie: Ctrl+C
python -m http.server %PORT%
