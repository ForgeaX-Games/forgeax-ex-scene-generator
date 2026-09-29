@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%~dp0serve.py" %*
  pause
  goto :eof
)
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python "%~dp0serve.py" %*
  pause
  goto :eof
)
echo need python 3 (https://www.python.org/)
pause
