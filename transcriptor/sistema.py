"""Amostragem de CPU e memória, da máquina e do processo de transcrição."""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from typing import Any

import psutil

INTERVALO_S = 1.0
JANELA = 120  # dois minutos de histórico no gráfico


class Monitor:
    def __init__(self, pid_trabalhador: Callable[[], int | None]) -> None:
        self._pid_trabalhador = pid_trabalhador
        self._nucleos = psutil.cpu_count() or 1
        self._fisicos = psutil.cpu_count(logical=False) or self._nucleos
        self._historico: deque[dict[str, float]] = deque(maxlen=JANELA)
        self._por_nucleo: list[float] = []
        self._processo: psutil.Process | None = None
        self._trabalhador_cpu = 0.0
        self._trabalhador_memoria = 0
        self._trava = threading.Lock()
        self._parar = threading.Event()
        self._thread = threading.Thread(target=self._amostrar, name="monitor", daemon=True)

    def iniciar(self) -> None:
        psutil.cpu_percent(percpu=True)  # a primeira leitura só arma o contador
        self._thread.start()

    def encerrar(self) -> None:
        self._parar.set()
        if self._thread.is_alive():
            self._thread.join(timeout=2)

    def _medir_trabalhador(self) -> tuple[float, int]:
        pid = self._pid_trabalhador()
        if pid is None:
            self._processo = None
            return 0.0, 0
        try:
            if self._processo is None or self._processo.pid != pid:
                self._processo = psutil.Process(pid)
                self._processo.cpu_percent()  # arma o contador; mede a partir da próxima
                return 0.0, self._processo.memory_info().rss
            # cpu_percent do processo vai até 100 x núcleos; normaliza para a máquina toda.
            uso = self._processo.cpu_percent() / self._nucleos
            return min(100.0, uso), self._processo.memory_info().rss
        except psutil.Error:
            self._processo = None
            return 0.0, 0

    def _amostrar(self) -> None:
        while not self._parar.wait(INTERVALO_S):
            por_nucleo = psutil.cpu_percent(percpu=True)
            total = sum(por_nucleo) / len(por_nucleo) if por_nucleo else 0.0
            trabalhador_cpu, trabalhador_memoria = self._medir_trabalhador()
            with self._trava:
                self._por_nucleo = [round(v, 1) for v in por_nucleo]
                self._trabalhador_cpu = trabalhador_cpu
                self._trabalhador_memoria = trabalhador_memoria
                self._historico.append(
                    {
                        "t": round(time.time(), 1),
                        "total": round(total, 1),
                        "trabalhador": round(trabalhador_cpu, 1),
                    }
                )

    def instantaneo(self) -> dict[str, Any]:
        memoria = psutil.virtual_memory()
        with self._trava:
            ultimo = self._historico[-1] if self._historico else {"total": 0.0}
            return {
                "cpu": ultimo["total"],
                "cpu_trabalhador": round(self._trabalhador_cpu, 1),
                "por_nucleo": list(self._por_nucleo),
                "historico": list(self._historico),
                "nucleos": self._nucleos,
                "nucleos_fisicos": self._fisicos,
                "memoria_usada": memoria.used,
                "memoria_total": memoria.total,
                "memoria_trabalhador": self._trabalhador_memoria,
            }
