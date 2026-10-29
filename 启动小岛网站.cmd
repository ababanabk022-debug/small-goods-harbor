@echo off
setlocal
cd /d "%~dp0"
py -3 "%~dp0start-local-site.py" %*
if errorlevel 1 (
  echo.
  echo The island website could not start. Please check that Python 3 is installed.
  pause
)
