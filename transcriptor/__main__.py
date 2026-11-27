"""Sobe o painel em http://127.0.0.1:<porta> e abre o navegador."""

from __future__ import annotations

import argparse
import logging
import socket
import sys
import threading
import webbrowser
from collections.abc import Sequence

import uvicorn

from transcriptor import config
from transcriptor.api import criar_app


def _porta_livre(porta: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as teste:
        return teste.connect_ex((config.HOST, porta)) != 0


def main(argv: Sequence[str] | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8", errors="replace")

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s", datefmt="%H:%M:%S"
    )
    cfg = config.carregar()
    cli = argparse.ArgumentParser(description="Painel do Transcriptor Class.")
    cli.add_argument("--sem-navegador", action="store_true", help="não abre o navegador")
    args = cli.parse_args(argv)

    endereco = f"http://{config.HOST}:{cfg.porta}"
    if not _porta_livre(cfg.porta):
        print(f"O painel já está aberto (ou a porta {cfg.porta} está ocupada): {endereco}")
        if not args.sem_navegador:
            webbrowser.open(endereco)
        return 0

    print(f"Transcriptor Class em {endereco}")
    print("Feche esta janela para encerrar. Transcrições em andamento serão interrompidas.")
    if not args.sem_navegador:
        threading.Timer(1.0, webbrowser.open, args=(endereco,)).start()
    uvicorn.run(
        criar_app(cfg),
        host=config.HOST,
        port=cfg.porta,
        log_level="warning",
        timeout_graceful_shutdown=3,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
