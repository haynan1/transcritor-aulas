"""Dublês do modelo e do processo de transcrição.

Os trabalhadores falsos rodam em processo real (spawn), como o de verdade: por isso ficam
num módulo importável, não dentro dos testes.
"""

from __future__ import annotations

import os
import time
from types import SimpleNamespace as NS

from transcriptor import motor


class ModeloFalso:
    def __init__(self, segmentos, falhar_em=(), duracao=10.0):
        self.segmentos, self.falhar_em, self.duracao = segmentos, falhar_em, duracao
        self.chamadas = []

    def transcribe(self, caminho, **opcoes):
        self.chamadas.append((caminho, opcoes))
        if any(n in caminho for n in self.falhar_em):
            raise ValueError("midia invalida")
        return iter(self.segmentos), NS(duration=self.duracao, language="pt")


def fala(inicio, fim, texto, logprob=-0.1):
    return NS(start=inicio, end=fim, text=texto, avg_logprob=logprob)


def _relator(eventos):
    def relatar(seg, duracao):
        if seg is None:
            eventos.put({"tipo": "iniciado", "duracao": duracao})
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

    return relatar


def concluir(pedido, eventos):
    eventos.put({"tipo": "carregando"})
    modelo = ModeloFalso([fala(0, 4, " Primeira frase."), fala(7, 9, " Segunda frase.")])
    motor.transcrever(modelo, pedido.audio, pedido.idioma, pedido.termos, _relator(eventos))
    eventos.put({"tipo": "concluido"})


def falhar(pedido, eventos):
    eventos.put({"tipo": "erro", "mensagem": "não consegui transcrever (teste)"})


def morrer(pedido, eventos):
    os._exit(3)


def demorar(pedido, eventos):
    eventos.put({"tipo": "iniciado", "duracao": 1000.0})
    for n in range(600):
        eventos.put(
            {"tipo": "segmento", "inicio": n, "fim": n + 1, "texto": f"t{n}", "logprob": 0.0}
        )
        time.sleep(0.05)
    eventos.put({"tipo": "concluido"})
