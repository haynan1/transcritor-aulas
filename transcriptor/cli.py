"""Linha de comando: transcreve arquivos ou pastas, um de cada vez, mostrando o andamento."""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from transcriptor import config, motor


def _mostrar_progresso(seg: motor.Segmento | None, duracao: float) -> None:
    if seg is None:
        return
    feito = min(100, seg.fim / duracao * 100) if duracao else 100
    print(
        f"\r  {feito:3.0f}%  {motor.relogio(seg.fim)} de {motor.relogio(duracao)}",
        end="",
        flush=True,
    )


def main(argv: Sequence[str] | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8", errors="replace")

    ajustes = config.carregar()
    cli = argparse.ArgumentParser(description="Transcreve aulas localmente.")
    cli.add_argument("entradas", nargs="+", type=Path, help="arquivos ou pastas")
    cli.add_argument("--idioma", default="pt", help="pt, en, es... ou auto (padrão: pt)")
    cli.add_argument("--termos", help="nomes e jargões do curso, separados por vírgula")
    cli.add_argument("--refazer", action="store_true", help="transcreve mesmo se já estiver pronto")
    cli.add_argument("--threads", type=int, default=ajustes.threads, help="núcleos usados")
    args = cli.parse_args(argv)

    try:
        arquivos = motor.coletar(args.entradas)
        pendentes = [a for a in arquivos if args.refazer or not motor.pronta(a)]
        for feito in (a for a in arquivos if a not in pendentes):
            print(f"Já transcrito, pulando: {feito.name}")
        if not pendentes:
            return 0
        print("Carregando o modelo...")
        modelo = motor.carregar_modelo(ajustes.modelo, args.threads)
    except motor.ErroTranscricao as erro:
        print(f"Erro: {erro}", file=sys.stderr)
        return 1

    idioma = None if args.idioma == "auto" else args.idioma
    falhas = 0
    for n, audio in enumerate(pendentes, 1):
        print(f"[{n}/{len(pendentes)}] {audio.name}")
        inicio = time.monotonic()
        try:
            saida = motor.transcrever(modelo, audio, idioma, args.termos, _mostrar_progresso)
            print(f"\n  Pronto em {motor.relogio(time.monotonic() - inicio)}\n  {saida}")
        except (motor.ErroTranscricao, OSError) as erro:
            # Um arquivo ruim não derruba o resto da fila.
            falhas += 1
            print(f"\n  Erro em {audio.name}: {erro}", file=sys.stderr)
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
