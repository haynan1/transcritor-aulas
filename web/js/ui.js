// @ts-check
// Utilitários de interface: criação de elementos, ícones, formatação e avisos.
// Todo texto vindo do servidor entra por textContent: nunca por innerHTML.

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...(Node | string | number | null | undefined | false)} filhos
 * @returns {HTMLElement}
 */
export function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (chave === "class") el.className = valor;
    else if (chave === "dataset") Object.assign(el.dataset, valor);
    else if (chave.startsWith("on") && typeof valor === "function") el.addEventListener(chave.slice(2), valor);
    else if (chave === "text") el.textContent = String(valor);
    else el.setAttribute(chave, valor === true ? "" : String(valor));
  }
  for (const filho of filhos) {
    if (filho === null || filho === undefined || filho === false) continue;
    el.append(typeof filho === "number" ? String(filho) : filho);
  }
  return el;
}

/** Troca todo o conteúdo de um elemento. */
export function trocar(el, ...filhos) {
  el.replaceChildren(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
}

// Traços no estilo Lucide (ISC), redesenhados num conjunto único de 24px e traço 1.75.
const ICONES = {
  painel: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  biblioteca: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  importar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  manual: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sistema: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  tocar: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  pausar: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
  refazer: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
  atencao: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  erro: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  onda: '<path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3"/>',
  copiar: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  texto: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8M16 17H8M10 9H8"/>',
  seta: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  fila: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  limpar: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  memoria: '<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.84V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.06a2 2 0 0 0 0-3.84Z"/>',
  seguir: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  marca: '<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>',
};

/**
 * @param {keyof typeof ICONES} nome
 * @param {number} [tamanho]
 */
export function icone(nome, tamanho = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(tamanho));
  svg.setAttribute("height", String(tamanho));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONES[nome]; // constante do próprio código, nunca dado do servidor
  return svg;
}

// ---- formatação ---------------------------------------------------------------------

const numeroBR = new Intl.NumberFormat("pt-BR");
const decimalBR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** @param {number} n */
export const numero = (n) => numeroBR.format(n);
/** @param {number} n */
export const decimal = (n) => decimalBR.format(n);

/** 01:05:09 */
export function relogio(segundos) {
  const total = Math.max(0, Math.floor(segundos || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/** 5:09 ou 1:05:09, para o player */
export function relogioCurto(segundos) {
  const texto = relogio(segundos);
  return texto.startsWith("00:") ? texto.slice(3).replace(/^0/, "") : texto.replace(/^0/, "");
}

/** 1 h 45 min · 12 min · 40 s */
export function duracao(segundos) {
  if (segundos === null || segundos === undefined || !isFinite(segundos)) return "—";
  const total = Math.round(segundos);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function bytes(n) {
  if (!n) return "0 B";
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(unidades.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${decimal(n / 1024 ** i)} ${unidades[i]}`;
}

const relativo = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function haQuanto(epochSegundos) {
  const diff = epochSegundos - Date.now() / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "agora";
  if (abs < 3600) return relativo.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return relativo.format(Math.round(diff / 3600), "hour");
  return relativo.format(Math.round(diff / 86400), "day");
}

export function horaDeTermino(segundosRestantes) {
  const fim = new Date(Date.now() + segundosRestantes * 1000);
  return fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export const IDIOMAS = { pt: "Português", en: "Inglês", es: "Espanhol", auto: "Detectar" };

/** @typedef {{texto: string, tom: string, icone: keyof typeof ICONES | null, pulso?: boolean}} InfoEstado */

/** @type {Record<string, InfoEstado>} */
export const ESTADOS = {
  na_fila: { texto: "Na fila", tom: "", icone: "fila" },
  carregando: { texto: "Carregando modelo", tom: "sinal", icone: null, pulso: true },
  transcrevendo: { texto: "Transcrevendo", tom: "sinal", icone: null, pulso: true },
  concluido: { texto: "Concluída", tom: "sinal", icone: "ok" },
  transcrita: { texto: "Transcrita", tom: "sinal", icone: "ok" },
  pendente: { texto: "Não transcrita", tom: "", icone: null },
  erro: { texto: "Erro", tom: "perigo", icone: "erro" },
  cancelado: { texto: "Cancelada", tom: "", icone: "fechar" },
};

/** @param {string} estado */
export function seloEstado(estado) {
  /** @type {InfoEstado} */
  const info = ESTADOS[estado] || { texto: estado, tom: "", icone: null };
  return h(
    "span",
    { class: `selo${info.pulso ? " selo-pulso" : ""}`, dataset: info.tom ? { tom: info.tom } : undefined },
    info.icone ? icone(info.icone) : null,
    info.texto,
  );
}

export function seloFormato(formato) {
  if (!formato) return h("span", { class: "selo", dataset: { tom: "perigo" } }, icone("erro"), "Ilegível");
  const canais = formato.canais === 1 ? "mono" : formato.canais === 2 ? "estéreo" : `${formato.canais} canais`;
  const texto = `${formato.codec.toUpperCase()} · ${decimal(formato.taxa / 1000)} kHz · ${canais}`;
  if (formato.recomendado) return h("span", { class: "selo", title: "Formato recomendado" }, icone("ok"), texto);
  return h(
    "span",
    { class: "selo", dataset: { tom: "atencao" }, title: formato.avisos.join("\n") },
    icone("atencao"),
    texto,
    h("span", { class: "visualmente-oculto", text: `. ${formato.avisos.join(" ")}` }),
  );
}

// ---- avisos ---------------------------------------------------------------------------

/** @param {string} mensagem @param {"" | "perigo"} [tom] */
export function toast(mensagem, tom = "") {
  const area = document.getElementById("toasts");
  if (!area) return;
  const el = h("div", { class: "toast", role: "status", dataset: tom ? { tom } : undefined }, mensagem);
  area.append(el);
  setTimeout(() => el.remove(), tom === "perigo" ? 7000 : 4000);
}

/** Botão destrutivo que pede um segundo clique em vez de abrir um diálogo. */
export function botaoConfirmar({ rotulo, confirmar, acao, classe = "botao botao-pequeno botao-perigo", iconeNome }) {
  let armado = false;
  let relogioArmado = 0;
  const botao = /** @type {HTMLButtonElement} */ (h("button", { type: "button", class: classe }));
  const pintar = () => trocar(botao, iconeNome ? icone(iconeNome) : null, armado ? confirmar : rotulo);
  pintar();
  botao.addEventListener("click", async () => {
    if (!armado) {
      armado = true;
      pintar();
      relogioArmado = window.setTimeout(() => {
        armado = false;
        pintar();
      }, 4000);
      return;
    }
    clearTimeout(relogioArmado);
    botao.disabled = true;
    try {
      await acao();
    } finally {
      botao.disabled = false;
      armado = false;
      pintar();
    }
  });
  return botao;
}

export const reduzirMovimento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
