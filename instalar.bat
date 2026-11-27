@echo off
setlocal
set "BASE=%USERPROFILE%\TranscritorAulas"
set "PY=%BASE%\venv\Scripts\python.exe"
set "HF_HUB_DISABLE_TELEMETRY=1"

if exist "%PY%" goto dependencias

rem O launcher "py" acha o Python 3.13 mesmo fora do PATH. O "python" solto
rem pode ser o atalho da Microsoft Store, que nao cria ambiente nenhum.
set "SISTEMA="
py -3.13 -c "pass" >nul 2>&1 && set "SISTEMA=py -3.13"
if not defined SISTEMA python -c "import sys; sys.exit(sys.version_info < (3, 13))" >nul 2>&1 && set "SISTEMA=python"
if not defined SISTEMA (
  echo Python 3.13 nao encontrado. Instale com o comando abaixo e rode este arquivo de novo:
  echo   winget install --id Python.Python.3.13 -e
  goto erro
)
%SISTEMA% -m venv "%BASE%\venv" || goto erro

:dependencias
"%PY%" -m pip install --disable-pip-version-check -r "%~dp0requirements.txt" || goto erro
"%PY%" -c "import os; from faster_whisper import download_model; download_model('large-v3-turbo', output_dir=os.path.join(os.environ['BASE'], 'modelo-large-v3-turbo'))" || goto erro
echo Instalado.
pause
exit /b 0

:erro
echo A instalacao falhou. Veja a mensagem acima.
pause
exit /b 1
