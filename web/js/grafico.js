// @ts-check
// Gráfico de CPU em tempo real (canvas): área para a máquina, linha tracejada para a transcrição.

const JANELA_S = 120;

export class GraficoCpu {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.contexto = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    /** @type {{t: number, total: number, trabalhador: number}[]} */
    this.pontos = [];
    this.cores = this.lerCores();
    this.observador = new ResizeObserver(() => this.desenhar());
    this.observador.observe(canvas);
    this.aoMudarTema = () => {
      this.cores = this.lerCores();
      this.desenhar();
    };
    document.addEventListener("tema", this.aoMudarTema);
  }

  lerCores() {
    const estilo = getComputedStyle(document.documentElement);
    const ler = (nome) => estilo.getPropertyValue(nome).trim();
    return { total: ler("--grafico-total"), trabalhador: ler("--grafico-trabalhador"), grade: ler("--grade") };
  }

  /** @param {{t: number, total: number, trabalhador: number}[]} pontos */
  atualizar(pontos) {
    this.pontos = pontos;
    this.desenhar();
  }

  desenhar() {
    const { canvas, contexto: c, cores } = this;
    const escala = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    if (!largura || !altura) return;
    if (canvas.width !== Math.round(largura * escala)) canvas.width = Math.round(largura * escala);
    if (canvas.height !== Math.round(altura * escala)) canvas.height = Math.round(altura * escala);
    c.setTransform(escala, 0, 0, escala, 0, 0);
    c.clearRect(0, 0, largura, altura);

    c.strokeStyle = cores.grade;
    c.lineWidth = 1;
    for (const nivel of [25, 50, 75]) {
      const y = Math.round(altura - (nivel / 100) * altura) + 0.5;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(largura, y);
      c.stroke();
    }
    if (this.pontos.length < 2) return;

    const agora = this.pontos[this.pontos.length - 1].t;
    const x = (t) => largura - ((agora - t) / JANELA_S) * largura;
    const y = (v) => altura - (Math.min(100, Math.max(0, v)) / 100) * (altura - 2) - 1;

    const caminho = (serie) => {
      c.beginPath();
      this.pontos.forEach((p, i) => (i ? c.lineTo(x(p.t), y(p[serie])) : c.moveTo(x(p.t), y(p[serie]))));
    };

    caminho("total");
    c.lineTo(x(agora), altura);
    c.lineTo(x(this.pontos[0].t), altura);
    c.closePath();
    const gradiente = c.createLinearGradient(0, 0, 0, altura);
    gradiente.addColorStop(0, withAlpha(cores.total, 0.28));
    gradiente.addColorStop(1, withAlpha(cores.total, 0.02));
    c.fillStyle = gradiente;
    c.fill();

    caminho("total");
    c.strokeStyle = cores.total;
    c.lineWidth = 1.75;
    c.lineJoin = "round";
    c.stroke();

    caminho("trabalhador");
    c.setLineDash([4, 4]);
    c.strokeStyle = cores.trabalhador;
    c.lineWidth = 1.5;
    c.stroke();
    c.setLineDash([]);
  }

  destruir() {
    this.observador.disconnect();
    document.removeEventListener("tema", this.aoMudarTema);
  }
}

/** #rrggbb -> rgba com transparência */
function withAlpha(hex, alfa) {
  const valor = hex.replace("#", "");
  if (valor.length !== 6) return hex;
  const n = parseInt(valor, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}
