"""Processo que transcreve uma aula e relata o andamento ao servidor.

Roda em processo separado para que cancelar seja instantâneo (basta encerrar o processo)
e para que uma falha no modelo nunca derrube o painel.
"""

from __future__ import annotations

from dataclasses import dataclass
from multiprocessing.queues import Queue
from pathlib import Path
from typing import Any

import psutil

from transcriptor import motor


@dataclass(frozen=True)
class Pedido:
    audio: Path
    modelo: Path
    threads: int
    idioma: str | None
    termos: str | None


def _baixar_prioridade() -> None:
    # Quem grava a próxima aula enquanto esta transcreve não pode ter o áudio picotado.
    try:
        processo = psutil.Process()
        if hasattr(psutil, "BELOW_NORMAL_PRIORITY_CLASS"):
            processo.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        else:
            processo.nice(10)
    except psutil.Error:
        pass


def executar(pedido: Pedido, eventos: Queue[dict[str, Any]]) -> None:
    _baixar_prioridade()
    eventos.put({"tipo": "carregando"})

    def relatar(seg: motor.Segmento | None, duracao: float) -> None:
        if seg is None:
            eventos.put({"tipo": "iniciado", "duracao": round(duracao, 2)})
        else:
            eventos.put(
                {
                    "tipo": "segmento",
                    "inicio": seg.inicio,
                    "fim": seg.fim,
                    "texto": seg.texto,
                    "logprob": seg.logprob,
                }
            )

    try:
        modelo = motor.carregar_modelo(pedido.modelo, pedido.threads)
        motor.transcrever(modelo, pedido.audio, pedido.idioma, pedido.termos, relatar)
    except (motor.ErroTranscricao, OSError) as erro:
        eventos.put({"tipo": "erro", "mensagem": str(erro)})
        return
    eventos.put({"tipo": "concluido"})
