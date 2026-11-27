import io
import json
import math
import time
from array import array
from pathlib import Path

import av
import pytest
from fastapi.testclient import TestClient

from tests import falsos
from transcriptor.api import criar_app
from transcriptor.config import Config
from transcriptor.fila import Fila

PORTA = 7351
BASE = f"http://127.0.0.1:{PORTA}"
ESCRITA = {"x-transcriptor": "1"}


def flac(segundos=1.0, taxa=16_000, canais=1) -> bytes:
    """Um tom curto em FLAC, gerado na hora."""
    buffer = io.BytesIO()
    with av.open(buffer, "w", format="flac") as saida:
        faixa = saida.add_stream("flac", rate=taxa)
        faixa.layout = "mono" if canais == 1 else "stereo"
        amostras = int(segundos * taxa)
        onda = array(
            "h", (int(8000 * math.sin(2 * math.pi * 440 * n / taxa)) for n in range(amostras))
        )
        dados = array("h", (v for v in onda for _ in range(canais)))
        quadro = av.AudioFrame(format="s16", layout=faixa.layout.name, samples=amostras)
        quadro.planes[0].update(dados.tobytes())
        quadro.sample_rate = taxa
        for pacote in faixa.encode(quadro):
            saida.mux(pacote)
        for pacote in faixa.encode(None):
            saida.mux(pacote)
    return buffer.getvalue()


@pytest.fixture
def montar(tmp_path):
    clientes = []

    def montar(alvo=falsos.concluir):
        cfg = Config(
            gravacoes=tmp_path / "Gravações", modelo=tmp_path / "modelo", threads=1, porta=PORTA
        )
        fila = Fila(
            cfg.gravacoes,
            cfg.modelo,
            cfg.threads,
            alvo=alvo,
            arquivo_fila=cfg.gravacoes / ".transcriptor-fila.json",
        )
        cliente = TestClient(criar_app(cfg, fila=fila), base_url=BASE)
        cliente.__enter__()
        clientes.append(cliente)
        return cliente, cfg

    yield montar
    for cliente in clientes:
        cliente.__exit__(None, None, None)


def esperar(cliente, condicao, segundos=30):
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        estado = cliente.get("/api/estado").json()
        if condicao(estado):
            return estado
        time.sleep(0.1)
    raise AssertionError(f"tempo esgotado; último estado: {estado['fila']}")


def importar(cliente, nome="Modulo01_aula01.flac", conteudo=None, **params):
    return cliente.put(
        f"/api/aulas/{nome}", content=conteudo or flac(), headers=ESCRITA, params=params
    )


def estado_de(estado, arquivo):
    return next(t for t in estado["fila"]["trabalhos"] if t["arquivo"] == arquivo)


# ---- segurança -----------------------------------------------------------------------


def test_cabecalhos_de_seguranca_em_tudo(montar):
    cliente, _ = montar()
    for caminho in ("/api/config", "/", "/nao-existe"):
        resposta = cliente.get(caminho)
        assert "frame-ancestors 'none'" in resposta.headers["content-security-policy"]
        assert resposta.headers["x-content-type-options"] == "nosniff"


def test_host_desconhecido_e_recusado(montar):
    # Bloqueia DNS rebinding: um site malicioso apontando o próprio domínio para 127.0.0.1.
    cliente, _ = montar()
    assert cliente.get("/api/config", headers={"host": "malicioso.example"}).status_code == 400


@pytest.mark.parametrize(
    "cabecalhos",
    [
        {},
        {"x-transcriptor": "1", "sec-fetch-site": "cross-site"},
        {"x-transcriptor": "1", "origin": "https://malicioso.example"},
    ],
)
def test_escrita_de_outro_site_e_recusada(montar, cabecalhos):
    cliente, cfg = montar()
    resposta = cliente.put("/api/aulas/a.flac", content=flac(), headers=cabecalhos)
    assert resposta.status_code == 403
    assert not (cfg.gravacoes / "a.flac").exists()


def test_escrita_da_propria_origem_passa(montar):
    cliente, _ = montar()
    cabecalhos = {**ESCRITA, "origin": BASE, "sec-fetch-site": "same-origin"}
    resposta = cliente.put("/api/aulas/a.flac", content=flac(), headers=cabecalhos)
    assert resposta.status_code == 201


@pytest.mark.parametrize(
    "nome",
    [
        "..%2F..%2Fx.flac",
        "..%5Cx.flac",
        "CON.flac",
        "nota.txt",
        ".oculto.flac",
        "a%3Ab.flac",
        "a&b.flac",
        "a%3Cscript%3E.flac",
    ],
)
def test_nomes_perigosos_sao_recusados(montar, nome):
    cliente, cfg = montar()
    resposta = cliente.put(f"/api/aulas/{nome}", content=flac(), headers=ESCRITA)
    # 405 quando a barra decodificada tira a URL da rota da API: recusado do mesmo jeito.
    assert resposta.status_code in (404, 405, 422)
    assert list(cfg.gravacoes.iterdir()) == []


def test_leitura_fora_da_pasta_nao_vaza(montar, tmp_path):
    cliente, _ = montar()
    (tmp_path / "segredo.flac").write_bytes(flac())
    for caminho in ("/api/aulas/..%5Csegredo.flac/audio", "/api/aulas/..%2Fsegredo.flac/audio"):
        assert cliente.get(caminho).status_code == 404


# ---- importar ------------------------------------------------------------------------


def test_importar_grava_analisa_e_transcreve(montar):
    cliente, cfg = montar()
    resposta = importar(cliente, termos="ROAS")
    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["formato"]["recomendado"] is True
    assert corpo["formato"]["codec"] == "flac"
    assert (cfg.gravacoes / "Modulo01_aula01.flac").is_file()

    estado = esperar(
        cliente, lambda e: estado_de(e, "Modulo01_aula01.flac")["estado"] == "concluido"
    )
    trabalho = estado_de(estado, "Modulo01_aula01.flac")
    assert trabalho["progresso"] == 1.0 and trabalho["segmentos"] == 2

    aula = cliente.get("/api/aulas").json()[0]
    assert aula["estado"] == "transcrita"
    assert aula["transcricao"]["palavras"] == 4

    texto = cliente.get("/api/aulas/Modulo01_aula01.flac/transcricao").json()
    assert [p["texto"] for p in texto["paragrafos"]] == ["Primeira frase.", "Segunda frase."]

    srt = cliente.get("/api/aulas/Modulo01_aula01.flac/arquivos/srt")
    assert srt.status_code == 200 and "Segunda frase." in srt.text
    assert "attachment" in srt.headers["content-disposition"]


def test_importar_sem_transcrever_deixa_pendente(montar):
    cliente, _ = montar()
    corpo = importar(cliente, transcrever="false").json()
    assert corpo["trabalho"] is None
    assert cliente.get("/api/aulas").json()[0]["estado"] == "pendente"


def test_formato_fora_do_recomendado_avisa_sem_bloquear(montar):
    cliente, _ = montar()
    corpo = importar(cliente, conteudo=flac(taxa=48_000, canais=2), transcrever="false").json()
    assert corpo["formato"]["recomendado"] is False
    assert len(corpo["formato"]["avisos"]) == 2


def test_importar_nome_repetido_nao_sobrescreve(montar):
    cliente, cfg = montar()
    importar(cliente, transcrever="false")
    original = (cfg.gravacoes / "Modulo01_aula01.flac").read_bytes()
    assert importar(cliente, conteudo=flac(segundos=2)).status_code == 409
    assert (cfg.gravacoes / "Modulo01_aula01.flac").read_bytes() == original


def test_arquivo_que_nao_e_audio_e_recusado_sem_deixar_lixo(montar):
    cliente, cfg = montar()
    resposta = importar(cliente, "aula.mp3", conteudo=b"isto nao e audio" * 100)
    assert resposta.status_code == 422
    assert list(cfg.gravacoes.iterdir()) == []


def test_arquivo_vazio_e_recusado(montar):
    cliente, _ = montar()
    resposta = cliente.put("/api/aulas/a.flac", content=b"", headers=ESCRITA)
    assert resposta.status_code == 422


# ---- fila ----------------------------------------------------------------------------


def test_mesma_aula_nao_entra_duas_vezes(montar):
    cliente, _ = montar(alvo=falsos.demorar)
    importar(cliente)
    resposta = cliente.post(
        "/api/trabalhos", json={"arquivo": "Modulo01_aula01.flac"}, headers=ESCRITA
    )
    assert resposta.status_code == 409


def test_cancelar_interrompe_e_a_fila_segue(montar):
    cliente, _ = montar(alvo=falsos.demorar)
    primeiro = importar(cliente, "a.flac").json()["trabalho"]["id"]
    importar(cliente, "b.flac")
    estado = esperar(cliente, lambda e: estado_de(e, "a.flac")["segmentos"] > 5)
    em_andamento = estado_de(estado, "a.flac")
    assert em_andamento["estado"] == "transcrevendo"
    assert cliente.get("/api/aulas").json()[0]["estado"] == "transcrevendo"

    assert cliente.delete(f"/api/trabalhos/{primeiro}", headers=ESCRITA).status_code == 204
    estado = esperar(cliente, lambda e: estado_de(e, "b.flac")["estado"] == "transcrevendo")
    assert estado_de(estado, "a.flac")["estado"] == "cancelado"

    vivos = cliente.get(f"/api/trabalhos/{estado_de(estado, 'b.flac')['id']}/segmentos").json()
    assert vivos["segmentos"][0]["texto"] == "t0"


def test_estimativa_de_tempo_restante(montar):
    cliente, _ = montar(alvo=falsos.demorar)
    importar(cliente)
    # A estimativa só aparece depois de alguns segundos medindo a velocidade real.
    estado = esperar(cliente, lambda e: estado_de(e, "Modulo01_aula01.flac")["velocidade"])
    trabalho = estado_de(estado, "Modulo01_aula01.flac")
    assert trabalho["restante"] > 0 and not trabalho["restante_estimado"]
    assert estado["fila"]["restante_total"] >= trabalho["restante"]


def test_erro_do_modelo_aparece_no_trabalho(montar):
    cliente, _ = montar(alvo=falsos.falhar)
    importar(cliente)
    estado = esperar(cliente, lambda e: estado_de(e, "Modulo01_aula01.flac")["estado"] == "erro")
    assert "teste" in estado_de(estado, "Modulo01_aula01.flac")["erro"]


def test_processo_que_morre_vira_erro_e_nao_trava_a_fila(montar):
    cliente, _ = montar(alvo=falsos.morrer)
    importar(cliente, "a.flac")
    importar(cliente, "b.flac")
    estado = esperar(cliente, lambda e: all(t["estado"] == "erro" for t in e["fila"]["trabalhos"]))
    assert "inesperadamente" in estado_de(estado, "a.flac")["erro"]


def test_limpar_historico(montar):
    cliente, _ = montar(alvo=falsos.falhar)
    importar(cliente)
    esperar(cliente, lambda e: estado_de(e, "Modulo01_aula01.flac")["estado"] == "erro")
    assert cliente.delete("/api/historico", headers=ESCRITA).status_code == 204
    assert cliente.get("/api/estado").json()["fila"]["trabalhos"] == []


# ---- leitura -------------------------------------------------------------------------


def test_audio_aceita_trecho_para_o_player_pular(montar):
    cliente, _ = montar()
    importar(cliente, transcrever="false")
    resposta = cliente.get("/api/aulas/Modulo01_aula01.flac/audio", headers={"range": "bytes=0-99"})
    assert resposta.status_code == 206 and len(resposta.content) == 100


def test_transcricao_inexistente_da_404(montar):
    cliente, _ = montar()
    importar(cliente, transcrever="false")
    assert cliente.get("/api/aulas/Modulo01_aula01.flac/transcricao").status_code == 404
    assert cliente.get("/api/aulas/nada.flac/transcricao").status_code == 404


def test_estado_traz_cpu_e_memoria(montar):
    cliente, _ = montar()
    time.sleep(1.2)
    sistema = cliente.get("/api/estado").json()["sistema"]
    assert sistema["nucleos"] >= 1 and len(sistema["por_nucleo"]) == sistema["nucleos"]
    assert 0 <= sistema["cpu"] <= 100 and sistema["memoria_total"] > 0


def test_saude_aponta_modelo_ausente(montar):
    cliente, _ = montar()
    resposta = cliente.get("/api/saude")
    assert resposta.status_code == 503 and resposta.json()["modelo"] is False


def test_interface_e_servida(montar):
    cliente, _ = montar()
    resposta = cliente.get("/")
    assert resposta.status_code == 200 and "Transcriptor Class" in resposta.text


def test_aulas_lista_so_midia_em_ordem(montar):
    cliente, cfg = montar()
    importar(cliente, "b.flac", transcrever="false")
    importar(cliente, "A.flac", transcrever="false")
    Path(cfg.gravacoes / "notas.txt").write_text("x")
    assert [a["nome"] for a in cliente.get("/api/aulas").json()] == ["A.flac", "b.flac"]


# ---- resiliência ---------------------------------------------------------------------


def test_fila_sobrevive_a_reinicio_do_painel(montar, tmp_path):
    cliente, cfg = montar(alvo=falsos.demorar)
    importar(cliente, "a.flac")
    importar(cliente, "b.flac")
    esperar(cliente, lambda e: estado_de(e, "a.flac")["estado"] == "transcrevendo")
    cliente.__exit__(None, None, None)  # derruba o painel no meio da transcrição

    salvos = (cfg.gravacoes / ".transcriptor-fila.json").read_text("utf-8")
    assert '"a.flac"' in salvos and '"b.flac"' in salvos

    novo, _ = montar(alvo=falsos.concluir)
    estado = esperar(
        novo,
        lambda e: (
            all(t["estado"] == "concluido" for t in e["fila"]["trabalhos"])
            and len(e["fila"]["trabalhos"]) == 2
        ),
    )
    assert [t["arquivo"] for t in estado["fila"]["trabalhos"]] == ["a.flac", "b.flac"]
    assert (cfg.gravacoes / ".transcriptor-fila.json").read_text("utf-8") == "[]"


def test_disco_cheio_recusa_antes_de_gravar(montar, monkeypatch):
    cliente, cfg = montar()
    monkeypatch.setattr(
        "transcriptor.api.shutil.disk_usage", lambda _: type("U", (), {"free": 1024})()
    )
    assert importar(cliente).status_code == 507
    assert list(cfg.gravacoes.iterdir()) == []


def test_temporarios_de_envio_interrompido_sao_limpos(tmp_path):
    pasta = tmp_path / "Gravações"
    pasta.mkdir()
    (pasta / ".abc.part").write_bytes(b"pela metade")
    cfg = Config(gravacoes=pasta, modelo=tmp_path / "modelo", threads=1, porta=PORTA)
    with TestClient(
        criar_app(cfg, fila=Fila(pasta, cfg.modelo, 1, alvo=falsos.concluir)), base_url=BASE
    ):
        assert not (pasta / ".abc.part").exists()


def test_segmentos_vem_em_lotes(montar):
    cliente, _ = montar(alvo=falsos.demorar)
    id_ = importar(cliente).json()["trabalho"]["id"]
    esperar(cliente, lambda e: e["fila"]["trabalhos"][0]["segmentos"] >= 10)
    lote = cliente.get(f"/api/trabalhos/{id_}/segmentos", params={"desde": 2, "limite": 3}).json()
    assert [s["texto"] for s in lote["segmentos"]] == ["t2", "t3", "t4"]


def test_eventos_ao_vivo_entregam_o_estado(montar):
    cliente, _ = montar()
    with cliente.stream("GET", "/api/eventos") as resposta:
        assert resposta.headers["content-type"].startswith("text/event-stream")
        linhas = resposta.iter_lines()
        for linha in linhas:
            if linha.startswith("data: "):
                pacote = json.loads(linha.removeprefix("data: "))
                break
    assert set(pacote) == {"fila", "sistema"}
    assert "trabalhos" in pacote["fila"] and "cpu" in pacote["sistema"]
