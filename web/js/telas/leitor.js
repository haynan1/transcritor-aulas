// @ts-check
// Leitor: a transcrição com o áudio sincronizado, busca e exportação.
// Se a aula ainda está transcrevendo, mostra o texto chegando ao vivo.

import { api, caminhoAula } from "../api.js";
import { IDIOMAS, decimal, duracao, h, icone, numero, reduzirMovimento, relogio, relogioCurto, toast, trocar } from "../ui.js";

const VELOCIDADES = [1, 1.25, 1.5, 1.75, 2, 0.75];
const PAUSA_PARAGRAFO_S = 2.0;
const ALVO_PARAGRAFO = 500;
const LIMITE_PARAGRAFO = 1000;
const LOGPROB_INSEGURO = -0.8;

/** Mesma regra do servidor (motor.agrupar), para o texto ao vivo já sair em parágrafos. */
function agrupar(segmentos) {
  const paragrafos = [];
  let bloco = [];
  const fechar = () => {
    if (!bloco.length) return;
    paragrafos.push({
      inicio: bloco[0].inicio,
      fim: bloco[bloco.length - 1].fim,
      texto: bloco.map((s) => s.texto).join(" "),
      inseguro: bloco.some((s) => s.logprob < LOGPROB_INSEGURO),
    });
    bloco = [];
  };
  for (const seg of segmentos) {
    if (!seg.texto) continue;
    if (bloco.length) {
      const tamanho = bloco.reduce((s, b) => s + b.texto.length + 1, 0);
      const fimDeFrase = /[.?!…]$/.test(bloco[bloco.length - 1].texto);
      const pausa = seg.inicio - bloco[bloco.length - 1].fim;
      if (pausa >= PAUSA_PARAGRAFO_S || tamanho >= LIMITE_PARAGRAFO || (tamanho >= ALVO_PARAGRAFO && fimDeFrase)) fechar();
    }
    bloco.push(seg);
  }
  fechar();
  return paragrafos;
}

function normalizar(texto) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

export function montar(raiz, app, nome) {
  if (!nome) {
    location.hash = "#/biblioteca";
    return {};
  }
  let paragrafos = [];
  /** @type {HTMLElement[]} */
  let elementos = [];
  let atual = -1;
  let seguir = true;
  let rolagemDoUsuario = 0;
  let modoVivo = false;
  let segmentosVivos = [];
  let relogioVivo = 0;
  let destruido = false;
  /** @type {HTMLElement[]} */
  let marcas = [];
  let marcaAtual = -1;

  const titulo = h("h1");
  const meta = h("div", { class: "leitor-meta" });
  const acoes = h("div", { class: "acoes" });
  const corpo = h("div", { class: "texto", id: "texto-aula", "aria-live": "off" });
  const audio = /** @type {HTMLAudioElement} */ (h("audio", { preload: "metadata", src: `${caminhoAula(nome)}/audio` }));

  // ---- player -----------------------------------------------------------------------
  const botaoTocar = h("button", { type: "button", class: "tocar", "aria-label": "Tocar" }, icone("tocar", 18));
  const tempoAtual = h("span", { class: "tempo" }, "0:00");
  const tempoTotal = h("span", { class: "tempo tempo-total" }, "0:00");
  const trilha = /** @type {HTMLInputElement} */ (
    h("input", { type: "range", class: "trilha", min: "0", max: "0", step: "1", value: "0", "aria-label": "Posição no áudio" })
  );
  const botaoVelocidade = h("button", { type: "button", class: "botao botao-pequeno botao-fantasma velocidade num", "aria-label": "Velocidade de reprodução" }, "1×");
  const botaoSeguir = h("button", { type: "button", class: "botao botao-pequeno botao-fantasma botao-icone", "aria-pressed": "true", "aria-label": "Acompanhar o texto durante a reprodução", title: "Acompanhar o texto" }, icone("seguir"));
  const player = h("div", { class: "player", role: "group", "aria-label": "Player da aula" }, botaoTocar, tempoAtual, trilha, tempoTotal, h("div", { class: "acoes" }, botaoVelocidade, botaoSeguir));

  const alternarTocar = () => (audio.paused ? audio.play().catch(() => toast("Não consegui tocar o áudio.", "perigo")) : audio.pause());
  botaoTocar.addEventListener("click", alternarTocar);
  audio.addEventListener("play", () => {
    trocar(botaoTocar, icone("pausar", 18));
    botaoTocar.setAttribute("aria-label", "Pausar");
  });
  audio.addEventListener("pause", () => {
    trocar(botaoTocar, icone("tocar", 18));
    botaoTocar.setAttribute("aria-label", "Tocar");
  });
  audio.addEventListener("loadedmetadata", () => {
    trilha.max = String(Math.floor(audio.duration));
    tempoTotal.textContent = relogioCurto(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    tempoAtual.textContent = relogioCurto(audio.currentTime);
    if (document.activeElement !== trilha) trilha.value = String(Math.floor(audio.currentTime));
    trilha.style.setProperty("--pct", `${(audio.currentTime / (audio.duration || 1)) * 100}%`);
    trilha.setAttribute("aria-valuetext", `${relogio(audio.currentTime)} de ${relogio(audio.duration || 0)}`);
    marcarAtual(audio.currentTime);
  });
  trilha.addEventListener("input", () => {
    audio.currentTime = Number(trilha.value);
  });
  botaoVelocidade.addEventListener("click", () => {
    const proxima = VELOCIDADES[(VELOCIDADES.indexOf(audio.playbackRate) + 1) % VELOCIDADES.length];
    audio.playbackRate = proxima;
    botaoVelocidade.textContent = `${decimal(proxima)}×`;
  });
  botaoSeguir.addEventListener("click", () => {
    seguir = !seguir;
    botaoSeguir.setAttribute("aria-pressed", String(seguir));
    if (seguir && atual >= 0) rolarPara(elementos[atual]);
  });
  const aoRolar = () => {
    rolagemDoUsuario = performance.now();
  };
  window.addEventListener("wheel", aoRolar, { passive: true });
  window.addEventListener("touchmove", aoRolar, { passive: true });

  function irPara(segundos) {
    audio.currentTime = segundos;
    if (audio.paused) audio.play().catch(() => {});
  }

  function rolarPara(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reduzirMovimento() ? "auto" : "smooth" });
  }

  function marcarAtual(t) {
    if (!paragrafos.length) return;
    // Busca binária: o maior parágrafo que começa antes do instante atual.
    let baixo = 0;
    let alto = paragrafos.length - 1;
    let achado = 0;
    while (baixo <= alto) {
      const meio = (baixo + alto) >> 1;
      if (paragrafos[meio].inicio <= t + 0.25) {
        achado = meio;
        baixo = meio + 1;
      } else alto = meio - 1;
    }
    if (achado === atual) return;
    if (atual >= 0) delete elementos[atual]?.dataset.atual;
    atual = achado;
    elementos[atual].dataset.atual = "";
    // Respeita quem está rolando para ler outro trecho: só acompanha após 4 s de calma.
    if (seguir && !audio.paused && performance.now() - rolagemDoUsuario > 4000) rolarPara(elementos[atual]);
  }

  // ---- busca ------------------------------------------------------------------------
  const campoBusca = /** @type {HTMLInputElement} */ (
    h("input", { class: "entrada", type: "search", placeholder: "Buscar no texto", "aria-label": "Buscar no texto", autocomplete: "off" })
  );
  const resultadoBusca = h("span", { class: "resultado-busca", role: "status" });
  let relogioBusca = 0;
  campoBusca.addEventListener("input", () => {
    clearTimeout(relogioBusca);
    relogioBusca = window.setTimeout(() => buscar(campoBusca.value), 160);
  });
  campoBusca.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !marcas.length) return;
    e.preventDefault();
    focarMarca(marcaAtual + (e.shiftKey ? -1 : 1));
  });

  function textoComMarcas(texto, termo) {
    if (!termo) return [texto];
    const alvo = normalizar(texto);
    const partes = [];
    let inicio = 0;
    let i = alvo.indexOf(termo);
    while (i >= 0) {
      if (i > inicio) partes.push(texto.slice(inicio, i));
      partes.push(h("mark", null, texto.slice(i, i + termo.length)));
      inicio = i + termo.length;
      i = alvo.indexOf(termo, inicio);
    }
    if (inicio < texto.length) partes.push(texto.slice(inicio));
    return partes;
  }

  function buscar(valor) {
    const termo = normalizar(valor.trim());
    paragrafos.forEach((p, i) => {
      const paragrafoTexto = /** @type {HTMLElement} */ (elementos[i].querySelector("p"));
      const conferir = paragrafoTexto.querySelector(".conferir");
      trocar(paragrafoTexto, conferir, ...textoComMarcas(p.texto, termo.length >= 2 ? termo : ""));
    });
    marcas = [...corpo.querySelectorAll("mark")].map((m) => /** @type {HTMLElement} */ (m));
    marcaAtual = -1;
    if (termo.length < 2) resultadoBusca.textContent = "";
    else if (!marcas.length) resultadoBusca.textContent = "Nada encontrado";
    else focarMarca(0);
  }

  function focarMarca(i) {
    if (!marcas.length) return;
    if (marcaAtual >= 0) delete marcas[marcaAtual].dataset.atual;
    marcaAtual = (i + marcas.length) % marcas.length;
    marcas[marcaAtual].dataset.atual = "";
    rolarPara(marcas[marcaAtual]);
    resultadoBusca.textContent = `${marcaAtual + 1} de ${marcas.length}`;
  }

  // ---- texto ------------------------------------------------------------------------
  function elementoParagrafo(p) {
    return h(
      "div",
      { class: "paragrafo" },
      h("button", { type: "button", class: "marca-tempo", "aria-label": `Tocar a partir de ${relogio(p.inicio)}`, onclick: () => irPara(p.inicio) }, relogio(p.inicio)),
      h(
        "p",
        null,
        p.inseguro ? h("span", { class: "conferir selo", dataset: { tom: "atencao" }, title: "Trecho com baixa confiança: confira no áudio" }, icone("atencao"), "conferir") : null,
        p.texto,
      ),
    );
  }

  function pintarTexto(novos) {
    paragrafos = novos;
    elementos = paragrafos.map(elementoParagrafo);
    atual = -1;
    trocar(corpo, ...elementos);
    if (campoBusca.value.trim()) buscar(campoBusca.value);
    marcarAtual(audio.currentTime);
  }

  function copiarTexto() {
    const texto = paragrafos.map((p) => `[${relogio(p.inicio)}] ${p.texto}`).join("\n\n");
    navigator.clipboard.writeText(texto).then(
      () => toast("Texto copiado."),
      () => toast("Não consegui copiar. Use o botão .md para baixar.", "perigo"),
    );
  }

  function pintarCabeca(dados, vivo) {
    titulo.textContent = dados.titulo;
    const palavras = paragrafos.reduce((s, p) => s + p.texto.split(/\s+/).filter(Boolean).length, 0);
    const aConferir = paragrafos.filter((p) => p.inseguro).length;
    trocar(
      meta,
      vivo ? h("span", { class: "selo selo-pulso", dataset: { tom: "sinal" } }, "Ao vivo") : null,
      h("span", null, icone("relogio", 14), h("span", { class: "num" }, duracao(dados.duracao))),
      h("span", null, icone("texto", 14), h("span", { class: "num" }, numero(palavras)), " palavras"),
      dados.idioma ? h("span", null, IDIOMAS[dados.idioma] || dados.idioma) : null,
      aConferir ? h("span", null, icone("atencao", 14), h("span", { class: "num" }, numero(aConferir)), aConferir === 1 ? " trecho a conferir" : " trechos a conferir") : null,
    );
    trocar(
      acoes,
      h("button", { type: "button", class: "botao botao-pequeno", onclick: copiarTexto }, icone("copiar"), "Copiar texto"),
      vivo ? null : h("a", { class: "botao botao-pequeno", href: `${caminhoAula(dados.nome)}/arquivos/md`, download: "" }, icone("baixar"), ".md"),
      vivo ? null : h("a", { class: "botao botao-pequeno", href: `${caminhoAula(dados.nome)}/arquivos/srt`, download: "" }, icone("baixar"), ".srt"),
    );
  }

  // ---- carregar ---------------------------------------------------------------------
  const conteudo = h("div", { class: "leitor" }, h("div", { class: "esqueleto esqueleto-bloco" }));
  raiz.append(
    h(
      "div",
      { class: "tela" },
      h("a", { class: "voltar", href: "#/biblioteca" }, icone("seta", 14), "Biblioteca"),
      h("header", { class: "cabeca" }, h("div", null, titulo, meta), acoes),
      conteudo,
    ),
  );
  titulo.textContent = nome.replace(/\.[^.]+$/, "");

  function montarLeitor() {
    trocar(
      conteudo,
      player,
      audio,
      h("div", { class: "leitor-barra" }, h("div", { class: "busca" }, icone("buscar"), campoBusca), resultadoBusca),
      corpo,
    );
  }

  async function acompanharAoVivo(trabalho) {
    if (destruido) return;
    try {
      const { segmentos } = await api.segmentos(trabalho.id, segmentosVivos.length);
      if (segmentos.length) {
        segmentosVivos = segmentosVivos.concat(segmentos);
        const estavaNoFim = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
        pintarTexto(agrupar(segmentosVivos));
        pintarCabeca({ titulo: trabalho.arquivo.replace(/\.[^.]+$/, ""), nome: trabalho.arquivo, duracao: trabalho.duracao, idioma: trabalho.idioma }, true);
        if (estavaNoFim && seguir) window.scrollTo({ top: document.body.scrollHeight, behavior: reduzirMovimento() ? "auto" : "smooth" });
      }
    } catch {
      /* tenta de novo no próximo ciclo */
    }
    relogioVivo = window.setTimeout(() => {
      const ainda = app.trabalhoDe(nome);
      if (ainda) acompanharAoVivo(ainda);
      else carregar(); // terminou: troca o texto ao vivo pelo definitivo
    }, 1500);
  }

  async function carregar() {
    if (destruido) return;
    try {
      const dados = await api.transcricao(nome);
      modoVivo = false;
      montarLeitor();
      pintarTexto(dados.paragrafos);
      pintarCabeca(dados, false);
      return;
    } catch (erro) {
      if (erro.status !== 404) {
        trocar(conteudo, h("div", { class: "aviso", dataset: { tom: "perigo" }, role: "alert" }, icone("erro"), erro.message));
        return;
      }
    }
    const trabalho = app.trabalhoDe(nome);
    if (trabalho) {
      modoVivo = true;
      montarLeitor();
      trocar(corpo, h("p", { class: "rodape-tela" }, trabalho.estado === "carregando" ? "Carregando o modelo…" : "O texto aparece aqui conforme a aula é transcrita."));
      acompanharAoVivo(trabalho);
      return;
    }
    const aula = (app.aulas || []).find((a) => a.nome === nome);
    trocar(
      conteudo,
      h(
        "div",
        { class: "cartao vazio" },
        h("div", { class: "vazio-icone" }, icone("texto", 20)),
        h("h3", null, aula ? "Esta aula ainda não foi transcrita" : "Aula não encontrada"),
        h("p", null, aula ? "Coloque na fila e acompanhe o texto chegando aqui mesmo." : "Ela pode ter sido renomeada ou removida da pasta Gravações."),
        aula
          ? h(
              "button",
              {
                type: "button",
                class: "botao botao-sinal",
                onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  try {
                    await api.transcrever(nome);
                    setTimeout(carregar, 1200);
                  } catch (falha) {
                    toast(falha.message, "perigo");
                    e.currentTarget.disabled = false;
                  }
                },
              },
              icone("onda"),
              "Transcrever agora",
            )
          : h("a", { class: "botao", href: "#/biblioteca" }, "Voltar para a Biblioteca"),
      ),
    );
  }

  // ---- teclado ----------------------------------------------------------------------
  function teclado(e) {
    const alvo = /** @type {HTMLElement} */ (e.target);
    if (alvo.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " && !alvo.closest("button, a")) {
      e.preventDefault();
      alternarTocar();
    } else if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
    else if (e.key === "ArrowRight") audio.currentTime += 5;
    else if (e.key === "/") {
      e.preventDefault();
      campoBusca.focus();
    }
  }
  document.addEventListener("keydown", teclado);

  carregar();

  return {
    atualizar() {
      // Começou a transcrever esta aula enquanto o leitor estava aberto vazio: passa ao vivo.
      if (!modoVivo && !paragrafos.length && app.trabalhoDe(nome) && !relogioVivo) carregar();
    },
    destruir() {
      destruido = true;
      clearTimeout(relogioVivo);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      document.removeEventListener("keydown", teclado);
      window.removeEventListener("wheel", aoRolar);
      window.removeEventListener("touchmove", aoRolar);
    },
  };
}
