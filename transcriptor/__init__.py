"""Transcriptor Class: transcrição local de aulas com Whisper."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("transcriptor-class")
except PackageNotFoundError:  # rodando direto do código, sem instalar
    __version__ = "0.0.0"
