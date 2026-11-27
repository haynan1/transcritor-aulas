"""Configuração lida do ambiente, com padrões que funcionam sem nenhum ajuste."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import psutil

RAIZ = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"  # Só a própria máquina. O painel lê e grava arquivos: nunca exponha na rede.


def _threads_padrao() -> int:
    # O CTranslate2 rende mais com um thread por núcleo físico; acima disso só disputa cache.
    return psutil.cpu_count(logical=False) or os.cpu_count() or 4


@dataclass(frozen=True)
class Config:
    gravacoes: Path
    modelo: Path
    threads: int
    porta: int


def carregar() -> Config:
    ambiente = os.environ
    return Config(
        gravacoes=Path(ambiente.get("TRANSCRIPTOR_GRAVACOES", RAIZ / "Gravações")).resolve(),
        modelo=Path(
            ambiente.get(
                "TRANSCRIPTOR_MODELO", Path.home() / "TranscritorAulas" / "modelo-large-v3-turbo"
            )
        ),
        threads=int(ambiente.get("TRANSCRIPTOR_THREADS", _threads_padrao())),
        porta=int(ambiente.get("TRANSCRIPTOR_PORTA", 7351)),
    )
