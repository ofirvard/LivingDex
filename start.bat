@echo off
rem Starts the Living Dex app and opens it in your browser.
rem Progress is saved to progress.json in this folder. Close this window to stop the app.
cd /d "%~dp0"
start "" http://localhost:8642
python server.py
pause
