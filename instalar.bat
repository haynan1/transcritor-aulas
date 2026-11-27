@echo off
setlocal
cd /d "%~dp0"
set "HF_HUB_DISABLE_TELEMETRY=1"

rem O uv instala o Python certo sozinho e as dependencias exatas do uv.lock (com hash).
where uv >nul 2>&1
if errorlevel 1 (
  echo O uv nao foi encontrado. Instale com o comando abaixo, feche esta janela e rode de novo:
  echo   winget install --id astral-sh.uv -e
  goto erro
)

echo Preparando o ambiente...
uv sync --frozen --no-dev || goto erro

echo Conferindo o modelo de transcricao (1,6 GB na primeira vez)...
".venv\Scripts\python.exe" -I -c "from faster_whisper import download_model; from transcriptor.config import carregar; d = carregar().modelo; (d / 'model.bin').is_file() or download_model('large-v3-turbo', output_dir=str(d))" || goto erro

echo.
echo Instalado. Para abrir o painel, de dois cliques em iniciar.bat.
pause
exit /b 0

:erro
echo A instalacao falhou. Veja a mensagem acima.
pause
exit /b 1
