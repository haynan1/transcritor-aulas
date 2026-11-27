@echo off
setlocal
set "PY=%USERPROFILE%\TranscritorAulas\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Ambiente nao encontrado. Rode instalar.bat primeiro.
  pause
  exit /b 1
)
if "%~1"=="" (
  echo Arraste um audio, video ou pasta para cima deste arquivo.
  pause
  exit /b 1
)
"%PY%" -I "%~dp0transcrever.py" %*
set "RC=%ERRORLEVEL%"
if not defined SEM_PAUSA pause
exit /b %RC%
