"""A pasta Gravações vista como biblioteca: aulas, estado e transcrições."""

from __future__ import annotations

import re
import threading
import unicodedata
from dataclasses import asdict
from pathlib import Path
from typing import Any

from transcriptor import motor
from transcriptor.midia import CacheDeFormatos

# Letras (com acento), números, espaço e . _ - ( ). Nada de separadores de pasta.
_NOME_VALIDO = re.compile(r"^[\w\- .()]+$")
_RESERVADOS_WINDOWS = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)
TAMANHO_MAXIMO_NOME = 150


class NomeInvalido(ValueError):
    pass


class AulaNaoEncontrada(LookupError):
    pass


def validar_nome(nome: str) -> str:
    """Aceita só um nome simples de arquivo de mídia, sem caminho. Devolve em NFC."""
    nome = unicodedata.normalize("NFC", nome)
    if not nome or len(nome) > TAMANHO_MAXIMO_NOME:
        raise NomeInvalido("O nome precisa ter entre 1 e 150 caracteres.")
    if not _NOME_VALIDO.fullmatch(nome) or nome.startswith(".") or nome.endswith((" ", ".")):
        raise NomeInvalido("Use só letras, números, espaço e os sinais . _ - ( ).")
    if Path(nome).stem.split(".")[0].upper() in _RESERVADOS_WINDOWS:
        raise NomeInvalido("Esse nome é reservado pelo Windows.")
    if not motor.eh_midia(Path(nome)):
        extensoes = ", ".join(sorted(motor.EXTENSOES))
        raise NomeInvalido(f"Formato não suportado. Use um destes: {extensoes}.")
    return nome


class Biblioteca:
    def __init__(self, pasta: Path) -> None:
        self.pasta = pasta
        self._formatos = CacheDeFormatos()
        # Resumo de cada transcrição, invalidado quando o segmentos.json muda.
        self._resumos: dict[Path, tuple[float, int, dict[str, Any] | None]] = {}
        self._trava = threading.Lock()

    def caminho(self, nome: str) -> Path:
        """Resolve o nome para um arquivo que existe direto na pasta, ou falha."""
        try:
            nome = validar_nome(nome)
        except NomeInvalido as erro:
            raise AulaNaoEncontrada(nome) from erro
        caminho = (self.pasta / nome).resolve()
        if caminho.parent != self.pasta.resolve() or not caminho.is_file():
            raise AulaNaoEncontrada(nome)
        return caminho

    def formato(self, caminho: Path) -> dict[str, Any] | None:
        achado = self._formatos.obter(caminho)
        if achado is None:
            return None
        return achado.como_dict()

    def _resumo_transcricao(self, audio: Path) -> dict[str, Any] | None:
        if not motor.pronta(audio):
            return None
        marca = motor.pasta_de_saida(audio) / "segmentos.json"
        info = marca.stat()
        with self._trava:
            guardado = self._resumos.get(marca)
        if guardado and guardado[:2] == (info.st_mtime, info.st_size):
            return guardado[2]
        resumo = self._ler_resumo(audio, info.st_mtime)
        with self._trava:
            self._resumos[marca] = (info.st_mtime, info.st_size, resumo)
        return resumo

    def _ler_resumo(self, audio: Path, gerada_em: float) -> dict[str, Any] | None:
        try:
            dados = motor.ler_segmentos(audio)
        except (OSError, ValueError):
            return None
        segmentos = dados.get("segmentos", [])
        palavras = sum(len(s.get("texto", "").split()) for s in segmentos)
        inseguros = sum(1 for s in segmentos if s.get("logprob", 0) < motor.LOGPROB_INSEGURO)
        return {
            "idioma": dados.get("idioma"),
            "duracao": dados.get("duracao"),
            "palavras": palavras,
            "inseguros": inseguros,
            "gerada_em": gerada_em,
        }

    def listar(self, ocupados: dict[str, str]) -> list[dict[str, Any]]:
        if not self.pasta.is_dir():
            return []
        aulas = []
        for arquivo in sorted(self.pasta.iterdir(), key=lambda p: p.name.casefold()):
            if not arquivo.is_file() or not motor.eh_midia(arquivo):
                continue
            info = arquivo.stat()
            transcricao = self._resumo_transcricao(arquivo)
            estado = ocupados.get(arquivo.name) or ("transcrita" if transcricao else "pendente")
            formato = self.formato(arquivo)
            aulas.append(
                {
                    "nome": arquivo.name,
                    "titulo": arquivo.stem,
                    "tamanho": info.st_size,
                    "modificado": info.st_mtime,
                    "estado": estado,
                    "formato": formato,
                    "duracao": (transcricao or {}).get("duracao") or (formato or {}).get("duracao"),
                    "transcricao": transcricao,
                }
            )
        return aulas

    def transcricao(self, nome: str) -> dict[str, Any]:
        audio = self.caminho(nome)
        if not motor.pronta(audio):
            raise AulaNaoEncontrada(nome)
        dados = motor.ler_segmentos(audio)
        segmentos = [
            motor.Segmento(s["inicio"], s["fim"], s["texto"], s.get("logprob", 0.0))
            for s in dados.get("segmentos", [])
        ]
        return {
            "nome": audio.name,
            "titulo": audio.stem,
            "idioma": dados.get("idioma"),
            "duracao": dados.get("duracao"),
            "paragrafos": [asdict(p) for p in motor.agrupar(segmentos)],
        }

    def arquivo_de_saida(self, nome: str, tipo: str) -> Path:
        alvo = {"md": "transcricao.md", "srt": "legendas.srt", "json": "segmentos.json"}.get(tipo)
        if alvo is None:
            raise AulaNaoEncontrada(tipo)
        caminho = motor.pasta_de_saida(self.caminho(nome)) / alvo
        if not caminho.is_file():
            raise AulaNaoEncontrada(nome)
        return caminho
