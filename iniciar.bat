@echo off
setlocal
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Ambiente nao encontrado. Rode instalar.bat primeiro.
  pause
  exit /b 1
)
title Transcriptor Class
"%PY%" -I -m transcriptor %*
if errorlevel 1 pause
