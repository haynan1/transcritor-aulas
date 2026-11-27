"""Servidor HTTP: API JSON, eventos em tempo real (SSE) e a interface estática."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, MutableMapping
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import anyio
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import ClientDisconnect

from transcriptor import __version__, midia, motor
from transcriptor.biblioteca import AulaNaoEncontrada, Biblioteca, NomeInvalido, validar_nome
from transcriptor.config import Config
from transcriptor.fila import Fila, JaNaFila
from transcriptor.sistema import Monitor

log = logging.getLogger(__name__)

WEB = Path(__file__).resolve().parent.parent / "web"
ARQUIVO_FILA = ".transcriptor-fila.json"
FOLGA_DE_DISCO = 512 * 1024**2  # nunca deixa o disco com menos de 512 MB livres
LIMITE_UPLOAD = 4 * 1024**3  # 4 GiB: duas horas em WAV estéreo de 48 kHz ainda cabem
INTERVALO_EVENTOS_S = 1.0
CABECALHO_CSRF = "x-transcriptor"

CABECALHOS_SEGURANCA = {
    "content-security-policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "x-frame-options": "DENY",
}

Escopo = MutableMapping[str, Any]
Receber = Callable[[], Awaitable[MutableMapping[str, Any]]]
Enviar = Callable[[MutableMapping[str, Any]], Awaitable[None]]
App = Callable[[Escopo, Receber, Enviar], Awaitable[None]]


class Seguranca:
    """Cabeçalhos de segurança em toda resposta e bloqueio de escrita vinda de outro site.

    O servidor só escuta em 127.0.0.1, mas qualquer página aberta no navegador consegue
    disparar requisições para lá. Toda escrita exige um cabeçalho próprio (que força
    preflight de CORS, nunca aprovado) e origem igual à do painel.
    """

    def __init__(self, app: App, porta: int) -> None:
        self.app = app
        self.origens = {f"http://127.0.0.1:{porta}", f"http://localhost:{porta}"}

    def _escrita_permitida(self, cabecalhos: Headers) -> bool:
        if cabecalhos.get(CABECALHO_CSRF) != "1":
            return False
        site = cabecalhos.get("sec-fetch-site")
        if site is not None and site not in ("same-origin", "none"):
            return False
        origem = cabecalhos.get("origin")
        return origem is None or origem in self.origens

    async def __call__(self, scope: Escopo, receive: Receber, send: Enviar) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        estatico = not str(scope["path"]).startswith("/api/")

        async def enviar(mensagem: MutableMapping[str, Any]) -> None:
            if mensagem["type"] == "http.response.start":
                cabecalhos = MutableHeaders(scope=mensagem)
                for nome, valor in CABECALHOS_SEGURANCA.items():
                    cabecalhos[nome] = valor
                if estatico:
                    # Local e barato: sempre revalida, para nunca servir interface velha.
                    cabecalhos["cache-control"] = "no-cache"
            await send(mensagem)

        if scope["method"] not in ("GET", "HEAD") and not self._escrita_permitida(
            Headers(scope=scope)
        ):
            resposta = JSONResponse({"detail": "Requisição de origem não permitida."}, 403)
            await resposta(scope, receive, enviar)
            return
        await self.app(scope, receive, enviar)


class NovoTrabalho(BaseModel):
    arquivo: str = Field(min_length=1, max_length=150)
    idioma: str = Field(default="pt", pattern=r"^(auto|[a-z]{2,3})$")
    termos: str | None = Field(default=None, max_length=500)


def _idioma(valor: str) -> str | None:
    return None if valor == "auto" else valor


def _termos(valor: str | None) -> str | None:
    valor = (valor or "").strip()
    return valor or None


def criar_app(cfg: Config, fila: Fila | None = None, monitor: Monitor | None = None) -> FastAPI:
    biblioteca = Biblioteca(cfg.gravacoes)
    fila = fila or Fila(
        cfg.gravacoes, cfg.modelo, cfg.threads, arquivo_fila=cfg.gravacoes / ARQUIVO_FILA
    )
    monitor = monitor or Monitor(lambda: fila.instantaneo()["pid"])

    @asynccontextmanager
    async def ciclo(_: FastAPI) -> AsyncIterator[None]:
        cfg.gravacoes.mkdir(parents=True, exist_ok=True)
        # Envios interrompidos por queda do painel deixam temporários para trás.
        for sobra in cfg.gravacoes.glob(".*.part"):
            sobra.unlink(missing_ok=True)
        fila.iniciar()
        monitor.iniciar()
        try:
            yield
        finally:
            fila.encerrar()
            monitor.encerrar()

    app = FastAPI(
        title="Transcriptor Class",
        version=__version__,
        lifespan=ciclo,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    def duracao_de(caminho: Path) -> float:
        formato = biblioteca.formato(caminho)
        return float(formato["duracao"]) if formato else 0.0

    def enfileirar(caminho: Path, idioma: str, termos: str | None) -> dict[str, Any]:
        try:
            trabalho = fila.adicionar(
                caminho.name, _idioma(idioma), _termos(termos), duracao_de(caminho)
            )
        except JaNaFila as erro:
            raise HTTPException(409, f"{caminho.name} já está na fila.") from erro
        return {"id": trabalho.id, "arquivo": trabalho.arquivo}

    def estado() -> dict[str, Any]:
        return {"fila": fila.instantaneo(), "sistema": monitor.instantaneo()}

    # ---- leitura ---------------------------------------------------------------------

    @app.get("/api/saude")
    def saude() -> JSONResponse:
        verificacoes = {
            "modelo": (cfg.modelo / "model.bin").is_file(),
            "gravacoes": cfg.gravacoes.is_dir() and os.access(cfg.gravacoes, os.W_OK),
        }
        ok = all(verificacoes.values())
        return JSONResponse({"ok": ok, **verificacoes}, 200 if ok else 503)

    @app.get("/api/config")
    def configuracao() -> dict[str, Any]:
        return {
            "versao": __version__,
            "gravacoes": str(cfg.gravacoes),
            "modelo": cfg.modelo.name,
            "modelo_presente": (cfg.modelo / "model.bin").is_file(),
            "threads": cfg.threads,
            "extensoes": sorted(motor.EXTENSOES),
            "limite_upload": LIMITE_UPLOAD,
            "recomendado": {
                "codec": midia.CODEC_IDEAL,
                "taxa": midia.TAXA_IDEAL,
                "canais": midia.CANAIS_IDEAL,
            },
        }

    @app.get("/api/estado")
    def estado_atual() -> dict[str, Any]:
        return estado()

    @app.get("/api/eventos")
    async def eventos(request: Request) -> StreamingResponse:
        async def gerar() -> AsyncIterator[str]:
            yield "retry: 2000\n\n"
            while not await request.is_disconnected():
                dados = await anyio.to_thread.run_sync(estado)
                yield f"event: estado\ndata: {json.dumps(dados, ensure_ascii=False)}\n\n"
                await asyncio.sleep(INTERVALO_EVENTOS_S)

        return StreamingResponse(
            gerar(),
            media_type="text/event-stream",
            headers={"cache-control": "no-store", "x-accel-buffering": "no"},
        )

    @app.get("/api/aulas")
    def aulas() -> list[dict[str, Any]]:
        return biblioteca.listar(fila.arquivos_ocupados())

    @app.get("/api/aulas/{nome}/transcricao")
    def transcricao(nome: str) -> dict[str, Any]:
        try:
            return biblioteca.transcricao(nome)
        except AulaNaoEncontrada as erro:
            raise HTTPException(404, "Transcrição não encontrada.") from erro

    @app.get("/api/aulas/{nome}/audio")
    def audio(nome: str) -> FileResponse:
        try:
            return FileResponse(biblioteca.caminho(nome))
        except AulaNaoEncontrada as erro:
            raise HTTPException(404, "Aula não encontrada.") from erro

    @app.get("/api/aulas/{nome}/arquivos/{tipo}")
    def baixar(nome: str, tipo: str) -> FileResponse:
        try:
            caminho = biblioteca.arquivo_de_saida(nome, tipo)
        except AulaNaoEncontrada as erro:
            raise HTTPException(404, "Arquivo não encontrado.") from erro
        return FileResponse(caminho, filename=f"{Path(nome).stem} - {caminho.name}")

    @app.get("/api/trabalhos/{id_}/segmentos")
    def segmentos(
        id_: str,
        desde: Annotated[int, Query(ge=0)] = 0,
        limite: Annotated[int, Query(ge=1, le=2000)] = 1000,
    ) -> dict[str, Any]:
        achados = fila.segmentos(id_, desde, limite)
        if achados is None:
            raise HTTPException(404, "Trabalho não encontrado.")
        return {"desde": desde, "segmentos": achados}

    # ---- escrita ---------------------------------------------------------------------

    @app.put("/api/aulas/{nome}", status_code=201)
    async def importar(
        nome: str,
        request: Request,
        transcrever: bool = True,
        idioma: Annotated[str, Query(pattern=r"^(auto|[a-z]{2,3})$")] = "pt",
        termos: Annotated[str | None, Query(max_length=500)] = None,
    ) -> dict[str, Any]:
        try:
            nome = validar_nome(nome)
        except NomeInvalido as erro:
            raise HTTPException(422, str(erro)) from erro
        destino = cfg.gravacoes / nome
        if destino.exists():
            raise HTTPException(409, f"Já existe uma aula chamada {nome}. Renomeie antes.")
        declarado = request.headers.get("content-length")
        if declarado is None or not declarado.isdigit():
            raise HTTPException(411, "Envie o tamanho do arquivo.")
        if int(declarado) > LIMITE_UPLOAD:
            raise HTTPException(413, "O arquivo passa de 4 GB.")
        if int(declarado) == 0:
            raise HTTPException(422, "O arquivo está vazio.")
        livre = shutil.disk_usage(cfg.gravacoes).free
        if int(declarado) + FOLGA_DE_DISCO > livre:
            raise HTTPException(507, "Não há espaço livre no disco para esta gravação.")

        temporario = cfg.gravacoes / f".{uuid.uuid4().hex}.part"
        recebido = 0
        try:
            with temporario.open("wb") as saida:
                async for pedaco in request.stream():
                    recebido += len(pedaco)
                    if recebido > int(declarado):
                        raise HTTPException(400, "O envio passou do tamanho declarado.")
                    await anyio.to_thread.run_sync(saida.write, pedaco)
            if recebido != int(declarado):
                raise HTTPException(400, "O envio foi interrompido. Tente de novo.")
            try:
                formato = await anyio.to_thread.run_sync(midia.sondar, temporario)
            except ValueError as erro:
                raise HTTPException(422, f"Isso não parece um áudio válido: {erro}") from erro
            try:
                # rename falha se o destino existir no Windows: evita sobrescrever numa corrida.
                temporario.rename(destino)
            except FileExistsError as erro:
                raise HTTPException(409, f"Já existe uma aula chamada {nome}.") from erro
        except ClientDisconnect as erro:
            raise HTTPException(400, "O envio foi interrompido.") from erro
        finally:
            temporario.unlink(missing_ok=True)

        log.info("Importada: %s (%s, %.0f s)", nome, formato.codec, formato.duracao)
        trabalho = enfileirar(destino, idioma, termos) if transcrever else None
        return {
            "aula": nome,
            "formato": formato.como_dict(),
            "trabalho": trabalho,
        }

    @app.post("/api/trabalhos", status_code=201)
    def novo_trabalho(pedido: NovoTrabalho) -> dict[str, Any]:
        try:
            caminho = biblioteca.caminho(pedido.arquivo)
        except AulaNaoEncontrada as erro:
            raise HTTPException(404, "Aula não encontrada.") from erro
        return enfileirar(caminho, pedido.idioma, pedido.termos)

    @app.delete("/api/trabalhos/{id_}", status_code=204)
    def cancelar(id_: str) -> Response:
        if not fila.cancelar(id_):
            raise HTTPException(404, "Nada para cancelar.")
        return Response(status_code=204)

    @app.delete("/api/historico", status_code=204)
    def limpar_historico() -> Response:
        fila.limpar_historico()
        return Response(status_code=204)

    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    app.add_middleware(Seguranca, porta=cfg.porta)
    return app
