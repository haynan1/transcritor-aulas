import json
import os

import pytest

from tests.falsos import ModeloFalso, fala
from transcriptor import cli
from transcriptor import motor as t


def S(inicio, fim, texto, logprob=0.0):
    return t.Segmento(inicio, fim, texto, logprob)


@pytest.mark.parametrize("s,esperado", [(0, "00:00:00"), (3661.9, "01:01:01"), (-1, "00:00:00")])
def test_relogio(s, esperado):
    assert t.relogio(s) == esperado


@pytest.mark.parametrize(
    "s,esperado",
    [
        (0, "00:00:00,000"),
        (59.9996, "00:01:00,000"),
        (3599.9999, "01:00:00,000"),
        (1.5, "00:00:01,500"),
    ],
)
def test_relogio_srt_arredonda_sem_estourar(s, esperado):
    assert t.relogio_srt(s) == esperado


def test_pausa_longa_abre_paragrafo():
    ps = t.agrupar([S(0, 1, "a."), S(1.5, 2, "b."), S(4, 5, "c.")])
    assert [p.texto for p in ps] == ["a. b.", "c."]
    assert (ps[1].inicio, ps[1].fim) == (4, 5)


def test_paragrafo_longo_so_quebra_em_fim_de_frase():
    meio, fim = "x" * 600, "y."
    ps = t.agrupar([S(0, 1, meio), S(1, 2, fim), S(2, 3, "z")])
    assert [p.texto for p in ps] == [f"{meio} {fim}", "z"]


def test_limite_quebra_mesmo_sem_pontuacao():
    assert len(t.agrupar([S(0, 1, "x" * 1000), S(1, 2, "y")])) == 2


def test_agrupar_ignora_vazios():
    assert t.agrupar([S(0, 1, "")]) == []


def test_md_marca_baixa_confianca():
    md = t.montar_md("Aula", 10, [S(0, 1, "ok."), S(5, 6, "hum", -1.5)])
    assert "`00:00:00` ok." in md
    assert "`00:00:05` **[conferir]** hum" in md


def test_md_sem_fala():
    assert "Nenhuma fala" in t.montar_md("Aula", 10, [])


def test_srt():
    assert t.montar_srt([S(0, 1.5, "oi")]) == "1\n00:00:00,000 --> 00:00:01,500\noi\n"


def test_coletar_filtra_pasta_e_remove_repetidos(tmp_path):
    for nome in ("b.MP3", "a.flac", "nota.txt"):
        (tmp_path / nome).touch()
    achados = t.coletar([tmp_path, tmp_path / "a.flac"])
    assert [a.name for a in achados] == ["a.flac", "b.MP3"]


def test_coletar_erros(tmp_path):
    (tmp_path / "n.txt").touch()
    for entrada in (tmp_path / "nao.mp3", tmp_path / "n.txt", tmp_path):
        with pytest.raises(t.ErroTranscricao):
            t.coletar([entrada])


def test_projeto_do_audacity_explica_como_exportar(tmp_path):
    projeto = tmp_path / "aula.AUP4"
    projeto.touch()
    with pytest.raises(t.ErroTranscricao, match="Exportar áudio"):
        t.coletar([projeto])


def test_saidas_de_extensoes_diferentes_nao_colidem(tmp_path):
    assert t.pasta_de_saida(tmp_path / "a.mp3") != t.pasta_de_saida(tmp_path / "a.mp4")


def test_transcrever_grava_tudo_e_relata_progresso(tmp_path):
    audio = tmp_path / "Aula ção.mp3"
    audio.touch()
    modelo = ModeloFalso([fala(0, 2, " Olá, coração.")])
    relatos = []
    saida = t.transcrever(modelo, audio, "pt", "ROAS", lambda s, d: relatos.append((s, d)))
    assert {p.name for p in saida.iterdir()} == set(t.ARQUIVOS_SAIDA)
    assert "Olá, coração." in (saida / "transcricao.md").read_text("utf-8")
    dados = json.loads((saida / "segmentos.json").read_text("utf-8"))
    assert dados["segmentos"][0]["texto"] == "Olá, coração."
    assert modelo.chamadas[0][1]["hotwords"] == "Termos: ROAS."
    assert relatos[0] == (None, 10.0)
    assert relatos[1][0].texto == "Olá, coração."
    assert t.pronta(audio)


def test_audio_regravado_volta_para_a_fila(tmp_path):
    audio = tmp_path / "a.mp3"
    audio.touch()
    t.transcrever(ModeloFalso([fala(0, 1, "x")]), audio, "pt", None)
    futuro = audio.stat().st_mtime + 1000
    os.utime(audio, (futuro, futuro))
    assert not t.pronta(audio)


def test_modelo_ausente_explica(tmp_path):
    with pytest.raises(t.ErroTranscricao, match=r"instalar\.bat"):
        t.carregar_modelo(tmp_path / "nada", 4)


# ---- linha de comando ----------------------------------------------------------------


@pytest.fixture
def modelo_falso(monkeypatch):
    def usar(modelo):
        monkeypatch.setattr(t, "carregar_modelo", lambda caminho, threads: modelo)
        return modelo

    return usar


def test_cli_falha_nao_derruba_a_fila(tmp_path, modelo_falso, capsys):
    for nome in ("a.mp3", "ruim.mp3", "z.mp3"):
        (tmp_path / nome).touch()
    modelo_falso(ModeloFalso([fala(0, 1, "x")], falhar_em=("ruim",)))
    assert cli.main([str(tmp_path)]) == 1
    assert "ruim.mp3" in capsys.readouterr().err
    assert t.pronta(tmp_path / "a.mp3") and t.pronta(tmp_path / "z.mp3")
    assert not t.pasta_de_saida(tmp_path / "ruim.mp3").exists()


def test_cli_segunda_rodada_pula_e_refazer_repete(tmp_path, modelo_falso):
    (tmp_path / "a.mp3").touch()
    modelo = modelo_falso(ModeloFalso([fala(0, 1, "x")]))
    for extra, total in ([], 1), ([], 1), (["--refazer"], 2):
        assert cli.main([str(tmp_path), *extra]) == 0
        assert len(modelo.chamadas) == total


def test_cli_modelo_ausente_explica(tmp_path, monkeypatch, capsys):
    (tmp_path / "a.mp3").touch()
    monkeypatch.setenv("TRANSCRIPTOR_MODELO", str(tmp_path / "nada"))
    assert cli.main([str(tmp_path)]) == 1
    assert "instalar.bat" in capsys.readouterr().err
