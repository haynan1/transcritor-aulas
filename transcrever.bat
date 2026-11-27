@echo off
setlocal
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Ambiente nao encontrado. Rode instalar.bat primeiro.
  pause
  exit /b 1
)
if "%~1"=="" (
  echo Arraste um audio, video ou pasta para cima deste arquivo.
  echo Para importar e acompanhar pelo painel, use iniciar.bat.
  pause
  exit /b 1
)
"%PY%" -I -m transcriptor.cli %*
set "RC=%ERRORLEVEL%"
if not defined SEM_PAUSA pause
exit /b %RC%
