// @ts-check
// Acesso à API. Toda escrita leva o cabeçalho x-transcriptor: o servidor recusa escrita sem ele.

const ESCRITA = { "x-transcriptor": "1" };

export class ErroApi extends Error {
  /** @param {string} mensagem @param {number} status */
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

async function ler(resposta) {
  if (resposta.ok) return resposta.status === 204 ? null : resposta.json();
  let mensagem = `Erro ${resposta.status}`;
  try {
    const corpo = await resposta.json();
    if (typeof corpo.detail === "string") mensagem = corpo.detail;
    else if (Array.isArray(corpo.detail)) mensagem = corpo.detail.map((d) => d.msg).join("; ");
  } catch {
    /* corpo sem JSON: fica a mensagem padrão */
  }
  throw new ErroApi(mensagem, resposta.status);
}

export const caminhoAula = (nome) => `/api/aulas/${encodeURIComponent(nome)}`;

export const api = {
  config: () => fetch("/api/config").then(ler),
  estado: () => fetch("/api/estado").then(ler),
  aulas: () => fetch("/api/aulas").then(ler),
  transcricao: (nome) => fetch(`${caminhoAula(nome)}/transcricao`).then(ler),
  segmentos: (id, desde) => fetch(`/api/trabalhos/${encodeURIComponent(id)}/segmentos?desde=${desde}`).then(ler),

  transcrever: (arquivo, idioma = "pt", termos = null) =>
    fetch("/api/trabalhos", {
      method: "POST",
      headers: { ...ESCRITA, "content-type": "application/json" },
      body: JSON.stringify({ arquivo, idioma, termos }),
    }).then(ler),

  cancelar: (id) => fetch(`/api/trabalhos/${encodeURIComponent(id)}`, { method: "DELETE", headers: ESCRITA }).then(ler),
  limparHistorico: () => fetch("/api/historico", { method: "DELETE", headers: ESCRITA }).then(ler),

  /**
   * Envia o arquivo como corpo bruto (sem multipart): o servidor grava direto no disco.
   * XHR, e não fetch, porque só ele informa o progresso do envio.
   * @param {File} arquivo @param {string} nome
   * @param {{transcrever: boolean, idioma: string, termos: string}} opcoes
   * @param {(enviado: number, total: number) => void} progresso
   * @returns {{promessa: Promise<any>, cancelar: () => void}}
   */
  importar(arquivo, nome, opcoes, progresso) {
    const xhr = new XMLHttpRequest();
    const params = new URLSearchParams({ transcrever: String(opcoes.transcrever), idioma: opcoes.idioma });
    if (opcoes.termos) params.set("termos", opcoes.termos);
    const promessa = new Promise((resolver, rejeitar) => {
      xhr.open("PUT", `${caminhoAula(nome)}?${params}`);
      xhr.setRequestHeader("x-transcriptor", "1");
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.addEventListener("progress", (e) => progresso(e.loaded, e.total || arquivo.size));
      xhr.addEventListener("load", () => {
        const resposta = new Response(xhr.responseText || "null", { status: xhr.status });
        ler(resposta).then(resolver, rejeitar);
      });
      xhr.addEventListener("error", () => rejeitar(new ErroApi("Sem conexão com o painel.", 0)));
      xhr.addEventListener("abort", () => rejeitar(new ErroApi("Envio cancelado.", 0)));
      xhr.send(arquivo);
    });
    return { promessa, cancelar: () => xhr.abort() };
  },
};
