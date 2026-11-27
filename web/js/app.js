// @ts-check
// Ponto de entrada: estado vivo (SSE), rotas e casca da interface.

import { api } from "./api.js";
import { icone, toast } from "./ui.js";
import * as painel from "./telas/painel.js";
import * as biblioteca from "./telas/biblioteca.js";
import * as importar from "./telas/importar.js";
import * as leitor from "./telas/leitor.js";
import * as manual from "./telas/manual.js";

/**
 * Estado compartilhado entre as telas. As telas leem daqui e assinam mudanças.
 * @typedef {{montar: (raiz: HTMLElement, app: App, parametro?: string) => Tela}} ModuloTela
 * @typedef {{atualizar?: () => void, destruir?: () => void}} Tela
 */
class App {
  constructor() {
    /** @type {any} */ this.estado = null; // último pacote do servidor: {fila, sistema}
    /** @type {any[] | null} */ this.aulas = null;
    /** @type {any} */ this.config = null;
    /** @type {Set<() => void>} */ this.assinantes = new Set();
    /** @type {Map<string, string>} */ this.estadosAnteriores = new Map();
    this.conexao = "conectando";
  }

  /** @param {() => void} fn */
  assinar(fn) {
    this.assinantes.add(fn);
    return () => this.assinantes.delete(fn);
  }

  publicar() {
    for (const fn of this.assinantes) fn();
  }

  async recarregarAulas() {
    try {
      this.aulas = await api.aulas();
      this.publicar();
    } catch {
      /* a próxima mudança da fila tenta de novo */
    }
  }

  /** Trabalho da fila (não finalizado) para uma aula, se houver. */
  trabalhoDe(arquivo) {
    const trabalhos = this.estado?.fila?.trabalhos || [];
    return trabalhos.find((t) => t.arquivo === arquivo && !["concluido", "erro", "cancelado"].includes(t.estado));
  }

  receber(estado) {
    const anteriores = this.estadosAnteriores;
    let mudouAlgumaAula = false;
    for (const t of estado.fila.trabalhos) {
      const antes = anteriores.get(t.id);
      if (antes && antes !== t.estado) {
        if (t.estado === "concluido") toast(`${t.arquivo} foi transcrita.`);
        if (t.estado === "erro") toast(`Erro em ${t.arquivo}: ${t.erro}`, "perigo");
        mudouAlgumaAula = true;
      }
      if (!antes) mudouAlgumaAula = true;
    }
    this.estadosAnteriores = new Map(estado.fila.trabalhos.map((t) => [t.id, t.estado]));
    this.estado = estado;
    if (mudouAlgumaAula) this.recarregarAulas();
    this.atualizarCasca();
    this.publicar();
  }

  atualizarCasca() {
    const fila = this.estado?.fila;
    const ativos = (fila?.trabalhos || []).filter((t) => !["concluido", "erro", "cancelado"].includes(t.estado));
    const contador = /** @type {HTMLElement} */ (document.getElementById("contador-fila"));
    contador.hidden = ativos.length === 0;
    contador.textContent = String(ativos.length);
    contador.setAttribute("aria-label", `${ativos.length} na fila`);

    const atual = fila?.trabalhos.find((t) => t.id === fila.ativo);
    document.title =
      atual && atual.estado === "transcrevendo"
        ? `${Math.floor(atual.progresso * 100)}% · ${atual.arquivo} — Transcriptor Class`
        : "Transcriptor Class";
  }

  definirConexao(estado) {
    this.conexao = estado;
    const el = /** @type {HTMLElement} */ (document.getElementById("conexao"));
    el.dataset.estado = estado;
    el.textContent = { vivo: "Ao vivo", caiu: "Reconectando…", conectando: "Conectando…" }[estado] || estado;
  }

  conectar() {
    const fonte = new EventSource("/api/eventos");
    fonte.addEventListener("estado", (e) => {
      this.definirConexao("vivo");
      this.receber(JSON.parse(/** @type {MessageEvent} */ (e).data));
    });
    fonte.addEventListener("error", () => this.definirConexao("caiu"));
  }
}

/** @type {Record<string, ModuloTela>} */
const ROTAS = { painel, biblioteca, importar, manual, aula: leitor };

const app = new App();
/** @type {Tela | null} */
let telaAtual = null;
let cancelarAssinatura = () => false;

function rotaAtual() {
  const caminho = location.hash.replace(/^#\/?/, "");
  const [nome, ...resto] = caminho.split("/");
  if (nome === "aula" && resto.length) return { nome: "aula", parametro: decodeURIComponent(resto.join("/")) };
  // Demais telas aceitam uma âncora: #/manual/exportar abre o manual nessa seção.
  return { nome: ROTAS[nome] ? nome : "painel", parametro: resto[0] || undefined };
}

function navegar() {
  const { nome, parametro } = rotaAtual();
  telaAtual?.destruir?.();
  cancelarAssinatura();
  const raiz = /** @type {HTMLElement} */ (document.getElementById("conteudo"));
  raiz.replaceChildren();
  const marcada = nome === "aula" ? "biblioteca" : nome;
  for (const link of document.querySelectorAll(".nav a")) {
    if (/** @type {HTMLElement} */ (link).dataset.rota === marcada) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  telaAtual = ROTAS[nome].montar(raiz, app, parametro);
  cancelarAssinatura = app.assinar(() => telaAtual?.atualizar?.());
  telaAtual.atualizar?.();
  window.scrollTo(0, 0);
  if (document.activeElement && document.activeElement !== document.body) raiz.focus({ preventScroll: true });
}

function montarCasca() {
  for (const lugar of document.querySelectorAll("[data-icone]")) {
    const el = /** @type {HTMLElement} */ (lugar);
    const tamanho = el.parentElement?.classList.contains("marca-simbolo") ? 18 : 17;
    el.replaceWith(icone(/** @type {any} */ (el.dataset.icone), tamanho));
  }

  const botoesTema = document.querySelectorAll(".tema button");
  const pintarTema = () => {
    const preferencia = window.temaTC.preferencia();
    for (const b of botoesTema) {
      b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.tema === preferencia));
    }
  };
  for (const b of botoesTema) {
    b.addEventListener("click", () => {
      /** @type {("escuro" | "claro" | "sistema")[]} */
      const ordem = ["escuro", "claro", "sistema"];
      const escolhido = ordem.find((t) => t === /** @type {HTMLElement} */ (b).dataset.tema) || "sistema";
      // No celular só o botão ativo aparece: tocar nele avança para o próximo tema.
      const estreito = window.matchMedia("(max-width: 900px)").matches;
      const proximo = estreito ? ordem[(ordem.indexOf(window.temaTC.preferencia()) + 1) % 3] : escolhido;
      window.temaTC.definir(proximo);
      pintarTema();
    });
  }
  pintarTema();
}

async function iniciar() {
  montarCasca();
  window.addEventListener("hashchange", navegar);
  navegar();
  app.conectar();
  const [config] = await Promise.all([api.config().catch(() => null), app.recarregarAulas()]);
  app.config = config;
  app.publicar();
}

iniciar();
