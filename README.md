# Transcriptor Class

Painel local para transcrever aulas gravadas. Importe a gravação, acompanhe a transcrição com tempo restante e uso do processador, e leia o texto com o áudio sincronizado.

Tudo roda no seu computador, com o Whisper `large-v3-turbo` via [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Nenhum áudio vai para a internet.

| Tela | O que faz |
|---|---|
| **Painel** | Aula transcrevendo agora: porcentagem, tempo restante, velocidade e o texto chegando. Fila com previsão de término. CPU em tempo real (máquina e transcrição), núcleos e memória |
| **Biblioteca** | Todas as aulas da pasta `Gravações`, com formato, duração e estado. Transcrever, refazer, ler e baixar `.md` e `.srt` |
| **Importar** | Arrastar gravações, com progresso do envio e conferência do formato |
| **Leitor** | Texto em parágrafos com o tempo. Clique no tempo para ouvir o trecho. Busca, cópia e o texto ao vivo enquanto transcreve |
| **Manual** | Do Audacity 4 ao estudo, com a janela de exportação preenchida |

Tem tema escuro e claro e funciona no celular.

## Instalar numa máquina nova

```powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e
winget install --id Audacity.Audacity -e
```

```powershell
git clone https://github.com/haynan1/transcritor-aulas.git "$HOME\Desktop\Aulas transcrição"
```

Feche e abra o PowerShell (para o `uv` entrar no PATH) e dê dois cliques em **`instalar.bat`**. Ele instala o Python certo, as dependências exatas do `uv.lock` e o modelo (cerca de 1,6 GB, uma vez só).

## Usar

Dê dois cliques em **`iniciar.bat`**. O painel abre em http://127.0.0.1:7351. Enquanto essa janela estiver aberta, as transcrições continuam, mesmo que você feche a aba do navegador. Ao fechar a janela, a fila é salva e retomada na próxima vez.

Para transcrever sem o painel, arraste o arquivo para cima de `transcrever.bat`.

## Exportar do Audacity 4

**Arquivo › Exportar áudio** (`Ctrl` + `Shift` + `E`):

| Campo | Valor | Por quê |
|---|---|---|
| Nome do arquivo | `ModuloNN_aulaNN` | Mantém as aulas em ordem |
| Pasta | `...\Aulas transcrição\Gravações` | A Biblioteca mostra o que estiver aqui |
| Formato | **FLAC Files** | Sem perda, com metade do tamanho do WAV |
| Canais | **Mono** | Voz não precisa de estéreo |
| Taxa de amostragem | **16000 Hz** | É a taxa que o Whisper usa internamente |
| Profundidade dos bits | **16 bit** | Suficiente para voz |
| Nível | **5** | Compressão do FLAC; qualquer nível é sem perda |
| Aparar o espaço em branco | **desmarcado** | Mantém os tempos iguais aos da gravação |

O passo a passo completo, com a gravação pelo loopback do Windows, está na tela **Manual** do painel.

## Formatos aceitos

Todos dão o mesmo texto: o Whisper converte tudo para 16 kHz mono antes de começar. O que muda é o tamanho do arquivo.

| Formato | Extensão | Observação |
|---|---|---|
| **FLAC** ✅ recomendado | `.flac` | Sem perda e com metade do tamanho do WAV. Exporte em mono, 16 kHz, 16 bit |
| WAV | `.wav` | Sem perda, mas grande: 2 h a 48 kHz passam de 600 MB |
| MP3 | `.mp3` | Com perda; transcreve bem a partir de 64 kbps |
| M4A / AAC | `.m4a`, `.aac` | Com perda; comum em gravações de celular |
| Opus | `.opus` | Com perda; o menor arquivo para voz |
| Ogg Vorbis | `.ogg` | Com perda |
| WMA | `.wma` | Com perda; funciona, mas prefira FLAC ou MP3 |
| Vídeo | `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi` | Usa só o som; o arquivo é muito maior |

Não são aceitos: projetos do Audacity (`.aup`, `.aup3`, `.aup4`, que precisam ser exportados antes) e, do menu do Audacity 4, *Other uncompressed* (AIFF), WavPack, AC3 e AMR (grava a 8 kHz e perde palavras).

## Ajustes

Variáveis de ambiente opcionais:

| Variável | Padrão |
|---|---|
| `TRANSCRIPTOR_PORTA` | `7351` |
| `TRANSCRIPTOR_THREADS` | número de núcleos físicos |
| `TRANSCRIPTOR_GRAVACOES` | `Gravações` dentro do projeto |
| `TRANSCRIPTOR_MODELO` | `%USERPROFILE%\TranscritorAulas\modelo-large-v3-turbo` |

## Desenvolvimento

```powershell
uv sync
uv run pytest
uv run ruff check
uv run mypy
```

Decisões de arquitetura e segurança: [ARCHITECTURE.md](ARCHITECTURE.md).

## Uso e licença

Confira se o curso permite gravar. As transcrições são para estudo pessoal: republicar ou vender o conteúdo exige autorização do autor.

O código está sob a licença [MIT](LICENSE). Ela cobre só o código deste repositório, e não as aulas gravadas nem as transcrições. As fontes em `web/fonts` estão sob a SIL Open Font License ([OFL.txt](web/fonts/OFL.txt)).
