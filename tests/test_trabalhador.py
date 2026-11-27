import json
import queue
import socket

import pytest

from tests.falsos import ModeloFalso, fala
from transcriptor import __main__ as principal
from transcriptor import motor, trabalhador


@pytest.fixture
def pedido(tmp_path):
    audio = tmp_path / "aula.flac"
    audio.touch()
    return trabalhador.Pedido(audio, tmp_path / "modelo", 2, "pt", "ROAS")


def eventos_de(fila):
    saida = []
    while True:
        try:
            saida.append(fila.get_nowait())
        except queue.Empty:
            return saida


def test_trabalhador_relata_inicio_segmentos_e_fim(pedido, monkeypatch):
    modelo = ModeloFalso([fala(0, 2, " Oi."), fala(3, 5, " Tchau.")])
    monkeypatch.setattr(motor, "carregar_modelo", lambda caminho, threads: modelo)
    fila = queue.Queue()
    trabalhador.executar(pedido, fila)
    tipos = [e["tipo"] for e in eventos_de(fila)]
    assert tipos == ["carregando", "iniciado", "segmento", "segmento", "concluido"]
    assert motor.pronta(pedido.audio)
    assert modelo.chamadas[0][1]["hotwords"] == "Termos: ROAS."


def test_trabalhador_sem_modelo_relata_erro_legivel(pedido):
    fila = queue.Queue()
    trabalhador.executar(pedido, fila)
    ultimo = eventos_de(fila)[-1]
    assert ultimo["tipo"] == "erro" and "instalar.bat" in ultimo["mensagem"]


def test_trabalhador_com_midia_ruim_relata_erro(pedido, monkeypatch):
    modelo = ModeloFalso([], falhar_em=("aula",))
    monkeypatch.setattr(motor, "carregar_modelo", lambda caminho, threads: modelo)
    fila = queue.Queue()
    trabalhador.executar(pedido, fila)
    ultimo = eventos_de(fila)[-1]
    assert ultimo["tipo"] == "erro" and "midia invalida" in ultimo["mensagem"]
    assert not motor.pasta_de_saida(pedido.audio).exists()


def test_segmentos_json_e_o_marcador_de_conclusao(pedido, monkeypatch):
    monkeypatch.setattr(motor, "carregar_modelo", lambda c, t: ModeloFalso([fala(0, 1, " x")]))
    trabalhador.executar(pedido, queue.Queue())
    dados = json.loads((motor.pasta_de_saida(pedido.audio) / "segmentos.json").read_text("utf-8"))
    assert dados["arquivo"] == "aula.flac" and dados["segmentos"][0]["texto"] == "x"


def test_painel_ja_aberto_so_abre_o_navegador(monkeypatch, capsys):
    with socket.socket() as ocupada:
        ocupada.bind(("127.0.0.1", 0))
        ocupada.listen()
        porta = ocupada.getsockname()[1]
        monkeypatch.setenv("TRANSCRIPTOR_PORTA", str(porta))
        abertos = []
        monkeypatch.setattr(principal.webbrowser, "open", abertos.append)
        monkeypatch.setattr(principal.uvicorn, "run", lambda *a, **k: pytest.fail("subiu outro"))
        assert principal.main([]) == 0
    assert abertos == [f"http://127.0.0.1:{porta}"]
    assert "já está aberto" in capsys.readouterr().out


def test_decodificador_real_do_whisper_le_o_flac_exportado(tmp_path):
    # Regressão: com o PyAV 19 o faster-whisper quebrava ao abrir qualquer áudio.
    from faster_whisper.audio import decode_audio

    from tests.test_api import flac

    caminho = tmp_path / "aula.flac"
    caminho.write_bytes(flac(segundos=1.0, taxa=48_000, canais=2))
    amostras = decode_audio(str(caminho), sampling_rate=16_000)
    assert 15_000 < len(amostras) < 17_000  # 1 s convertido para 16 kHz mono
