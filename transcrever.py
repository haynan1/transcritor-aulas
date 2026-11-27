"""Transcreve aulas gravadas, localmente, com Whisper (faster-whisper).

Para cada áudio ou vídeo, gera ao lado do arquivo uma pasta `<nome> - transcricao` com:
  transcricao.md   texto em parágrafos, com marcação de tempo
  legendas.srt     legendas
  segmentos.json   segmentos com tempos e confiança

Nada é enviado para a internet: o modelo é lido do disco.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Sequence

BASE = Path.home() / "TranscritorAulas"
MODELO = BASE / "modelo-large-v3-turbo"
EXTENSOES = frozenset(
    ".mp3 .flac .wav .m4a .aac .ogg .opus .wma .mp4 .mkv .webm .mov .avi".split()
)

PROJETOS_AUDACITY = frozenset({".aup", ".aup3", ".aup4"})

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
    texto: str
    inseguro: bool


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
    os.replace(temporario, destino)


def pasta_de_saida(audio: Path) -> Path:
    # A extensão entra no nome para aula.mp3 e aula.mp4 não se sobrescreverem.
    return audio.with_name(f"{audio.name} - transcricao")


def coletar(entradas: Iterable[Path]) -> list[Path]:
    """Expande pastas (sem descer em subpastas) e valida os arquivos."""
    encontrados: dict[Path, None] = {}
    for entrada in entradas:
        entrada = entrada.resolve()
        if entrada.is_dir():
            for arquivo in sorted(entrada.iterdir()):
                if arquivo.is_file() and arquivo.suffix.lower() in EXTENSOES:
                    encontrados[arquivo] = None
        elif not entrada.is_file():
            raise ErroTranscricao(f"Arquivo não encontrado: {entrada}")
        elif entrada.suffix.lower() in PROJETOS_AUDACITY:
            raise ErroTranscricao(
                f"{entrada.name} é um projeto do Audacity. "
                "Abra no Audacity e use Arquivo > Exportar áudio para gerar um MP3."
            )
        elif entrada.suffix.lower() not in EXTENSOES:
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


def transcrever(modelo, audio: Path, idioma: str | None, termos: str | None) -> Path:
    inicio = time.monotonic()
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
        segmentos: list[Segmento] = []
        for s in gerador:
            segmentos.append(
                Segmento(round(s.start, 2), round(s.end, 2), s.text.strip(), round(s.avg_logprob, 3))
            )
            feito = min(100, s.end / info.duration * 100) if info.duration else 100
            print(f"\r  {feito:3.0f}%  {relogio(s.end)} de {relogio(info.duration)}", end="", flush=True)
    except Exception as erro:
        # PyAV e CTranslate2 lançam tipos variados para mídia ilegível.
        raise ErroTranscricao(f"não consegui transcrever ({type(erro).__name__}: {erro})") from erro
    print()

    saida = pasta_de_saida(audio)
    saida.mkdir(exist_ok=True)
    gravar(saida / "transcricao.md", montar_md(audio.stem, info.duration, segmentos))
    gravar(saida / "legendas.srt", montar_srt(segmentos))
    dados = {
        "arquivo": audio.name,
        "idioma": info.language,
        "duracao": round(info.duration, 2),
        "segmentos": [asdict(s) for s in segmentos],
    }
    gravar(saida / "segmentos.json", json.dumps(dados, ensure_ascii=False, indent=1))

    gasto = time.monotonic() - inicio
    print(f"  Pronto em {relogio(gasto)} ({info.duration / gasto:.1f}x o tempo real)")
    return saida


def carregar_modelo(threads: int):
    if not (MODELO / "model.bin").is_file():
        raise ErroTranscricao(f"Modelo não encontrado em {MODELO}. Rode instalar.bat.")
    from faster_whisper import WhisperModel

    return WhisperModel(
        str(MODELO), device="cpu", compute_type="int8", cpu_threads=threads, local_files_only=True
    )


def main(argv: Sequence[str] | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8", errors="replace")

    cli = argparse.ArgumentParser(description="Transcreve aulas localmente.")
    cli.add_argument("entradas", nargs="+", type=Path, help="arquivos ou pastas")
    cli.add_argument("--idioma", default="pt", help="pt, en, es... ou auto (padrão: pt)")
    cli.add_argument("--termos", help="nomes e jargões do curso, separados por vírgula")
    cli.add_argument("--refazer", action="store_true", help="transcreve mesmo se já estiver pronto")
    cli.add_argument("--threads", type=int, default=16, help="núcleos usados (padrão: 16)")
    args = cli.parse_args(argv)

    try:
        arquivos = coletar(args.entradas)
        pendentes = [a for a in arquivos if args.refazer or not pronta(a)]
        for feito in (a for a in arquivos if a not in pendentes):
            print(f"Já transcrito, pulando: {feito.name}")
        if not pendentes:
            return 0
        print("Carregando o modelo...")
        modelo = carregar_modelo(args.threads)
    except ErroTranscricao as erro:
        print(f"Erro: {erro}", file=sys.stderr)
        return 1

    idioma = None if args.idioma == "auto" else args.idioma
    falhas = 0
    for n, audio in enumerate(pendentes, 1):
        print(f"[{n}/{len(pendentes)}] {audio.name}")
        try:
            saida = transcrever(modelo, audio, idioma, args.termos)
            print(f"  {saida}")
        except (ErroTranscricao, OSError) as erro:
            # Um arquivo ruim não derruba o resto da fila.
            falhas += 1
            print(f"\n  Erro em {audio.name}: {erro}", file=sys.stderr)
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
