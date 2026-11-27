// @ts-check
// Painel: o que está transcrevendo agora, a fila e o uso da máquina, em tempo real.

import { api } from "../api.js";
import { GraficoCpu } from "../grafico.js";
import {
  IDIOMAS,
  botaoConfirmar,
  bytes,
  decimal,
  duracao,
  h,
  haQuanto,
  horaDeTermino,
  icone,
  relogio,
  seloEstado,
  toast,
  trocar,
} from "../ui.js";

const FINAIS = ["concluido", "erro", "cancelado"];

export function montar(raiz, app) {
  const titulo = h("h1");
  const subtitulo = h("p");

  // ---- agora ------------------------------------------------------------------------
  const agoraCorpo = h("div");
  const cartaoAgora = h(
    "section",
    { class: "cartao", "aria-labelledby": "titulo-agora" },
    h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-agora" }, icone("onda"), "Agora")),
    agoraCorpo,
  );
  /** @type {{id: string, el: Record<string, HTMLElement>} | null} */
  let agoraMontado = null;

  function montarAgora(trabalho) {
    const el = {
      arquivo: h("div", { class: "agora-arquivo" }),
      sub: h("div", { class: "agora-sub" }),
      pct: h("div", { class: "porcentagem num", "aria-hidden": "true" }),
      barra: h("div", { class: "barra-preenchida" }),
      trecho: h("p", { class: "trecho-vivo", "aria-hidden": "true" }),
      restante: h("div", { class: "metrica-valor num" }),
      decorrido: h("div", { class: "metrica-valor num" }),
      velocidade: h("div", { class: "metrica-valor num" }),
      posicao: h("div", { class: "metrica-valor num" }),
      anuncio: h("p", { class: "visualmente-oculto", role: "status" }),
    };
    const barra = h("div", { class: "barra", role: "progressbar", "aria-label": "Progresso da transcrição", "aria-valuemin": "0", "aria-valuemax": "100" }, el.barra);
    el.barraTrilho = barra;
    const metrica = (rotulo, valor) => h("div", { class: "metrica" }, h("span", { class: "rotulo" }, rotulo), valor);
    trocar(
      agoraCorpo,
      h(
        "div",
        { class: "agora" },
        h(
          "div",
          { class: "agora-topo" },
          h("div", null, el.arquivo, el.sub),
          h(
            "div",
            { class: "acoes" },
            h("a", { class: "botao botao-pequeno", href: `#/aula/${encodeURIComponent(trabalho.arquivo)}` }, icone("texto"), "Ver ao vivo"),
            botaoConfirmar({
              rotulo: "Cancelar",
              confirmar: "Confirmar",
              iconeNome: "fechar",
              acao: async () => {
                try {
                  await api.cancelar(trabalho.id);
                } catch (erro) {
                  toast(erro.message, "perigo");
                }
              },
            }),
          ),
        ),
        el.pct,
        barra,
        el.trecho,
        el.anuncio,
      ),
      h(
        "div",
        { class: "metricas" },
        metrica("Restante", el.restante),
        metrica("Decorrido", el.decorrido),
        metrica("Velocidade", el.velocidade),
        metrica("Posição no áudio", el.posicao),
      ),
    );
    agoraMontado = { id: trabalho.id, el };
  }

  function pintarAgora(trabalho) {
    assinaturaVazio = "";
    if (!agoraMontado || agoraMontado.id !== trabalho.id) montarAgora(trabalho);
    const { el } = /** @type {NonNullable<typeof agoraMontado>} */ (agoraMontado);
    const pct = Math.floor(trabalho.progresso * 100);
    const carregando = trabalho.estado === "carregando";
    el.arquivo.textContent = trabalho.arquivo;
    trocar(
      el.sub,
      seloEstado(trabalho.estado),
      h("span", null, IDIOMAS[trabalho.idioma || "auto"] || trabalho.idioma),
      trabalho.termos ? h("span", { title: "Termos do curso" }, `Termos: ${trabalho.termos}`) : null,
    );
    trocar(el.pct, carregando ? "—" : String(pct), h("small", null, "%"));
    if (carregando) el.barra.dataset.indeterminado = "";
    else delete el.barra.dataset.indeterminado;
    el.barra.style.setProperty("transform", `scaleX(${trabalho.progresso})`);
    el.barraTrilho.setAttribute("aria-valuenow", String(pct));
    el.trecho.textContent = carregando ? "Carregando o modelo na memória…" : trabalho.ultimo_trecho || "Ouvindo o começo da aula…";

    const restante = trabalho.restante;
    trocar(
      el.restante,
      restante === null ? "—" : duracao(restante),
      restante !== null && trabalho.restante_estimado ? h("small", null, "estim.") : null,
    );
    el.restante.title = restante === null ? "Calculando a partir da velocidade real" : `Termina por volta das ${horaDeTermino(restante)}`;
    el.decorrido.textContent = carregando ? "—" : relogio(trabalho.decorrido);
    trocar(el.velocidade, trabalho.velocidade ? decimal(trabalho.velocidade) : "—", trabalho.velocidade ? h("small", null, "× real") : null);
    el.posicao.textContent = trabalho.duracao ? `${relogio(trabalho.posicao)}` : "—";
    el.posicao.title = trabalho.duracao ? `de ${relogio(trabalho.duracao)}` : "";
    // Anuncia só a cada 10%: leitores de tela não precisam de cada segundo.
    const faixa = `${Math.floor(pct / 10) * 10}% transcrito`;
    if (el.anuncio.textContent !== faixa) el.anuncio.textContent = faixa;
  }

  let assinaturaVazio = "";

  function pintarAgoraVazio() {
    agoraMontado = null;
    const pendentes = (app.aulas || []).filter((a) => a.estado === "pendente");
    // Sem trabalho ativo, o estado chega a cada segundo igual: só repinta se mudar.
    const assinatura = `vazio:${pendentes.map((a) => a.nome).join("|")}`;
    if (assinatura === assinaturaVazio) return;
    assinaturaVazio = assinatura;
    trocar(
      agoraCorpo,
      h(
        "div",
        { class: "vazio" },
        h("div", { class: "vazio-icone" }, icone("onda", 20)),
        h("h3", null, pendentes.length ? `${pendentes.length} ${pendentes.length === 1 ? "aula espera" : "aulas esperam"} transcrição` : "Nada transcrevendo agora"),
        h(
          "p",
          null,
          pendentes.length
            ? "Elas estão na pasta Gravações, mas ainda não têm texto."
            : "Importe a gravação de uma aula e a transcrição começa sozinha.",
        ),
        h(
          "div",
          { class: "acoes" },
          pendentes.length
            ? h(
                "button",
                {
                  type: "button",
                  class: "botao botao-sinal",
                  onclick: async (e) => {
                    e.currentTarget.disabled = true;
                    for (const aula of pendentes) {
                      try {
                        await api.transcrever(aula.nome);
                      } catch (erro) {
                        toast(`${aula.nome}: ${erro.message}`, "perigo");
                      }
                    }
                  },
                },
                icone("onda"),
                pendentes.length === 1 ? "Transcrever" : "Transcrever todas",
              )
            : null,
          h("a", { class: pendentes.length ? "botao" : "botao botao-primario", href: "#/importar" }, icone("importar"), "Importar aula"),
        ),
      ),
    );
  }

  // ---- fila -------------------------------------------------------------------------
  const listaFila = h("ul", { class: "fila" });
  const resumoFila = h("div", { class: "resumo-fila" });
  const acaoLimpar = h("button", {
    type: "button",
    class: "botao botao-pequeno botao-fantasma",
    onclick: async () => {
      try {
        await api.limparHistorico();
      } catch (erro) {
        toast(erro.message, "perigo");
      }
    },
  }, icone("limpar"), "Limpar concluídas");
  const cartaoFila = h(
    "section",
    { class: "cartao", "aria-labelledby": "titulo-fila" },
    h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-fila" }, icone("fila"), "Fila"), acaoLimpar),
    listaFila,
    resumoFila,
  );
  /** @type {string | null} */
  let assinaturaFila = null;

  function itemFila(t) {
    const info = [];
    if (t.duracao) info.push(h("span", { class: "num" }, relogio(t.duracao)));
    if (t.estado === "na_fila") info.push(h("span", null, t.restante ? `~${duracao(t.restante)}` : "aguardando"));
    if (FINAIS.includes(t.estado) && t.terminado) info.push(h("span", null, haQuanto(t.terminado)));
    const acoes = h("div", { class: "acoes" });
    if (t.estado === "concluido") {
      acoes.append(h("a", { class: "botao botao-pequeno", href: `#/aula/${encodeURIComponent(t.arquivo)}` }, icone("texto"), "Ler"));
    } else if (t.estado === "erro" || t.estado === "cancelado") {
      acoes.append(
        h("button", {
          type: "button",
          class: "botao botao-pequeno",
          onclick: async () => {
            try {
              await api.transcrever(t.arquivo, t.idioma || "auto", t.termos);
            } catch (erro) {
              toast(erro.message, "perigo");
            }
          },
        }, icone("refazer"), "Tentar de novo"),
      );
    } else if (t.estado === "na_fila") {
      acoes.append(
        h("button", {
          type: "button",
          class: "botao botao-pequeno botao-fantasma botao-icone",
          "aria-label": `Tirar ${t.arquivo} da fila`,
          title: "Tirar da fila",
          onclick: async () => {
            try {
              await api.cancelar(t.id);
            } catch (erro) {
              toast(erro.message, "perigo");
            }
          },
        }, icone("fechar")),
      );
    }
    return h(
      "li",
      { class: "fila-item" },
      h("div", null, h("div", { class: "fila-nome" }, t.arquivo), h("div", { class: "fila-info" }, seloEstado(t.estado), ...info)),
      acoes,
      t.erro ? h("p", { class: "fila-erro" }, t.erro) : null,
    );
  }

  function pintarFila(fila) {
    const ordem = { carregando: 0, transcrevendo: 0, na_fila: 1 };
    const itens = [...fila.trabalhos].sort((a, b) => {
      const pa = ordem[a.estado] ?? 2;
      const pb = ordem[b.estado] ?? 2;
      if (pa !== pb) return pa - pb;
      return pa === 2 ? (b.terminado || 0) - (a.terminado || 0) : a.criado - b.criado;
    });
    // Repinta a lista só quando muda algo além do progresso do trabalho ativo.
    const assinatura = itens.map((t) => `${t.id}:${t.estado}:${t.estado === "na_fila" ? Math.round((t.restante || 0) / 60) : ""}`).join("|");
    acaoLimpar.hidden = !itens.some((t) => FINAIS.includes(t.estado));
    if (assinatura !== assinaturaFila) {
      assinaturaFila = assinatura;
      if (itens.length === 0) {
        trocar(listaFila, h("li", { class: "fila-item" }, h("p", { class: "fila-info" }, "A fila está vazia.")));
      } else {
        trocar(listaFila, ...itens.map(itemFila));
      }
    }
    const pendentes = itens.filter((t) => !FINAIS.includes(t.estado)).length;
    resumoFila.hidden = pendentes === 0;
    trocar(
      resumoFila,
      h("span", null, `${pendentes} ${pendentes === 1 ? "aula" : "aulas"} na fila`),
      fila.restante_total
        ? h("span", null, "Tudo pronto por volta das ", h("strong", { class: "num" }, horaDeTermino(fila.restante_total)))
        : null,
    );
  }

  // ---- máquina ----------------------------------------------------------------------
  const cpuValor = h("div", { class: "cpu-valor num" });
  const cpuTrabalhador = h("p", { class: "rodape-tela" });
  const canvas = /** @type {HTMLCanvasElement} */ (h("canvas", { role: "img" }));
  const grafico = new GraficoCpu(canvas);
  const nucleos = h("div", { class: "nucleos", role: "img" });
  const memoriaBarra = h("div", { class: "barra-preenchida" });
  const memoriaTexto = h("span", { class: "num" });
  const memoriaTrabalhador = h("span", { class: "num" });
  const threadsTexto = h("p", { class: "rodape-tela" });
  const cartaoCpu = h(
    "section",
    { class: "cartao", "aria-labelledby": "titulo-cpu" },
    h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-cpu" }, icone("cpu"), "Processador")),
    h(
      "div",
      { class: "cartao-corpo" },
      h(
        "div",
        { class: "cpu-topo" },
        h("div", null, h("span", { class: "rotulo" }, "Uso total"), cpuValor),
        h(
          "div",
          { class: "legenda" },
          h("span", null, h("i", { "aria-hidden": "true" }), "Máquina"),
          h("span", null, h("i", { "aria-hidden": "true", dataset: { serie: "trabalhador" } }), "Transcrição"),
        ),
      ),
      h("div", { class: "grafico" }, canvas),
      h("div", { class: "eixo", "aria-hidden": "true" }, h("span", null, "2 min"), h("span", null, "1 min"), h("span", null, "agora")),
      cpuTrabalhador,
      nucleos,
      threadsTexto,
    ),
  );
  const cartaoMemoria = h(
    "section",
    { class: "cartao", "aria-labelledby": "titulo-memoria" },
    h("div", { class: "cartao-cabeca" }, h("h2", { id: "titulo-memoria" }, icone("memoria"), "Memória")),
    h(
      "div",
      { class: "cartao-corpo memoria" },
      h("div", { class: "memoria-linha" }, h("span", null, "Em uso"), memoriaTexto),
      h("div", { class: "barra barra-fina" }, memoriaBarra),
      h("div", { class: "memoria-linha" }, h("span", null, "Transcrição"), memoriaTrabalhador),
    ),
  );
  let celulas = [];

  function pintarSistema(sistema) {
    trocar(cpuValor, String(Math.round(sistema.cpu)), h("small", null, "%"));
    cpuTrabalhador.textContent =
      sistema.cpu_trabalhador > 0
        ? `A transcrição usa ${Math.round(sistema.cpu_trabalhador)}% da máquina.`
        : "Nenhuma transcrição usando o processador agora.";
    grafico.atualizar(sistema.historico);
    canvas.setAttribute(
      "aria-label",
      `Uso do processador nos últimos 2 minutos. Agora: ${Math.round(sistema.cpu)}% no total, ${Math.round(sistema.cpu_trabalhador)}% pela transcrição.`,
    );
    if (celulas.length !== sistema.por_nucleo.length) {
      celulas = sistema.por_nucleo.map(() => h("div", { class: "nucleo" }, h("span")));
      trocar(nucleos, ...celulas);
    }
    sistema.por_nucleo.forEach((uso, i) => {
      celulas[i].title = `Núcleo ${i + 1}: ${Math.round(uso)}%`;
      /** @type {HTMLElement} */ (celulas[i].firstChild).style.setProperty("--uso", String(Math.max(0.06, uso / 100)));
    });
    const media = sistema.por_nucleo.reduce((s, v) => s + v, 0) / (sistema.por_nucleo.length || 1);
    nucleos.setAttribute("aria-label", `${sistema.nucleos} núcleos lógicos, média de ${Math.round(media)}%.`);
    if (app.config) {
      threadsTexto.textContent = `A transcrição usa ${app.config.threads} threads (${sistema.nucleos_fisicos} núcleos físicos, ${sistema.nucleos} lógicos) com prioridade abaixo do normal, para não atrapalhar uma gravação.`;
    }
    memoriaTexto.textContent = `${bytes(sistema.memoria_usada)} de ${bytes(sistema.memoria_total)}`;
    memoriaBarra.style.setProperty("transform", `scaleX(${sistema.memoria_usada / sistema.memoria_total})`);
    memoriaTrabalhador.textContent = sistema.memoria_trabalhador ? bytes(sistema.memoria_trabalhador) : "—";
  }

  // ---- montagem ---------------------------------------------------------------------
  raiz.append(
    h(
      "div",
      { class: "tela" },
      h("header", { class: "cabeca" }, h("div", null, h("span", { class: "sobretitulo" }, "Painel"), titulo, subtitulo)),
      h(
        "div",
        { class: "grade-painel" },
        h("div", { class: "coluna" }, cartaoAgora, cartaoFila),
        h("div", { class: "coluna" }, cartaoCpu, cartaoMemoria),
      ),
    ),
  );

  function atualizar() {
    const estado = app.estado;
    if (!estado) {
      titulo.textContent = "Conectando ao painel…";
      subtitulo.textContent = "";
      trocar(agoraCorpo, h("div", { class: "agora" }, h("div", { class: "esqueleto esqueleto-bloco" })));
      return;
    }
    const { fila, sistema } = estado;
    const ativo = fila.trabalhos.find((t) => t.id === fila.ativo);
    if (ativo) {
      titulo.textContent = ativo.estado === "carregando" ? "Preparando a transcrição" : "Transcrevendo agora";
      subtitulo.textContent =
        ativo.restante !== null
          ? `${ativo.arquivo} termina por volta das ${horaDeTermino(ativo.restante)}.`
          : `${ativo.arquivo}: medindo a velocidade para estimar o fim.`;
      pintarAgora(ativo);
    } else {
      titulo.textContent = "Tudo em dia";
      subtitulo.textContent = "Nenhuma transcrição em andamento.";
      pintarAgoraVazio();
    }
    pintarFila(fila);
    pintarSistema(sistema);
  }

  return {
    atualizar,
    destruir: () => grafico.destruir(),
  };
}
