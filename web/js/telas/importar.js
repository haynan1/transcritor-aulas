// @ts-check
// Importar: arrastar ou escolher gravações, enviar com progresso e conferir o formato.

import { api } from "../api.js";
import { bytes, duracao, h, icone, seloFormato, toast, trocar } from "../ui.js";

const EXTENSOES = [".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".mp4", ".mkv", ".webm", ".mov", ".avi"];
const PROJETOS = [".aup", ".aup3", ".aup4"];
const CHAVE_PREFERENCIAS = "tc-importar";

function extensao(nome) {
  const i = nome.lastIndexOf(".");
  return i < 0 ? "" : nome.slice(i).toLowerCase();
}

/** Mesmas regras do servidor: letras, números, espaço e . _ - ( ). */
export function nomeSeguro(nome) {
  const ext = extensao(nome);
  let base = nome.slice(0, nome.length - ext.length).normalize("NFC");
  base = base.replace(/[^\p{L}\p{N}_\- .()]/gu, "_").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "");
  if (!base) base = "aula";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base}_`;
  return `${base.slice(0, 150 - ext.length)}${ext}`;
}

function lerPreferencias() {
  try {
    return { transcrever: true, idioma: "pt", termos: "", ...JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) || "{}") };
  } catch {
    return { transcrever: true, idioma: "pt", termos: "" };
  }
}

function guardarPreferencias(p) {
  try {
    localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify(p));
  } catch {
    /* sem armazenamento: as escolhas valem só agora */
  }
}

// Os envios vivem fora da tela: trocar de tela no meio de um envio não o interrompe.
const fila = []; // na ordem de chegada; um por vez para não disputar o disco
let enviando = false;
/** @type {(envio: any) => void} */
let pintarEnvioAtual = () => {};
/** @type {() => {transcrever: boolean, idioma: string, termos: string}} */
let opcoesAtuais = () => ({ transcrever: true, idioma: "pt", termos: "" });
/** @type {any} */
let appAtual = null;

export function montar(raiz, app) {
  const prefs = lerPreferencias();
  appAtual = app;

  const seletor = /** @type {HTMLInputElement} */ (
    h("input", { type: "file", multiple: true, accept: [...EXTENSOES, "audio/*", "video/*"].join(","), class: "visualmente-oculto", tabindex: "-1", "aria-hidden": "true" })
  );
  const zona = h(
    "button",
    { type: "button", class: "soltar", "aria-describedby": "ajuda-soltar" },
    h("span", { class: "soltar-icone" }, icone("importar", 22)),
    h("strong", null, "Arraste as gravações para cá"),
    h("span", { id: "ajuda-soltar" }, "ou clique para escolher. FLAC, MP3, WAV, M4A e vídeos. Até 4 GB por arquivo."),
  );
  zona.addEventListener("click", () => seletor.click());
  seletor.addEventListener("change", () => {
    adicionar([...(seletor.files || [])]);
    seletor.value = "";
  });
  for (const tipo of ["dragenter", "dragover"]) {
    zona.addEventListener(tipo, (e) => {
      e.preventDefault();
      zona.dataset.ativo = "";
    });
  }
  for (const tipo of ["dragleave", "drop"]) zona.addEventListener(tipo, () => delete zona.dataset.ativo);
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    adicionar([...(e.dataTransfer?.files || [])]);
  });
  // Soltar fora da zona não deve abrir o arquivo no navegador e sair do painel.
  const impedir = (e) => e.preventDefault();
  window.addEventListener("dragover", impedir);
  window.addEventListener("drop", impedir);

  const transcreverAoImportar = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", id: "op-transcrever" }));
  transcreverAoImportar.checked = prefs.transcrever;
  const idioma = /** @type {HTMLSelectElement} */ (
    h(
      "select",
      { class: "seletor", id: "op-idioma" },
      h("option", { value: "pt" }, "Português"),
      h("option", { value: "en" }, "Inglês"),
      h("option", { value: "es" }, "Espanhol"),
      h("option", { value: "auto" }, "Detectar sozinho"),
    )
  );
  idioma.value = prefs.idioma;
  const termos = /** @type {HTMLInputElement} */ (
    h("input", { class: "entrada", id: "op-termos", maxlength: "500", placeholder: "ROAS, CPA, Shopify", "aria-describedby": "ajuda-termos", autocomplete: "off" })
  );
  termos.value = prefs.termos;
  const salvar = () =>
    guardarPreferencias({ transcrever: transcreverAoImportar.checked, idioma: idioma.value, termos: termos.value.trim() });
  for (const c of [transcreverAoImportar, idioma, termos]) c.addEventListener("change", salvar);

  const listaEnvios = h("ul", { class: "envios" });
  const cartaoEnvios = h(
    "section",
    { class: "cartao", "aria-labelledby": "titulo-envios", hidden: true },
    h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-envios" }, icone("fila"), "Envios")),
    listaEnvios,
  );

  const ficha = (pares) =>
    h("dl", { class: "ficha" }, ...pares.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v))));

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
          h("span", { class: "sobretitulo" }, "Importar"),
          h("h1", null, "Trazer gravações"),
          h("p", null, "O arquivo é copiado para a pasta Gravações e, se você quiser, entra direto na fila de transcrição."),
        ),
      ),
      h(
        "div",
        { class: "grade-importar" },
        h(
          "div",
          { class: "coluna" },
          zona,
          seletor,
          h(
            "section",
            { class: "cartao", "aria-labelledby": "titulo-opcoes" },
            h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-opcoes" }, "Ao importar")),
            h(
              "div",
              { class: "cartao-corpo opcoes" },
              h(
                "label",
                { class: "alternar", for: "op-transcrever" },
                transcreverAoImportar,
                h("span", null, h("strong", null, "Transcrever em seguida"), h("span", null, "A aula entra na fila assim que terminar de enviar.")),
              ),
              h(
                "div",
                { class: "opcoes-linha" },
                h("div", { class: "campo" }, h("label", { for: "op-idioma" }, "Idioma da aula"), idioma),
                h(
                  "div",
                  { class: "campo" },
                  h("label", { for: "op-termos" }, "Termos do curso ", h("span", { class: "ajuda" }, "(opcional)")),
                  termos,
                  h("span", { class: "ajuda", id: "ajuda-termos" }, "Nomes e jargões que aparecem na aula, separados por vírgula. Melhoram a grafia deles no texto."),
                ),
              ),
            ),
          ),
          cartaoEnvios,
        ),
        h(
          "div",
          { class: "coluna" },
          h(
            "section",
            { class: "cartao", "aria-labelledby": "titulo-formato" },
            h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-formato" }, icone("onda"), "Formato ideal")),
            h(
              "div",
              { class: "cartao-corpo" },
              ficha([
                ["Formato", "FLAC"],
                ["Canais", "Mono"],
                ["Taxa de amostragem", "16000 Hz"],
                ["Profundidade", "16 bit"],
              ]),
              h(
                "p",
                { class: "rodape-tela" },
                "O Whisper converte tudo para 16 kHz mono antes de transcrever. Exportar assim não muda o resultado e deixa o arquivo até 8 vezes menor. Outros formatos funcionam do mesmo jeito.",
              ),
            ),
            h("div", { class: "resumo-fila" }, h("a", { href: "#/manual/exportar" }, "Como exportar no Audacity 4 →")),
          ),
        ),
      ),
    ),
  );

  /** @param {File[]} arquivos */
  function adicionar(arquivos) {
    const existentes = new Set((app.aulas || []).map((a) => a.nome.toLowerCase()));
    for (const arquivo of arquivos) {
      const ext = extensao(arquivo.name);
      const envio = { arquivo, nome: nomeSeguro(arquivo.name), estado: "aguardando", enviado: 0, erro: "", resultado: null, cancelar: null, el: h("li", { class: "envio" }) };
      if (PROJETOS.includes(ext)) {
        envio.estado = "erro";
        envio.erro = "É um projeto do Audacity. Abra no Audacity e use Arquivo › Exportar áudio para gerar um FLAC.";
      } else if (!EXTENSOES.includes(ext)) {
        envio.estado = "erro";
        envio.erro = `Formato ${ext || "sem extensão"} não é aceito.`;
      } else if (arquivo.size === 0) {
        envio.estado = "erro";
        envio.erro = "O arquivo está vazio.";
      } else if (arquivo.size > 4 * 1024 ** 3) {
        envio.estado = "erro";
        envio.erro = "O arquivo passa de 4 GB. Exporte em FLAC mono a 16 kHz para reduzir.";
      } else if (existentes.has(envio.nome.toLowerCase()) || fila.some((f) => f.nome.toLowerCase() === envio.nome.toLowerCase() && f.estado !== "erro")) {
        envio.estado = "erro";
        envio.erro = `Já existe uma aula chamada ${envio.nome}. Renomeie o arquivo antes de importar.`;
      }
      fila.push(envio);
      listaEnvios.prepend(envio.el);
      pintarEnvio(envio);
    }
    cartaoEnvios.hidden = fila.length === 0;
    processar();
  }

  function pintarEnvio(envio) {
    if (!envio.el.isConnected && !listaEnvios.contains(envio.el)) return;
    const pct = envio.arquivo.size ? Math.round((envio.enviado / envio.arquivo.size) * 100) : 0;
    const detalhe = {
      aguardando: `${bytes(envio.arquivo.size)} · aguardando`,
      enviando: `${bytes(envio.enviado)} de ${bytes(envio.arquivo.size)} · ${pct}%`,
      analisando: "Conferindo o áudio…",
      pronto: "Importada",
      erro: "",
    }[envio.estado];
    const topo = h(
      "div",
      { class: "envio-topo" },
      h("div", null, h("div", { class: "envio-nome" }, envio.nome), envio.nome !== envio.arquivo.name ? h("div", { class: "envio-detalhe" }, `Original: ${envio.arquivo.name}`) : null),
      envio.estado === "enviando" || envio.estado === "aguardando"
        ? h("button", { type: "button", class: "botao botao-pequeno botao-fantasma", onclick: () => cancelarEnvio(envio) }, "Cancelar")
        : envio.estado === "pronto"
          ? h("span", { class: "selo", dataset: { tom: "sinal" } }, icone("ok"), "Importada")
          : envio.estado === "erro"
            ? h("span", { class: "selo", dataset: { tom: "perigo" } }, icone("erro"), "Não importada")
            : null,
    );
    const filhos = [topo];
    if (envio.estado === "enviando" || envio.estado === "analisando") {
      const barra = h("div", { class: "barra-preenchida" });
      barra.style.setProperty("transform", `scaleX(${envio.estado === "analisando" ? 1 : pct / 100})`);
      filhos.push(h("div", { class: "barra barra-fina", role: "progressbar", "aria-label": `Envio de ${envio.nome}`, "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, barra));
    }
    if (detalhe) filhos.push(h("div", { class: "envio-detalhe num" }, detalhe));
    if (envio.estado === "erro") filhos.push(h("p", { class: "fila-erro", role: "alert" }, envio.erro));
    if (envio.estado === "pronto" && envio.resultado) {
      const { formato, trabalho } = envio.resultado;
      filhos.push(
        h(
          "div",
          { class: "aula-meta" },
          seloFormato(formato),
          h("span", { class: "num" }, duracao(formato.duracao)),
          trabalho ? h("a", { href: "#/" }, "Na fila · acompanhar no Painel") : h("a", { href: "#/biblioteca" }, "Ver na Biblioteca"),
        ),
      );
      if (!formato.recomendado) {
        filhos.push(
          h(
            "ul",
            { class: "envio-avisos" },
            ...formato.avisos.map((a) => h("li", null, icone("atencao", 14), a)),
            h("li", null, icone("manual", 14), h("a", { href: "#/manual/exportar" }, "Como exportar no formato ideal")),
          ),
        );
      }
    }
    trocar(envio.el, ...filhos);
  }

  function cancelarEnvio(envio) {
    if (envio.estado === "enviando") envio.cancelar?.();
    else {
      envio.estado = "erro";
      envio.erro = "Envio cancelado.";
      pintarEnvio(envio);
    }
  }

  pintarEnvioAtual = pintarEnvio;
  opcoesAtuais = () => ({ transcrever: transcreverAoImportar.checked, idioma: idioma.value, termos: termos.value.trim() });
  // Ao voltar para a tela, mostra os envios desta sessão.
  for (const envio of fila) {
    envio.el = h("li", { class: "envio" });
    listaEnvios.prepend(envio.el);
    pintarEnvio(envio);
  }
  cartaoEnvios.hidden = fila.length === 0;

  return {
    destruir() {
      window.removeEventListener("dragover", impedir);
      window.removeEventListener("drop", impedir);
      pintarEnvioAtual = () => {};
    },
  };
}

async function processar() {
  if (enviando) return;
  const envio = fila.find((f) => f.estado === "aguardando");
  if (!envio) return;
  enviando = true;
  envio.estado = "enviando";
  pintarEnvioAtual(envio);
  let ultimo = 0;
  const tarefa = api.importar(
    envio.arquivo,
    envio.nome,
    opcoesAtuais(),
    (enviado, total) => {
      envio.enviado = enviado;
      if (enviado >= total) envio.estado = "analisando";
      const agora = performance.now();
      if (agora - ultimo > 120 || enviado >= total) {
        ultimo = agora;
        pintarEnvioAtual(envio);
      }
    },
  );
  envio.cancelar = tarefa.cancelar;
  try {
    envio.resultado = await tarefa.promessa;
    envio.estado = "pronto";
    toast(envio.resultado.trabalho ? `${envio.nome} importada e na fila.` : `${envio.nome} importada.`);
    appAtual?.recarregarAulas();
  } catch (erro) {
    envio.estado = "erro";
    envio.erro = erro.message;
  }
  pintarEnvioAtual(envio);
  enviando = false;
  processar();
}
