# Arquitetura

O Transcriptor Class é um programa local de um usuário só: um servidor Python em `127.0.0.1` que serve a interface e coordena a transcrição, com o modelo rodando na CPU.

```
navegador ──HTTP/SSE──▶ FastAPI (127.0.0.1:7351)
                          ├─ Biblioteca ─▶ pasta Gravações (fonte da verdade)
                          ├─ Fila ─spawn─▶ processo de transcrição (1 por aula)
                          │                   └─ faster-whisper / CTranslate2 int8
                          └─ Monitor ────▶ psutil (CPU, núcleos, memória)
```

## Stack e por quê

| Peça | Escolha | Por quê |
|---|---|---|
| Transcrição | faster-whisper 1.2.1, `large-v3-turbo`, int8 na CPU | Melhor precisão por segundo de CPU disponível para português. O int8 do CTranslate2 roda a ~3–4× o tempo real numa CPU de 16 núcleos, sem GPU |
| Servidor | FastAPI + Uvicorn | Async nativo para o fluxo de eventos (SSE) e o upload em streaming, validação de entrada com Pydantic. O Flask é síncrono e faria o SSE ocupar uma thread por aba |
| Tempo real | Server-Sent Events | O fluxo é de mão única (servidor → painel). O SSE reconecta sozinho e não precisa de biblioteca. WebSocket seria complexidade sem uso |
| Métricas | psutil | CPU por núcleo e do processo de transcrição, e prioridade do processo, com a mesma API em qualquer sistema |
| Interface | HTML, CSS e ES modules, sem build | Cinco telas não justificam bundler e Node em cada máquina. O tipo é conferido com `tsc --checkJs` (JSDoc), sem gerar nada |
| Fontes | Geist, Geist Mono e Newsreader, dentro do projeto | Funciona sem internet. Mono com algarismos tabulares nos números que mudam a cada segundo. Serifada editorial para ler aulas longas |
| Pacotes | uv + `uv.lock` | Instala o Python certo sozinho e trava cada dependência com hash. Um comando prepara qualquer máquina |
| Qualidade | pytest, ruff, mypy `strict` | |

## Decisões

**Um processo por aula.** A transcrição roda em `multiprocessing` (spawn), não numa thread. Cancelar é encerrar o processo, na hora. Uma falha do modelo não derruba o painel. O processo roda com prioridade abaixo do normal para não picotar uma gravação feita ao mesmo tempo. Carregar o modelo a cada aula custa alguns segundos, contra 30 minutos de transcrição.

**O disco é a fonte da verdade.** Uma aula está transcrita quando `segmentos.json` existe e é mais novo que o áudio. Ele é gravado por último e de forma atômica (arquivo temporário + `replace`), então nunca há resultado pela metade. O painel e o `transcrever.bat` leem e gravam o mesmo formato.

**A fila sobrevive a reinícios.** A ordem é gravada em `Gravações/.transcriptor-fila.json` a cada mudança. Ao fechar o painel no meio de uma aula, ela volta para a frente da fila e recomeça ao abrir.

**Estimativa de tempo.** Velocidade = segundos de áudio processados / segundos de relógio desde que o modelo começou. Só aparece depois de 8 s medindo. Para aulas na fila, usa a velocidade da aula atual ou da última concluída (marcada como "estim.").

**Upload em streaming.** `PUT /api/aulas/{nome}` com o corpo bruto, sem multipart. O servidor grava direto no disco em pedaços, então um WAV de 2 GB não passa pela memória. O XHR do navegador informa o progresso.

## Segurança

O servidor lê e grava arquivos, então é tratado como superfície de ataque mesmo sendo local.

| Ameaça | Defesa |
|---|---|
| Acesso pela rede | Escuta só em `127.0.0.1`, fixo no código, sem variável que exponha |
| DNS rebinding (um site apontando o próprio domínio para 127.0.0.1) | `TrustedHostMiddleware` aceita só `127.0.0.1` e `localhost` |
| CSRF (uma página qualquer disparando escrita no painel) | Toda escrita exige o cabeçalho `x-transcriptor: 1` (força preflight de CORS, que nunca é aprovado). `Sec-Fetch-Site` e `Origin` precisam ser do próprio painel. Não há CORS |
| Path traversal | O nome passa por lista de caracteres permitidos (letras, números, espaço, `. _ - ( )`), é normalizado em NFC, os nomes reservados do Windows são recusados, e o caminho resolvido precisa ficar direto na pasta Gravações |
| Sobrescrever uma aula | Upload recusa nome existente (409). O temporário é renomeado com `rename`, que falha no Windows se o destino existir |
| Arquivo malicioso ou que não é áudio | Só extensões de mídia. O cabeçalho é lido pelo PyAV antes de aceitar. Limite de 4 GB e checagem de espaço livre (507) |
| XSS | Todo dado do servidor entra na página por `textContent`. `innerHTML` só com os ícones, que são constantes do código. CSP sem `unsafe-inline` |
| Clickjacking, sniffing, vazamento de referer | CSP `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP |
| Dependências | `uv.lock` com hash. `pip-audit` sem vulnerabilidades conhecidas. Documentação automática da API desligada |

Esses pontos estão cobertos por testes em `tests/test_api.py`.

**Por que não há Docker.** O painel existe para mostrar a CPU deste computador e ler a pasta Gravações dele. Dentro de um contêiner no Windows, o psutil mediria a máquina virtual do WSL, o acesso aos arquivos passaria por um compartilhamento mais lento e o `.bat` de arrastar e soltar deixaria de funcionar. Não há banco, cache ou outro serviço para orquestrar. O `uv.lock` cumpre o papel de reprodutibilidade.

## Estrutura

```
transcriptor/
  config.py       configuração do ambiente, com padrões
  motor.py        transcrever um arquivo e montar md/srt/json (núcleo, sem servidor)
  cli.py          linha de comando (transcrever.bat)
  trabalhador.py  processo de transcrição: carrega o modelo e relata o andamento
  fila.py         fila, processo por aula, estimativas e persistência
  biblioteca.py   a pasta Gravações como lista de aulas; validação de nomes
  midia.py        leitura do formato do áudio e comparação com o ideal
  sistema.py      amostragem de CPU e memória
  api.py          rotas, SSE, upload e middleware de segurança
  __main__.py     sobe o servidor e abre o navegador (iniciar.bat)
web/
  index.html, css/app.css, fonts/
  js/app.js       estado vivo (SSE), rotas e casca
  js/telas/       painel, biblioteca, importar, leitor, manual
tests/            pytest; trabalhadores falsos rodam em processo real
```

## Portas e arquivos

| | |
|---|---|
| Porta | `7351` em `127.0.0.1` (`TRANSCRIPTOR_PORTA`) |
| Ambiente | `.venv/` no projeto |
| Modelo | `%USERPROFILE%\TranscritorAulas\modelo-large-v3-turbo` (fora do projeto, para não ser baixado de novo a cada clone) |
| Dados | `Gravações/` (fora do Git) |

## Custo

Zero por operação: nenhuma API externa. O custo é CPU local. Uma aula de 1h45 levou 28 minutos neste computador (3,7× o tempo real), usando 16 threads.
