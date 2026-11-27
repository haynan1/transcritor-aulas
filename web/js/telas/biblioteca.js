// @ts-check
// Biblioteca: todas as aulas da pasta Gravações, com formato, estado e ações.

import { api, caminhoAula } from "../api.js";
import { botaoConfirmar, bytes, duracao, h, haQuanto, icone, numero, seloEstado, seloFormato, toast, trocar } from "../ui.js";

const FILTROS = [
  { id: "todas", rotulo: "Todas", passa: () => true },
  { id: "transcritas", rotulo: "Transcritas", passa: (a) => a.estado === "transcrita" },
  { id: "pendentes", rotulo: "Não transcritas", passa: (a) => a.estado === "pendente" },
  { id: "fila", rotulo: "Na fila", passa: (a) => ["na_fila", "carregando", "transcrevendo"].includes(a.estado) },
];

export function montar(raiz, app) {
  let filtro = "todas";
  let busca = "";
  let assinatura = "";

  const resumo = h("p");
  const lista = h("ul", { class: "lista-aulas", "aria-live": "polite", "aria-busy": "true" });
  const campoBusca = /** @type {HTMLInputElement} */ (
    h("input", { class: "entrada", type: "search", placeholder: "Buscar aula", "aria-label": "Buscar aula", autocomplete: "off" })
  );
  campoBusca.addEventListener("input", () => {
    busca = campoBusca.value.trim().toLocaleLowerCase("pt-BR");
    pintar(true);
  });
  const segmentado = h("div", { class: "segmentado", role: "group", "aria-label": "Filtrar aulas" });
  for (const f of FILTROS) {
    segmentado.append(
      h("button", {
        type: "button",
        "aria-pressed": String(f.id === filtro),
        dataset: { filtro: f.id },
        onclick: () => {
          filtro = f.id;
          for (const b of segmentado.children) b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.filtro === filtro));
          pintar(true);
        },
      }, f.rotulo),
    );
  }

  raiz.append(
    h(
      "div",
      { class: "tela" },
      h(
        "header",
        { class: "cabeca" },
        h("div", null, h("span", { class: "sobretitulo" }, "Biblioteca"), h("h1", null, "Aulas"), resumo),
        h("div", { class: "acoes" }, h("a", { class: "botao botao-primario", href: "#/importar" }, icone("importar"), "Importar aula")),
      ),
      h("div", { class: "filtros" }, h("div", { class: "busca" }, icone("buscar"), campoBusca), segmentado),
      h("section", { class: "cartao", "aria-label": "Lista de aulas" }, lista),
    ),
  );

  async function transcrever(aula, botao) {
    botao.disabled = true;
    try {
      await api.transcrever(aula.nome);
      toast(`${aula.nome} entrou na fila.`);
    } catch (erro) {
      toast(erro.message, "perigo");
      botao.disabled = false;
    }
  }

  function acoes(aula) {
    const caixa = h("div", { class: "aula-acoes" });
    const trabalho = app.trabalhoDe(aula.nome);
    if (trabalho) {
      caixa.append(
        h("span", { class: "rodape-tela num" }, trabalho.estado === "transcrevendo" ? `${Math.floor(trabalho.progresso * 100)}%` : ""),
        h("a", { class: "botao botao-pequeno", href: "#/" }, icone("painel"), "Acompanhar"),
      );
      return caixa;
    }
    if (aula.estado === "transcrita") {
      caixa.append(
        h("a", { class: "botao botao-pequeno botao-primario", href: `#/aula/${encodeURIComponent(aula.nome)}` }, icone("texto"), "Ler"),
        h("a", { class: "botao botao-pequeno", href: `${caminhoAula(aula.nome)}/arquivos/md`, download: "", title: "Baixar o texto em Markdown" }, icone("baixar"), ".md"),
        h("a", { class: "botao botao-pequeno", href: `${caminhoAula(aula.nome)}/arquivos/srt`, download: "", title: "Baixar as legendas" }, icone("baixar"), ".srt"),
        botaoConfirmar({
          rotulo: "Refazer",
          confirmar: "Refazer?",
          iconeNome: "refazer",
          classe: "botao botao-pequeno botao-fantasma",
          acao: async () => {
            try {
              await api.transcrever(aula.nome);
              toast(`${aula.nome} vai ser transcrita de novo.`);
            } catch (erro) {
              toast(erro.message, "perigo");
            }
          },
        }),
      );
    } else if (aula.formato) {
      const botao = h("button", { type: "button", class: "botao botao-pequeno botao-sinal" }, icone("onda"), "Transcrever");
      botao.addEventListener("click", () => transcrever(aula, botao));
      caixa.append(botao);
    }
    return caixa;
  }

  function linha(aula) {
    const titulo =
      aula.estado === "transcrita"
        ? h("a", { class: "aula-titulo", href: `#/aula/${encodeURIComponent(aula.nome)}` }, aula.titulo)
        : h("span", { class: "aula-titulo" }, aula.titulo);
    const t = aula.transcricao;
    return h(
      "li",
      { class: "aula" },
      h(
        "div",
        null,
        titulo,
        h(
          "div",
          { class: "aula-meta" },
          seloEstado(aula.estado),
          seloFormato(aula.formato),
          aula.duracao ? h("span", null, h("span", { class: "num" }, duracao(aula.duracao))) : null,
          h("span", null, h("span", { class: "num" }, bytes(aula.tamanho))),
          t ? h("span", null, h("span", { class: "num" }, numero(t.palavras)), " palavras") : null,
          t && t.inseguros ? h("span", { title: "Trechos com baixa confiança" }, h("span", { class: "num" }, numero(t.inseguros)), " a conferir") : null,
          t ? h("span", null, `transcrita ${haQuanto(t.gerada_em)}`) : h("span", null, `gravada ${haQuanto(aula.modificado)}`),
        ),
      ),
      acoes(aula),
    );
  }

  function pintar(forcar = false) {
    const aulas = app.aulas;
    if (!aulas) {
      trocar(lista, ...[1, 2, 3].map(() => h("li", { class: "aula" }, h("div", { class: "esqueleto esqueleto-linha" }))));
      return;
    }
    lista.setAttribute("aria-busy", "false");
    const total = aulas.reduce((s, a) => s + (a.duracao || 0), 0);
    const transcritas = aulas.filter((a) => a.estado === "transcrita").length;
    resumo.textContent = aulas.length
      ? `${aulas.length} ${aulas.length === 1 ? "aula" : "aulas"} · ${duracao(total)} de áudio · ${transcritas} ${transcritas === 1 ? "transcrita" : "transcritas"}`
      : "Nenhuma aula na pasta Gravações ainda.";

    const passa = FILTROS.find((f) => f.id === filtro)?.passa || (() => true);
    const visiveis = aulas.filter((a) => passa(a) && (!busca || a.nome.toLocaleLowerCase("pt-BR").includes(busca)));
    // Durante uma transcrição o estado chega a cada segundo: só repinta o que mudou de fato.
    const nova =
      filtro + busca + visiveis.map((a) => {
        const t = app.trabalhoDe(a.nome);
        return `${a.nome}:${a.estado}:${a.modificado}:${t ? `${t.estado}${Math.floor(t.progresso * 100)}` : ""}`;
      }).join("|");
    if (!forcar && nova === assinatura) return;
    assinatura = nova;

    if (aulas.length === 0) {
      trocar(
        lista,
        h(
          "li",
          { class: "vazio" },
          h("div", { class: "vazio-icone" }, icone("biblioteca", 20)),
          h("h3", null, "A biblioteca está vazia"),
          h("p", null, "Importe a primeira gravação. Ela vai para a pasta Gravações e aparece aqui."),
          h("a", { class: "botao botao-primario", href: "#/importar" }, icone("importar"), "Importar aula"),
        ),
      );
      return;
    }
    if (visiveis.length === 0) {
      trocar(lista, h("li", { class: "vazio" }, h("h3", null, "Nenhuma aula encontrada"), h("p", null, "Mude o filtro ou a busca.")));
      return;
    }
    trocar(lista, ...visiveis.map(linha));
  }

  return { atualizar: () => pintar() };
}
