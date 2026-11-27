"""Leitura do formato de um arquivo de mídia e comparação com o formato recomendado."""

from __future__ import annotations

import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import av

# O Whisper converte tudo para 16 kHz mono antes de transcrever: exportar assim não perde nada.
TAXA_IDEAL = 16_000
CANAIS_IDEAL = 1
CODEC_IDEAL = "flac"


@dataclass(frozen=True)
class Formato:
    codec: str
    taxa: int
    canais: int
    bits: int | None
    duracao: float
    avisos: tuple[str, ...] = field(default_factory=tuple)

    @property
    def recomendado(self) -> bool:
        return not self.avisos

    def como_dict(self) -> dict[str, Any]:
        return {**asdict(self), "avisos": list(self.avisos), "recomendado": self.recomendado}


def _avisos(codec: str, taxa: int, canais: int) -> tuple[str, ...]:
    avisos: list[str] = []
    if codec != CODEC_IDEAL:
        avisos.append(f"Formato {codec.upper()}: em FLAC o arquivo fica menor e sem perda.")
    if canais != CANAIS_IDEAL:
        avisos.append(f"{canais} canais: em mono o arquivo cai pela metade e transcreve igual.")
    if taxa > TAXA_IDEAL:
        avisos.append(f"{taxa} Hz: a 16000 Hz o arquivo fica menor e transcreve igual.")
    elif taxa < TAXA_IDEAL:
        avisos.append(f"{taxa} Hz: abaixo de 16000 Hz a transcrição pode perder palavras.")
    return tuple(avisos)


def sondar(caminho: Path) -> Formato:
    """Lê só o cabeçalho; levanta ValueError se não houver áudio legível."""
    try:
        with av.open(str(caminho)) as recipiente:
            if not recipiente.streams.audio:
                raise ValueError("o arquivo não tem faixa de áudio")
            faixa = recipiente.streams.audio[0]
            contexto = faixa.codec_context
            codec = str(contexto.name)
            taxa = int(contexto.sample_rate or 0)
            canais = int(contexto.channels or 0)
            formato = contexto.format
            bits = int(formato.bytes) * 8 if formato is not None and formato.bytes else None
            if recipiente.duration:
                duracao = recipiente.duration / av.time_base
            elif faixa.duration and faixa.time_base:
                duracao = float(faixa.duration * faixa.time_base)
            else:
                duracao = 0.0
    except (av.error.FFmpegError, OSError, UnicodeDecodeError) as erro:
        raise ValueError(f"não consegui ler o áudio ({erro})") from erro
    if "pcm" in codec:
        codec = "wav"
    return Formato(codec, taxa, canais, bits, round(duracao, 2), _avisos(codec, taxa, canais))


class CacheDeFormatos:
    """Evita reabrir o arquivo a cada listagem; invalida quando tamanho ou data mudam."""

    def __init__(self) -> None:
        self._dados: dict[Path, tuple[int, float, Formato | None]] = {}
        self._trava = threading.Lock()

    def obter(self, caminho: Path) -> Formato | None:
        info = caminho.stat()
        chave = (info.st_size, info.st_mtime)
        with self._trava:
            guardado = self._dados.get(caminho)
        if guardado and guardado[:2] == chave:
            return guardado[2]
        try:
            formato: Formato | None = sondar(caminho)
        except ValueError:
            formato = None
        with self._trava:
            self._dados[caminho] = (*chave, formato)
        return formato
