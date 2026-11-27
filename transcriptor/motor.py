"""Transcrição de um arquivo e montagem dos resultados.

Para cada áudio ou vídeo, grava ao lado do arquivo uma pasta `<nome> - transcricao` com:
  transcricao.md   texto em parágrafos, com marcação de tempo
  legendas.srt     legendas
  segmentos.json   segmentos com tempos e confiança (gravado por último: marca de conclusão)

Nada é enviado para a internet: o modelo é lido do disco.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Protocol, TypedDict, cast

import av

EXTENSOES = frozenset(
    {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma"}  # áudio
    | {".mp4", ".mkv", ".webm", ".mov", ".avi"}  # vídeo
)
PROJETOS_AUDACITY = frozenset({".aup", ".aup3", ".aup4"})
SUFIXO_SAIDA = " - transcricao"
ARQUIVOS_SAIDA = ("transcricao.md", "legendas.srt", "segmentos.json")

# Um parágrafo fecha numa pausa longa ou, passado o alvo, no fim de uma frase.
PAUSA_PARAGRAFO_S = 2.0
ALVO_PARAGRAFO = 500
LIMITE_PARAGRAFO = 1000

# Abaixo disso o modelo estava inseguro: vale conferir no áudio.
LOGPROB_INSEGURO = -0.8


class ErroTranscricao(Exception):
    """Erro esperado, com mensagem que faz sentido para quem usa."""


@dataclass(frozen=True)
class Segmento:
    inicio: float
    fim: float
    texto: str
    logprob: float = 0.0

    @property
    def inseguro(self) -> bool:
        return self.logprob < LOGPROB_INSEGURO


@dataclass(frozen=True)
class Paragrafo:
    inicio: float
    fim: float
    texto: str
    inseguro: bool


class SegmentoWhisper(Protocol):
    start: float
    end: float
    text: str
    avg_logprob: float


class InfoWhisper(Protocol):
    duration: float
    language: str


class ModeloWhisper(Protocol):
    """O que usamos do faster_whisper.WhisperModel (que não publica tipos)."""

    def transcribe(
        self, audio: str, **opcoes: object
    ) -> tuple[Iterable[SegmentoWhisper], InfoWhisper]: ...


class SegmentoJson(TypedDict):
    inicio: float
    fim: float
    texto: str
    logprob: float


class ArquivoSegmentos(TypedDict):
    arquivo: str
    idioma: str
    duracao: float
    segmentos: list[SegmentoJson]


# Erros que a leitura do áudio (PyAV) e o modelo (CTranslate2) lançam para mídia ruim.
ERROS_DE_MIDIA = (av.error.FFmpegError, RuntimeError, ValueError, OSError)


# Chamado com None ao começar (depois de ler a duração) e com cada segmento novo.
Progresso = Callable[[Segmento | None, float], None]


def relogio(segundos: float) -> str:
    total = max(0, int(segundos))
    return f"{total // 3600:02d}:{total // 60 % 60:02d}:{total % 60:02d}"


def relogio_srt(segundos: float) -> str:
    ms = max(0, round(segundos * 1000))
    horas, ms = divmod(ms, 3_600_000)
    minutos, ms = divmod(ms, 60_000)
    seg, ms = divmod(ms, 1000)
    return f"{horas:02d}:{minutos:02d}:{seg:02d},{ms:03d}"


def agrupar(segmentos: Iterable[Segmento]) -> list[Paragrafo]:
    paragrafos: list[Paragrafo] = []
    bloco: list[Segmento] = []

    def fechar() -> None:
        if bloco:
            paragrafos.append(
                Paragrafo(
                    bloco[0].inicio,
                    bloco[-1].fim,
                    " ".join(s.texto for s in bloco),
                    any(s.inseguro for s in bloco),
                )
            )
            bloco.clear()

    for seg in segmentos:
        if not seg.texto:
            continue
        if bloco:
            tamanho = sum(len(s.texto) + 1 for s in bloco)
            fim_de_frase = bloco[-1].texto.endswith((".", "?", "!", "…"))
            pausa = seg.inicio - bloco[-1].fim
            if (
                pausa >= PAUSA_PARAGRAFO_S
                or tamanho >= LIMITE_PARAGRAFO
                or (tamanho >= ALVO_PARAGRAFO and fim_de_frase)
            ):
                fechar()
        bloco.append(seg)
    fechar()
    return paragrafos


def montar_md(titulo: str, duracao: float, segmentos: Sequence[Segmento]) -> str:
    paragrafos = agrupar(segmentos)
    linhas = [
        f"# {titulo}",
        "",
        f"Duração: {relogio(duracao)} · Transcrito em: {date.today():%d/%m/%Y}",
    ]
    if any(p.inseguro for p in paragrafos):
        linhas += ["", "Trechos com **[conferir]** tiveram baixa confiança no áudio."]
    for p in paragrafos:
        aviso = " **[conferir]**" if p.inseguro else ""
        linhas += ["", f"`{relogio(p.inicio)}`{aviso} {p.texto}"]
    if not paragrafos:
        linhas += ["", "Nenhuma fala encontrada neste arquivo."]
    return "\n".join(linhas) + "\n"


def montar_srt(segmentos: Sequence[Segmento]) -> str:
    return "\n".join(
        f"{n}\n{relogio_srt(s.inicio)} --> {relogio_srt(s.fim)}\n{s.texto}\n"
        for n, s in enumerate(segmentos, 1)
    )


def gravar(destino: Path, conteudo: str) -> None:
    """Troca o arquivo de uma vez, para nunca deixar um resultado pela metade."""
    temporario = destino.with_name(destino.name + ".tmp")
    temporario.write_text(conteudo, encoding="utf-8")
    temporario.replace(destino)


def pasta_de_saida(audio: Path) -> Path:
    # A extensão entra no nome para aula.mp3 e aula.mp4 não se sobrescreverem.
    return audio.with_name(f"{audio.name}{SUFIXO_SAIDA}")


def eh_midia(caminho: Path) -> bool:
    return caminho.suffix.lower() in EXTENSOES


def coletar(entradas: Iterable[Path]) -> list[Path]:
    """Expande pastas (sem descer em subpastas) e valida os arquivos."""
    encontrados: dict[Path, None] = {}
    for entrada in entradas:
        entrada = entrada.resolve()
        if entrada.is_dir():
            for arquivo in sorted(entrada.iterdir()):
                if arquivo.is_file() and eh_midia(arquivo):
                    encontrados[arquivo] = None
        elif not entrada.is_file():
            raise ErroTranscricao(f"Arquivo não encontrado: {entrada}")
        elif entrada.suffix.lower() in PROJETOS_AUDACITY:
            raise ErroTranscricao(
                f"{entrada.name} é um projeto do Audacity. "
                "Abra no Audacity e use Arquivo > Exportar áudio para gerar um FLAC."
            )
        elif not eh_midia(entrada):
            raise ErroTranscricao(f"Formato não suportado: {entrada.name}")
        else:
            encontrados[entrada] = None
    if not encontrados:
        raise ErroTranscricao("Nenhum áudio ou vídeo encontrado.")
    return list(encontrados)


def pronta(audio: Path) -> bool:
    """O JSON é gravado por último: se ele é mais novo que o áudio, terminou."""
    marca = pasta_de_saida(audio) / "segmentos.json"
    return marca.is_file() and marca.stat().st_mtime >= audio.stat().st_mtime


def ler_segmentos(audio: Path) -> ArquivoSegmentos:
    texto = (pasta_de_saida(audio) / "segmentos.json").read_text(encoding="utf-8")
    return cast(ArquivoSegmentos, json.loads(texto))


def transcrever(
    modelo: ModeloWhisper,
    audio: Path,
    idioma: str | None,
    termos: str | None,
    progresso: Progresso | None = None,
) -> Path:
    try:
        gerador, info = modelo.transcribe(
            str(audio),
            language=idioma,
            beam_size=5,
            vad_filter=True,
            # Evita que um erro se repita em cascata nas aulas longas.
            condition_on_previous_text=False,
            # hotwords vale para a aula toda; initial_prompt só alcançaria o começo.
            # A frase precisa de ponto: lista solta faz o modelo parar de pontuar.
            hotwords=f"Termos: {termos.strip(' .')}." if termos else None,
        )
        if progresso:
            progresso(None, info.duration)
        segmentos: list[Segmento] = []
        for s in gerador:
            seg = Segmento(
                round(s.start, 2), round(s.end, 2), s.text.strip(), round(s.avg_logprob, 3)
            )
            segmentos.append(seg)
            if progresso:
                progresso(seg, info.duration)
    except ERROS_DE_MIDIA as erro:
        raise ErroTranscricao(f"não consegui transcrever ({type(erro).__name__}: {erro})") from erro

    saida = pasta_de_saida(audio)
    saida.mkdir(exist_ok=True)
    gravar(saida / "transcricao.md", montar_md(audio.stem, info.duration, segmentos))
    gravar(saida / "legendas.srt", montar_srt(segmentos))
    dados: ArquivoSegmentos = {
        "arquivo": audio.name,
        "idioma": info.language,
        "duracao": round(info.duration, 2),
        "segmentos": [cast(SegmentoJson, asdict(s)) for s in segmentos],
    }
    gravar(saida / "segmentos.json", json.dumps(dados, ensure_ascii=False, indent=1))
    return saida


def carregar_modelo(caminho: Path, threads: int) -> ModeloWhisper:
    if not (caminho / "model.bin").is_file():
        raise ErroTranscricao(f"Modelo não encontrado em {caminho}. Rode instalar.bat.")
    from faster_whisper import WhisperModel

    modelo: ModeloWhisper = WhisperModel(
        str(caminho), device="cpu", compute_type="int8", cpu_threads=threads, local_files_only=True
    )
    return modelo
