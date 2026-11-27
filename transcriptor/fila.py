"""Fila de transcrição: um trabalho por vez, cada um em processo próprio.

O andamento vive em memória e é a fonte do painel. A ordem da fila é gravada em disco
a cada mudança: reiniciar o painel retoma a fila, inclusive a aula que estava no meio.
O resultado final vive na pasta `- transcricao`, então nada pronto se perde.
"""

from __future__ import annotations

import json
import logging
import multiprocessing as mp
import queue
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from multiprocessing.process import BaseProcess
from multiprocessing.queues import Queue
from pathlib import Path
from typing import Any, Literal

from transcriptor import motor, trabalhador

log = logging.getLogger(__name__)

Estado = Literal["na_fila", "carregando", "transcrevendo", "concluido", "erro", "cancelado"]
FINAIS: frozenset[Estado] = frozenset({"concluido", "erro", "cancelado"})
HISTORICO_MAXIMO = 50
DECORRIDO_MINIMO_PARA_ESTIMAR_S = 8.0

Alvo = Callable[[trabalhador.Pedido, "Queue[dict[str, Any]]"], None]


class JaNaFila(Exception):
    """A aula já está na fila ou sendo transcrita."""


@dataclass
class Trabalho:
    id: str
    arquivo: str
    idioma: str | None
    termos: str | None
    duracao: float = 0.0
    estado: Estado = "na_fila"
    criado: float = field(default_factory=time.time)
    terminado: float | None = None
    erro: str | None = None
    posicao: float = 0.0
    segmentos: list[dict[str, Any]] = field(default_factory=list)
    _inicio_relogio: float | None = None  # time.monotonic() ao receber a duração

    def decorrido(self, agora: float) -> float:
        return agora - self._inicio_relogio if self._inicio_relogio is not None else 0.0

    def velocidade(self, agora: float) -> float | None:
        """Segundos de áudio processados por segundo de relógio."""
        decorrido = self.decorrido(agora)
        if self.estado != "transcrevendo" or decorrido < DECORRIDO_MINIMO_PARA_ESTIMAR_S:
            return None
        return self.posicao / decorrido if self.posicao > 0 else None

    def resumo(self, agora: float, velocidade_referencia: float | None) -> dict[str, Any]:
        velocidade = self.velocidade(agora)
        estimativa = velocidade or velocidade_referencia
        restante: float | None = None
        if self.estado in ("na_fila", "carregando", "transcrevendo") and estimativa:
            restante = max(0.0, self.duracao - self.posicao) / estimativa
        return {
            "id": self.id,
            "arquivo": self.arquivo,
            "estado": self.estado,
            "idioma": self.idioma,
            "termos": self.termos,
            "duracao": round(self.duracao, 2),
            "posicao": round(self.posicao, 2),
            "progresso": min(1.0, self.posicao / self.duracao) if self.duracao else 0.0,
            "velocidade": round(velocidade, 2) if velocidade else None,
            "restante": round(restante) if restante is not None else None,
            "restante_estimado": velocidade is None and restante is not None,
            "decorrido": round(self.decorrido(agora)),
            "segmentos": len(self.segmentos),
            "ultimo_trecho": " ".join(s["texto"] for s in self.segmentos[-3:]),
            "criado": self.criado,
            "terminado": self.terminado,
            "erro": self.erro,
        }


@dataclass
class _Execucao:
    trabalho: Trabalho
    processo: BaseProcess
    eventos: Queue[dict[str, Any]]
    terminal: bool = False


class Fila:
    def __init__(
        self,
        gravacoes: Path,
        modelo: Path,
        threads: int,
        alvo: Alvo = trabalhador.executar,
        arquivo_fila: Path | None = None,
    ) -> None:
        self._gravacoes = gravacoes
        self._modelo = modelo
        self._threads = threads
        self._alvo = alvo
        self._arquivo_fila = arquivo_fila
        self._contexto = mp.get_context("spawn")
        self._trava = threading.Condition()
        self._trabalhos: dict[str, Trabalho] = {}
        self._pendentes: deque[str] = deque()
        self._atual: _Execucao | None = None
        self._versao = 0
        self._velocidade_referencia: float | None = None
        self._parar = threading.Event()
        self._supervisor = threading.Thread(target=self._supervisionar, name="fila", daemon=True)

    # ---- ciclo de vida -------------------------------------------------------------

    def iniciar(self) -> None:
        self._retomar()
        self._supervisor.start()

    def _retomar(self) -> None:
        if self._arquivo_fila is None or not self._arquivo_fila.is_file():
            return
        try:
            salvos = json.loads(self._arquivo_fila.read_text(encoding="utf-8"))
        except (OSError, ValueError) as erro:
            log.warning("Fila salva ilegível, começando vazia: %s", erro)
            return
        for item in salvos if isinstance(salvos, list) else []:
            audio = self._gravacoes / str(item.get("arquivo", ""))
            if not audio.is_file() or motor.pronta(audio):
                continue
            try:
                self.adicionar(
                    audio.name,
                    item.get("idioma"),
                    item.get("termos"),
                    float(item.get("duracao", 0)),
                )
                log.info("Retomando da fila salva: %s", audio.name)
            except JaNaFila:
                continue

    def _salvar(self) -> None:
        """Grava a ordem da fila (ativo primeiro). Chamado com a trava já tomada."""
        if self._arquivo_fila is None:
            return
        ordem = ([self._atual.trabalho.id] if self._atual else []) + list(self._pendentes)
        dados = [
            {
                "arquivo": t.arquivo,
                "idioma": t.idioma,
                "termos": t.termos,
                "duracao": t.duracao,
            }
            for t in (self._trabalhos.get(i) for i in ordem)
            if t is not None and t.estado not in FINAIS
        ]
        temporario = self._arquivo_fila.with_name(self._arquivo_fila.name + ".tmp")
        try:
            temporario.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
            temporario.replace(self._arquivo_fila)
        except OSError as erro:
            log.warning("Não consegui salvar a fila: %s", erro)

    def encerrar(self) -> None:
        self._parar.set()
        with self._trava:
            # Grava a fila como está, com a aula interrompida na frente: ela recomeça ao abrir.
            self._salvar()
            if self._atual:
                self._atual.terminal = True
                self._atual.processo.terminate()
            self._trava.notify_all()
        if self._supervisor.is_alive():
            self._supervisor.join(timeout=5)

    # ---- comandos --------------------------------------------------------------------

    def adicionar(
        self, arquivo: str, idioma: str | None, termos: str | None, duracao: float
    ) -> Trabalho:
        with self._trava:
            for t in self._trabalhos.values():
                if t.arquivo == arquivo and t.estado not in FINAIS:
                    raise JaNaFila(arquivo)
            trabalho = Trabalho(uuid.uuid4().hex[:12], arquivo, idioma, termos, duracao)
            self._trabalhos[trabalho.id] = trabalho
            self._pendentes.append(trabalho.id)
            self._podar_historico()
            self._salvar()
            self._mudou()
            log.info("Na fila: %s", arquivo)
            return trabalho

    def cancelar(self, id_: str) -> bool:
        with self._trava:
            trabalho = self._trabalhos.get(id_)
            if trabalho is None or trabalho.estado in FINAIS:
                return False
            if id_ in self._pendentes:
                self._pendentes.remove(id_)
            elif self._atual and self._atual.trabalho.id == id_:
                self._atual.terminal = True
                self._atual.processo.terminate()
            self._finalizar(trabalho, "cancelado")
            return True

    def limpar_historico(self) -> int:
        with self._trava:
            finais = [i for i, t in self._trabalhos.items() if t.estado in FINAIS]
            for i in finais:
                del self._trabalhos[i]
            if finais:
                self._mudou()
            return len(finais)

    # ---- leitura ---------------------------------------------------------------------

    @property
    def versao(self) -> int:
        return self._versao

    def instantaneo(self) -> dict[str, Any]:
        agora = time.monotonic()
        with self._trava:
            referencia = self._velocidade_referencia
            if self._atual:
                referencia = self._atual.trabalho.velocidade(agora) or referencia
            trabalhos = [t.resumo(agora, referencia) for t in self._trabalhos.values()]
            ativo = self._atual.trabalho.id if self._atual else None
            pid = self._atual.processo.pid if self._atual else None
        restante_total = sum(t["restante"] or 0 for t in trabalhos)
        return {
            "versao": self._versao,
            "trabalhos": trabalhos,
            "ativo": ativo,
            "pid": pid,
            "restante_total": restante_total if any(t["restante"] for t in trabalhos) else None,
            "velocidade_referencia": round(referencia, 2) if referencia else None,
        }

    def segmentos(self, id_: str, desde: int, limite: int) -> list[dict[str, Any]] | None:
        with self._trava:
            trabalho = self._trabalhos.get(id_)
            if trabalho is None:
                return None
            inicio = max(0, desde)
            return trabalho.segmentos[inicio : inicio + limite]

    def arquivos_ocupados(self) -> dict[str, str]:
        """Arquivo -> estado, para as aulas que estão na fila ou sendo transcritas."""
        with self._trava:
            return {t.arquivo: t.estado for t in self._trabalhos.values() if t.estado not in FINAIS}

    # ---- supervisor ------------------------------------------------------------------

    def _mudou(self) -> None:
        self._versao += 1
        self._trava.notify_all()

    def _podar_historico(self) -> None:
        finais = [i for i, t in self._trabalhos.items() if t.estado in FINAIS]
        for i in finais[: max(0, len(finais) - HISTORICO_MAXIMO)]:
            del self._trabalhos[i]

    def _finalizar(self, trabalho: Trabalho, estado: Estado, erro: str | None = None) -> None:
        if estado == "erro":
            log.error("Falhou: %s: %s", trabalho.arquivo, erro)
        else:
            log.info("%s: %s", estado.capitalize(), trabalho.arquivo)
        trabalho.estado = estado
        trabalho.erro = erro
        trabalho.terminado = time.time()
        if estado == "concluido":
            velocidade = (
                trabalho.posicao / trabalho.decorrido(time.monotonic())
                if trabalho.decorrido(time.monotonic()) > 0
                else None
            )
            if velocidade:
                self._velocidade_referencia = velocidade
        self._salvar()  # o trabalho já está em estado final: sai da fila gravada
        self._mudou()

    def _comecar_proximo(self) -> None:
        while self._pendentes:
            trabalho = self._trabalhos[self._pendentes.popleft()]
            audio = self._gravacoes / trabalho.arquivo
            if not audio.is_file():
                self._finalizar(trabalho, "erro", "O arquivo não está mais na pasta Gravações.")
                continue
            eventos: Queue[dict[str, Any]] = self._contexto.Queue()
            pedido = trabalhador.Pedido(
                audio, self._modelo, self._threads, trabalho.idioma, trabalho.termos
            )
            processo = self._contexto.Process(
                target=self._alvo, args=(pedido, eventos), name=f"transcricao-{trabalho.id}"
            )
            processo.daemon = True
            processo.start()
            trabalho.estado = "carregando"
            self._atual = _Execucao(trabalho, processo, eventos)
            log.info("Transcrevendo: %s (processo %s)", trabalho.arquivo, processo.pid)
            self._mudou()
            return

    def _aplicar(self, execucao: _Execucao, evento: dict[str, Any]) -> None:
        trabalho = execucao.trabalho
        if execucao.terminal:
            return
        tipo = evento.get("tipo")
        if tipo == "iniciado":
            trabalho.duracao = float(evento["duracao"])
            trabalho.estado = "transcrevendo"
            trabalho._inicio_relogio = time.monotonic()
        elif tipo == "segmento":
            trabalho.segmentos.append({k: evento[k] for k in ("inicio", "fim", "texto", "logprob")})
            trabalho.posicao = float(evento["fim"])
        elif tipo == "concluido":
            trabalho.posicao = trabalho.duracao
            execucao.terminal = True
            self._finalizar(trabalho, "concluido")
            return
        elif tipo == "erro":
            execucao.terminal = True
            self._finalizar(trabalho, "erro", str(evento.get("mensagem")))
            return
        self._mudou()

    def _supervisionar(self) -> None:
        while not self._parar.is_set():
            with self._trava:
                if self._atual is None:
                    self._comecar_proximo()
                execucao = self._atual
                if execucao is None:
                    self._trava.wait(timeout=0.5)
                    continue
            try:
                evento = execucao.eventos.get(timeout=0.25)
            except queue.Empty:
                evento = None
            except (EOFError, OSError):
                evento = None
            with self._trava:
                if self._parar.is_set():
                    return  # encerrado pelo próprio painel: não é falha da transcrição
                if evento is not None:
                    self._aplicar(execucao, evento)
                    continue
                if execucao.processo.is_alive():
                    continue
                if not execucao.terminal:
                    execucao.terminal = True
                    self._finalizar(
                        execucao.trabalho,
                        "erro",
                        f"O processo de transcrição parou inesperadamente "
                        f"(código {execucao.processo.exitcode}). "
                        "Os detalhes estão na janela do iniciar.bat.",
                    )
                self._atual = None
                self._salvar()
                self._mudou()
