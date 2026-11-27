// @ts-check
// Manual: do Audacity 4 até o estudo com o Claude. Conteúdo estático, montado com h().

import { decimal, duracao, h, icone, toast } from "../ui.js";

const PEDIDO_CLAUDE =
  "Esta é a transcrição de uma aula, com minhas anotações e prints. Corrija pelo contexto os erros de transcrição e me diga onde ficou em dúvida. Monte: 1) resumo; 2) conceitos e frameworks, com o tempo da aula; 3) estratégias aplicadas ao meu contexto; 4) checklist e plano de ação. Priorize o que marquei com !, explique o que marquei com ? e desenvolva o que marquei com *. Separe o que o professor disse do que é sugestão sua.";

function codigo(texto, rotulo) {
  return h(
    "div",
    { class: "codigo" },
    h("pre", null, texto),
    h(
      "button",
      {
        type: "button",
        class: "botao botao-pequeno",
        "aria-label": `Copiar ${rotulo}`,
        onclick: () =>
          navigator.clipboard.writeText(texto).then(
            () => toast("Copiado."),
            () => toast("Não consegui copiar. Selecione o texto e use Ctrl+C.", "perigo"),
          ),
      },
      icone("copiar"),
      "Copiar",
    ),
  );
}

function tabela(cabecalho, linhas) {
  return h(
    "div",
    { class: "rolagem" },
    h(
      "table",
      { class: "tabela" },
      h("thead", null, h("tr", null, ...cabecalho.map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", null, ...linhas.map((l) => h("tr", null, ...l.map((c, i) => h("td", { class: i === 1 ? "valor" : undefined }, c))))),
    ),
  );
}

function capitulo(id, numero, titulo, ...conteudo) {
  return h(
    "section",
    { class: "capitulo", id: `manual-${id}`, "aria-labelledby": `titulo-${id}` },
    h("h2", { id: `titulo-${id}` }, h("span", { class: "num" }, String(numero).padStart(2, "0")), titulo),
    ...conteudo,
  );
}

function janelaExportar(pasta) {
  const campo = (rotulo, valor, nota) =>
    h("div", { class: "janela-campo" }, h("span", null, rotulo), h("span", { class: "janela-valor" }, valor, nota ? h("small", null, nota) : null));
  return h(
    "figure",
    { class: "janela", "aria-label": "Janela Exportar áudio do Audacity 4 preenchida com os valores recomendados" },
    h("div", { class: "janela-titulo" }, icone("onda", 14), "Exportar áudio"),
    h(
      "div",
      { class: "janela-corpo" },
      h("div", { class: "janela-secao" }, "Exportar"),
      campo("Tipo", "Todo o áudio do projeto"),
      h("div", { class: "janela-secao" }, "Arquivo"),
      campo("Nome do arquivo", "Modulo02_aula03", "ModuloNN_aulaNN"),
      campo("Pasta", pasta),
      campo("Formato", "FLAC Files", "sem perda"),
      h("div", { class: "janela-secao" }, "Opções de áudio"),
      campo("Canais", "Mono", "voz não precisa de estéreo"),
      campo("Taxa de amostragem", "16000 Hz", "a taxa do Whisper"),
      campo("Profundidade dos bits", "16 bit"),
      campo("Nível", "5", "qualquer nível é sem perda"),
      h("div", { class: "janela-secao" }, "Renderizando"),
      campo("Aparar o espaço em branco", "Desmarcado", "mantém os tempos"),
    ),
  );
}

export function montar(raiz, app, ancora) {
  const ritmo = h("p");
  // Na réplica da janela do Audacity, a pasta real deste computador (chega com a config).
  const pasta = h("span", null, "…\\Aulas transcrição\\Gravações");

  const secoes = [
    ["instalar", "Instalar"],
    ["audacity", "Preparar o Audacity 4"],
    ["gravar", "Gravar a aula"],
    ["exportar", "Exportar"],
    ["transcrever", "Importar e transcrever"],
    ["ler", "Ler e estudar"],
    ["problemas", "Se algo der errado"],
  ];

  raiz.append(
    h(
      "div",
      { class: "tela" },
      h(
        "header",
        { class: "cabeca" },
        h(
          "div",
          null,
          h("span", { class: "sobretitulo" }, "Manual"),
          h("h1", null, "Da gravação ao texto"),
          h("p", null, "Grave no Audacity 4, exporte no formato certo, importe aqui e acompanhe. Tudo roda no seu computador: o áudio não vai para a internet."),
        ),
      ),
      h(
        "div",
        { class: "manual" },
        h(
          "nav",
          { class: "sumario", "aria-label": "Seções do manual" },
          ...secoes.map(([id, nome]) => h("a", { href: `#/manual/${id}` }, nome)),
        ),
        h(
          "div",
          { class: "capitulos" },
          capitulo(
            "instalar",
            1,
            "Instalar",
            h("p", null, "Uma vez por computador. Abra o PowerShell pelo menu Iniciar e rode:"),
            codigo("winget install --id Git.Git -e\nwinget install --id astral-sh.uv -e\nwinget install --id Audacity.Audacity -e", "comandos de instalação"),
            h("p", null, "Depois, clone o projeto e dê dois cliques em ", h("strong", null, "instalar.bat"), ". Ele prepara o Python e baixa o modelo (cerca de 1,6 GB, uma vez só)."),
            codigo('git clone https://github.com/haynan1/transcritor-aulas.git "$HOME\\Desktop\\Aulas transcrição"', "comando de clone"),
            h("p", null, "Para abrir este painel, dê dois cliques em ", h("strong", null, "iniciar.bat"), "."),
          ),
          capitulo(
            "audacity",
            2,
            "Preparar o Audacity 4",
            h("p", null, "Use o ", h("strong", null, "Audacity 4.0"), " ou mais novo. Em ", h("strong", null, "Audio Setup"), ", ajuste uma vez:"),
            tabela(
              ["Ajuste", "Valor", "Por quê"],
              [
                ["Host", "Windows WASAPI", "É o único que grava o som interno do Windows"],
                ["Dispositivo de gravação", "Sua saída (loopback)", "Grava exatamente o que você ouve"],
                ["Monitoramento de entrada", "Desligado", "Evita eco na gravação"],
                ["Taxa do projeto", "48000 Hz", "A mesma do Windows: nada é convertido durante a gravação"],
              ],
            ),
            h("p", null, "Faça um teste de 20 segundos com um vídeo tocando. Se sair mudo, escolha outro dispositivo com (loopback) no nome."),
          ),
          capitulo(
            "gravar",
            3,
            "Gravar a aula",
            h(
              "ol",
              { class: "passos" },
              h("li", null, h("p", null, h("strong", null, "Silencie o resto. "), "A gravação pega tudo o que toca no computador. Feche WhatsApp e abas com som e ative o Assistente de Foco.")),
              h("li", null, h("p", null, h("strong", null, "Dê play e depois grave. "), "Comece a aula em velocidade 1x e clique em gravar logo em seguida. Se quiser a primeira frase, volte o vídeo ao início.")),
              h("li", null, h("p", null, h("strong", null, "Anote o que o áudio não mostra. "), "Win + PrtScn salva a tela. Nas notas, use o tempo do vídeo e um sinal: ! para aplicar, ? para dúvida, * para ideia sua.")),
              h("li", null, h("p", null, h("strong", null, "Pode transcrever enquanto grava. "), "A transcrição roda com prioridade abaixo do normal para não picotar a gravação.")),
            ),
          ),
          capitulo(
            "exportar",
            4,
            "Exportar",
            h("p", null, "Use ", h("strong", null, "Arquivo › Exportar áudio"), " (Ctrl + Shift + E). Não use ", h("strong", null, "Salvar"), ": ele cria um projeto .aup4, que não dá para transcrever. Preencha a janela assim:"),
            janelaExportar(pasta),
            h(
              "p",
              null,
              "O Whisper converte qualquer áudio para 16 kHz mono antes de transcrever. Exportar já assim não muda nada no texto e deixa uma aula de quase 2 horas com cerca de 80 MB, contra 650 MB em WAV. Se quiser guardar uma cópia para editar ou publicar, exporte outra em FLAC a 48000 Hz.",
            ),
          ),
          capitulo(
            "transcrever",
            5,
            "Importar e transcrever",
            h(
              "ol",
              { class: "passos" },
              h("li", null, h("p", null, "Abra ", h("a", { href: "#/importar" }, "Importar"), " e arraste o arquivo. Se você exportou direto para a pasta Gravações, ele já aparece na ", h("a", { href: "#/biblioteca" }, "Biblioteca"), ": é só clicar em Transcrever.")),
              h("li", null, h("p", null, "Em ", h("strong", null, "Termos do curso"), ", liste nomes e jargões da aula. O modelo passa a escrevê-los certo.")),
              h("li", null, h("p", null, "Acompanhe no ", h("a", { href: "#/" }, "Painel"), ": porcentagem, tempo restante, velocidade e uso do processador. Pode fechar a aba: a transcrição continua enquanto a janela do iniciar.bat estiver aberta.")),
            ),
            ritmo,
          ),
          capitulo(
            "ler",
            6,
            "Ler e estudar",
            h("p", null, "No leitor, clique no tempo de um parágrafo para ouvir aquele trecho. Espaço toca e pausa, as setas voltam e avançam 5 segundos e / abre a busca. Trechos marcados com ", h("strong", null, "conferir"), " tiveram baixa confiança: confira números, nomes e citações no áudio."),
            h("p", null, "Para gerar material de estudo, baixe o .md e envie ao Claude com suas notas e prints, junto com este pedido:"),
            codigo(PEDIDO_CLAUDE, "pedido para o Claude"),
          ),
          capitulo(
            "problemas",
            7,
            "Se algo der errado",
            tabela(
              ["O que aconteceu", "O que fazer"],
              [
                ["A gravação saiu muda", "Escolha o dispositivo com (loopback) da saída que você está ouvindo."],
                ["O Audacity não começa a gravar", "Dê play na aula antes de clicar em gravar."],
                ["Eco na gravação", "Desligue o monitoramento de entrada."],
                ["Os tempos não batem com o vídeo", "Se você pausou a aula, o relógio da gravação muda. Anote o início de cada retomada."],
                ["“É um projeto do Audacity”", "Abra no Audacity e use Arquivo › Exportar áudio."],
                ["“Já existe uma aula chamada…”", "Renomeie o arquivo antes de importar. Nada é sobrescrito."],
                ["Erro ao transcrever", "O arquivo pode estar corrompido. Exporte de novo pelo Audacity e importe outra vez."],
                ["“Modelo não encontrado”", "Rode instalar.bat. Precisa de internet uma vez."],
                ["O painel não abre", "Dê dois cliques em iniciar.bat. Se já estiver aberto, ele só abre o navegador."],
              ],
            ),
            h("p", { class: "aviso" }, icone("atencao"), h("span", null, "Confira se o curso permite gravar. As transcrições são para estudo pessoal: republicar ou vender o conteúdo exige autorização do autor.")),
          ),
        ),
      ),
    ),
  );

  if (ancora) {
    const alvo = document.getElementById(`manual-${ancora}`);
    requestAnimationFrame(() => alvo?.scrollIntoView({ block: "start" }));
  }

  return {
    atualizar() {
      if (app.config) pasta.textContent = app.config.gravacoes;
      const velocidade = app.estado?.fila?.velocidade_referencia;
      ritmo.textContent = velocidade
        ? `Neste computador, a última aula transcreveu a ${decimal(velocidade)} vezes o tempo real: uma aula de 2 horas leva cerca de ${duracao(7200 / velocidade)}.`
        : "Neste computador, uma aula costuma transcrever de 3 a 4 vezes mais rápido que a duração dela: 2 horas de aula levam por volta de 30 a 40 minutos.";
    },
  };
}
