# Transcritor de aulas

Grava a aula no Audacity, exporta para a pasta `Gravações` e arrasta o arquivo para `transcrever.bat`. O resultado é o texto completo da aula, com o tempo de cada trecho.

Tudo roda no seu computador, com o Whisper `large-v3-turbo` (via [faster-whisper](https://github.com/SYSTRAN/faster-whisper)). Nenhum áudio vai para a internet.

## Instalar numa máquina nova

Precisa de Windows, Git e Python 3.13.

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.13 -e
winget install --id Audacity.Audacity -e
```

```powershell
git clone https://github.com/haynan1/transcritor-aulas.git "$HOME\Desktop\Aulas transcrição"
```

Depois, dê dois cliques em `instalar.bat`. Ele cria o ambiente em `%USERPROFILE%\TranscritorAulas` e baixa o modelo (cerca de 1,6 GB, uma vez só).

## Gravar no Audacity 4

Use o **Audacity 4.0** ou mais novo. É nele que estas instruções e as telas de exportação foram conferidas.

**Uma vez só**, em Audio Setup:

| Ajuste | Valor |
|---|---|
| Host | Windows WASAPI |
| Dispositivo de gravação | a saída em que você ouve a aula, com `(loopback)` no nome |
| Monitoramento de entrada | desligado |
| Taxa do projeto | 48000 Hz (a mesma do Windows, para não haver conversão durante a gravação) |

**Em toda aula:** feche o que faz som, dê play na aula em 1x e clique em gravar. Ao terminar, pare.

## Exportar para transcrição

**Arquivo › Exportar áudio** (`Ctrl` + `Shift` + `E`). Não use **Salvar**: ele cria um projeto `.aup4`, que não dá para transcrever.

| Campo | Valor | Por quê |
|---|---|---|
| Tipo | Todo o áudio do projeto | |
| Nome do arquivo | `ModuloNN_aulaNN`, ex.: `Modulo02_aula03` | Mantém as aulas em ordem na pasta |
| Pasta | `...\Aulas transcrição\Gravações` | É onde o transcritor procura |
| Formato | **FLAC Files** | Sem perda e com metade do tamanho do WAV |
| Canais | **Mono** | Voz não precisa de estéreo |
| Taxa de amostragem | **16000 Hz** | É a taxa que o Whisper usa internamente |
| Profundidade dos bits | **16 bit** | Suficiente para voz |
| Nível | **5** | Compressão do FLAC; qualquer nível é sem perda |
| Aparar o espaço em branco antes do primeiro clipe | **desmarcado** | Mantém os tempos iguais aos da gravação |

Uma aula de 1h45 fica com cerca de 80 MB.

O Whisper converte qualquer entrada para 16 kHz mono antes de transcrever. Por isso, exportar já nesse formato não muda o resultado e deixa o arquivo muito menor. Se quiser guardar uma cópia para reeditar ou publicar, exporte outra em FLAC a 48000 Hz.

## Transcrever

Arraste o arquivo da aula para cima de `transcrever.bat`. Ao lado do áudio aparece a pasta `<arquivo> - transcricao` com:

| Arquivo | Para que serve |
|---|---|
| `transcricao.md` | Texto em parágrafos, com o tempo. Use este para estudar e gerar materiais |
| `legendas.srt` | Legendas sincronizadas |
| `segmentos.json` | Tempo e confiança de cada trecho |

Trechos com **[conferir]** tiveram baixa confiança. Confira números, nomes e citações no áudio.

Se você arrastar a pasta `Gravações` inteira, o que já foi transcrito é pulado. Para refazer uma aula, apague a pasta `- transcricao` dela ou rode com `--refazer`.

Pelo terminal, também dá para passar jargões do curso, o que melhora a grafia deles:

```powershell
& "$env:USERPROFILE\TranscritorAulas\venv\Scripts\python.exe" -I transcrever.py "Gravações\Modulo02_aula03.flac" --termos "ROAS, CPA, Shopify"
```

## Estrutura

```
transcrever.py      transcrição e geração dos arquivos
transcrever.bat     atalho para arrastar arquivos
instalar.bat        cria o ambiente e baixa o modelo
requirements.txt    dependências com versão fixa
tests/              testes (não precisam do modelo)
COMO USAR.html      guia passo a passo para o dia a dia
Gravações/          áudios e transcrições (fora do Git)
```

Os áudios e as transcrições não vão para o GitHub. São grandes, e o conteúdo do curso não é nosso para publicar. Cada máquina tem a sua pasta `Gravações`.

## Testes

```powershell
& "$env:USERPROFILE\TranscritorAulas\venv\Scripts\python.exe" -m pytest
```

## Uso

Confira se o curso permite gravar. As transcrições são para estudo pessoal: republicar ou vender o conteúdo exige autorização do autor.
