#!/usr/bin/env python3
"""Coletor METAR de SBJR para o dashboard Jacaré Cloud.

Consultas: disparadas por systemd timer (ver ../systemd/jacare-metar.timer).
Biblioteca padrão apenas — sem dependências externas.

Saída: um único JSON público com a última observação válida. Falhas de coleta
preservam a última observação boa e são registradas em stderr (journald).
Nenhum detalhe interno (caminhos, host, IP, stack trace) vai para o JSON.
"""

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

API_URL = "https://aviationweather.gov/api/data/metar?ids={estacao}&format=json"
FUSO_LOCAL = ZoneInfo("America/Sao_Paulo")
ESQUEMA = 1
NOME_FONTE = "Aviation Weather Center (NOAA/NWS)"
NOME_ESTACAO = "Jacarepaguá — SBJR"

# Uma observação METAR de SBJR é horária. Acima disso a interface marca como
# desatualizada; o limite aqui serve para registrar o aviso na coleta.
LIMIAR_IDADE_MIN = 90
ESPERA_MAX_S = 20
AGENTE = "JacareCloudDashboard/1.0 (monitoramento METAR)"


class ErroColeta(Exception):
    """Falha de coleta com mensagem pública e neutra."""

    def __init__(self, mensagem):
        super().__init__(mensagem)
        self.mensagem = mensagem


# --------------------------------------------------------------------------
# utilidades de tempo
# --------------------------------------------------------------------------

def agora_utc():
    return datetime.now(timezone.utc)


def iso_utc(momento):
    return momento.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_brt(momento):
    return momento.astimezone(FUSO_LOCAL).isoformat(timespec="seconds")


def idade_minutos(observado, referencia):
    return int(round((referencia - observado).total_seconds() / 60.0))


# --------------------------------------------------------------------------
# leitura da API
# --------------------------------------------------------------------------

def baixar_json(url, espera=ESPERA_MAX_S):
    requisicao = urllib.request.Request(url, headers={
        "User-Agent": AGENTE,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(requisicao, timeout=espera) as resposta:
            if resposta.status != 200:
                raise ErroColeta("fonte respondeu com erro")
            corpo = resposta.read()
    except urllib.error.HTTPError:
        raise ErroColeta("fonte respondeu com erro")
    except urllib.error.URLError:
        raise ErroColeta("fonte inacessível")
    except TimeoutError:
        raise ErroColeta("fonte não respondeu no prazo")
    except OSError:
        raise ErroColeta("falha de rede na coleta")

    try:
        return json.loads(corpo.decode("utf-8", "replace"))
    except ValueError:
        raise ErroColeta("resposta da fonte não é JSON válido")


# --------------------------------------------------------------------------
# interpretação do METAR bruto (fallback quando a API traz campos incompletos)
# --------------------------------------------------------------------------

RE_HORA = re.compile(r"^\d{6}Z$")
RE_VENTO = re.compile(r"^(?P<dir>\d{3}|VRB)(?P<vel>\d{2,3})(G(?P<raj>\d{2,3}))?(?P<uni>KT|MPS)$")
RE_NUVEM = re.compile(r"^(?P<cob>FEW|SCT|BKN|OVC|VV|NSC|NCD)(?P<base>\d{3})?(?P<tipo>CB|TCU)?$")
RE_TEMP = re.compile(r"^(?P<t>M?\d{2})/(?P<d>M?\d{2})?$")
RE_QNH = re.compile(r"^Q(?P<q>\d{3,4})$")
RE_QNH_POL = re.compile(r"^A(?P<q>\d{4})$")
RE_VIS_METROS = re.compile(r"^\d{4}$")
RE_VIS_MILHAS = re.compile(r"^\d{1,2}(/\d{1,2})?SM$|^M?\d{1,2}/\d{1,2}SM$|^P\dSM$")
RE_FENOMENO = re.compile(
    r"^([+-]|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ|RA|DZ|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$"
)


def _num(texto):
    if texto is None:
        return None
    texto = str(texto).strip()
    if texto == "":
        return None
    if texto.startswith("M"):
        return -int(texto[1:])
    try:
        return int(texto)
    except ValueError:
        try:
            return float(texto)
        except ValueError:
            return None


def ler_bruto(texto):
    """Extrai campos do METAR bruto. Retorna dict parcial, nunca levanta exceção."""
    dados = {"visibilidade": {}, "vento": {}, "nuvens": [], "fenomenos": []}
    if not texto:
        return dados

    tokens = texto.replace("=", " ").split()
    if not tokens:
        return dados

    # descarta o prefixo METAR/SPECI
    resto = tokens[1:] if tokens[0] in ("METAR", "SPECI") else tokens

    lendo_tempo = False
    for token in resto:
        if token in ("AUTO", "COR", "NIL", "RMK", "BECMG", "TEMPO"):
            if token == "RMK":
                break
            continue

        if not lendo_tempo and RE_HORA.match(token):
            lendo_tempo = True
            continue

        if token == "CAVOK":
            dados["visibilidade"] = {"cavok": True, "metros": 10000}
            continue

        casamento = RE_VENTO.match(token)
        if casamento and "velocidade_kt" not in dados["vento"]:
            unidade = casamento.group("uni")
            velocidade = int(casamento.group("vel"))
            rajada = int(casamento.group("raj")) if casamento.group("raj") else None
            if unidade == "MPS":
                velocidade = int(round(velocidade * 1.94384))
                rajada = int(round(rajada * 1.94384)) if rajada else None
            direcao = casamento.group("dir")
            dados["vento"] = {
                "direcao_variavel": direcao == "VRB",
                "direcao_graus": None if direcao == "VRB" else int(direcao),
                "velocidade_kt": velocidade,
                "rajada_kt": rajada,
                "calmo": velocidade == 0,
            }
            continue

        if "metros" not in dados["visibilidade"] and RE_VIS_METROS.match(token) and lendo_tempo:
            dados["visibilidade"]["metros"] = int(token)
            continue

        if RE_VIS_MILHAS.match(token):
            dados["visibilidade"]["milhas"] = token.replace("SM", "")
            continue

        casamento = RE_NUVEM.match(token)
        if casamento:
            base = casamento.group("base")
            dados["nuvens"].append({
                "cobertura": casamento.group("cob"),
                "base_ft": int(base) * 100 if base else None,
                "tipo": casamento.group("tipo"),
            })
            continue

        casamento = RE_TEMP.match(token)
        if casamento and "temperatura_c" not in dados:
            dados["temperatura_c"] = _num(casamento.group("t"))
            dados["ponto_orvalho_c"] = _num(casamento.group("d"))
            continue

        casamento = RE_QNH.match(token)
        if casamento:
            dados["qnh_hpa"] = int(casamento.group("q"))
            continue

        casamento = RE_QNH_POL.match(token)
        if casamento:
            dados["qnh_hpa"] = int(round(int(casamento.group("q")) * 0.338639))
            continue

        if RE_FENOMENO.match(token):
            dados["fenomenos"].append(token)

    return dados


# --------------------------------------------------------------------------
# montagem do documento público
# --------------------------------------------------------------------------

def montar_observacao(registro):
    """Converte um item da API no bloco `observacao` do JSON público."""
    if not isinstance(registro, dict):
        raise ErroColeta("resposta da fonte em formato inesperado")

    bruto = (registro.get("rawOb") or "").strip()
    if not bruto:
        raise ErroColeta("resposta sem observação METAR")

    momento = None
    if registro.get("obsTime") is not None:
        try:
            momento = datetime.fromtimestamp(int(registro["obsTime"]), tz=timezone.utc)
        except (ValueError, TypeError, OSError):
            momento = None
    if momento is None and registro.get("reportTime"):
        try:
            momento = datetime.strptime(
                str(registro["reportTime"])[:19], "%Y-%m-%dT%H:%M:%S"
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            momento = None
    if momento is None:
        raise ErroColeta("observação sem horário válido")

    ler = ler_bruto(bruto)

    vento = dict(ler.get("vento") or {})
    if registro.get("wspd") is not None:
        direcao = registro.get("wdir")
        variavel = isinstance(direcao, str) and direcao.upper() == "VRB"
        vento.update({
            "direcao_variavel": variavel,
            "direcao_graus": None if variavel or direcao is None else int(direcao),
            "velocidade_kt": int(registro.get("wspd") or 0),
            "rajada_kt": int(registro["wgst"]) if registro.get("wgst") not in (None, "") else None,
            "calmo": int(registro.get("wspd") or 0) == 0,
        })
    if not vento:
        vento = {"direcao_variavel": False, "direcao_graus": None,
                 "velocidade_kt": None, "rajada_kt": None, "calmo": False}

    visibilidade = dict(ler.get("visibilidade") or {})
    if visibilidade.get("metros") is None and registro.get("visib") is not None:
        visibilidade["milhas"] = str(registro.get("visib"))

    nuvens = registro.get("clouds")
    if not isinstance(nuvens, list) or not nuvens:
        nuvens = ler.get("nuvens") or []
    nuvens_limpas = []
    for nuvem in nuvens:
        if not isinstance(nuvem, dict):
            continue
        # aceita tanto o formato da API (cover/base/type) quanto o do METAR bruto
        base = nuvem.get("base", nuvem.get("base_ft"))
        cobertura = nuvem.get("cover") or nuvem.get("cobertura") or ""
        nuvens_limpas.append({
            "cobertura": str(cobertura).upper() or None,
            "base_ft": int(base) if isinstance(base, (int, float)) else None,
            "tipo": nuvem.get("type") or nuvem.get("tipo") or None,
        })

    condicoes = (registro.get("wxString") or "").strip()
    if not condicoes and ler.get("fenomenos"):
        condicoes = " ".join(ler["fenomenos"])

    temperatura = registro.get("temp")
    if temperatura is None:
        temperatura = ler.get("temperatura_c")
    orvalho = registro.get("dewp")
    if orvalho is None:
        orvalho = ler.get("ponto_orvalho_c")

    qnh = registro.get("altim")
    if qnh is None:
        qnh = ler.get("qnh_hpa")

    return {
        "metar_bruto": bruto,
        "tipo": str(registro.get("metarType") or "METAR").upper(),
        "observado_utc": iso_utc(momento),
        "observado_brt": iso_brt(momento),
        "observado_epoch": int(momento.timestamp()),
        "temperatura_c": _num(temperatura),
        "ponto_orvalho_c": _num(orvalho),
        "qnh_hpa": _num(qnh),
        "condicoes": condicoes or None,
        "vento": vento,
        "visibilidade": {
            "metros": visibilidade.get("metros"),
            "milhas": visibilidade.get("milhas"),
            "cavok": bool(visibilidade.get("cavok")),
        },
        "nuvens": nuvens_limpas,
        "categoria_voo": (registro.get("fltCat") or None),
    }


def documento(resultado, mensagem, observacao, momento_coleta, idade_min=None):
    return {
        "schema": ESQUEMA,
        "estacao": "SBJR",
        "nome_estacao": NOME_ESTACAO,
        "fonte": NOME_FONTE,
        "gerado_em_utc": iso_utc(momento_coleta),
        "coleta": {
            "resultado": resultado,
            "mensagem": mensagem,
            "idade_min": idade_min,
        },
        "observacao": observacao,
    }


# --------------------------------------------------------------------------
# persistência atômica
# --------------------------------------------------------------------------

def gravar_json_atomico(caminho, dados):
    diretorio = os.path.dirname(os.path.abspath(caminho))
    os.makedirs(diretorio, exist_ok=True)
    descritor, temporario = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=diretorio)
    try:
        with os.fdopen(descritor, "w", encoding="utf-8") as arquivo:
            json.dump(dados, arquivo, ensure_ascii=False, indent=2, sort_keys=False)
            arquivo.write("\n")
            arquivo.flush()
            os.fsync(arquivo.fileno())
        os.chmod(temporario, 0o644)
        os.replace(temporario, caminho)
    except BaseException:
        try:
            os.unlink(temporario)
        except OSError:
            pass
        raise
    try:
        fd_dir = os.open(diretorio, os.O_RDONLY)
        try:
            os.fsync(fd_dir)
        finally:
            os.close(fd_dir)
    except OSError:
        pass


def ler_estado(caminho):
    try:
        with open(caminho, encoding="utf-8") as arquivo:
            dados = json.load(arquivo)
        observacao = dados.get("observacao") if isinstance(dados, dict) else None
        return observacao if isinstance(observacao, dict) else None
    except (OSError, ValueError):
        return None


def registrar(nivel, mensagem):
    print(f"{iso_utc(agora_utc())} {nivel} {mensagem}", file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# execução
# --------------------------------------------------------------------------

def coletar(estacao, origem, caminho_saida, caminho_estado):
    momento = agora_utc()

    try:
        if origem.startswith("file://"):
            with open(origem[7:], encoding="utf-8") as arquivo:
                conteudo = json.load(arquivo)
        else:
            conteudo = baixar_json(origem.format(estacao=estacao))

        if not isinstance(conteudo, list) or not conteudo:
            raise ErroColeta("fonte não retornou observações")

        observacao = montar_observacao(conteudo[0])
        observado = datetime.strptime(observacao["observado_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        idade = idade_minutos(observado, momento)

        if idade > LIMIAR_IDADE_MIN:
            registrar("AVISO", f"observação com {idade} min de atraso na coleta")
            mensagem = f"observação mais recente disponível tem {idade} min"
        else:
            mensagem = "observação atualizada"

        # guarda a observação boa em estado privado, para republicar em falhas
        gravar_json_atomico(caminho_estado, documento("ok", mensagem, observacao, momento, idade))
        gravar_json_atomico(caminho_saida, documento("ok", mensagem, observacao, momento, idade))
        registrar("OK", f"observação {observacao['observado_utc']} publicada (idade {idade} min)")
        return 0

    except ErroColeta as erro:
        motivo = erro.mensagem
    except (OSError, ValueError) as erro:
        motivo = "falha ao ler a resposta da fonte"
        registrar("ERRO", f"exceção tratada: {type(erro).__name__}")

    anterior = ler_estado(caminho_estado)
    mensagem = motivo if anterior else f"{motivo}; sem observação anterior"
    gravar_json_atomico(caminho_saida, documento("erro", mensagem, anterior, momento))
    registrar("ERRO", f"coleta falhou: {motivo}")

    # mantém o estado privado intacto quando já existe observação boa
    if anterior is None:
        registrar("ERRO", "nenhuma observação válida disponível")
    return 1


# --------------------------------------------------------------------------
# autoteste (sem rede, sem escrever em produção)
# --------------------------------------------------------------------------

FIXTURE_COMPLETA = [{
    "icaoId": "SBJR", "obsTime": 1794096000, "reportTime": "2026-11-08T00:00:00.000Z",
    "temp": 24, "dewp": 23, "wdir": 30, "wspd": 8, "visib": "6+", "altim": 1011,
    "wxString": "-RA", "metarType": "METAR",
    "rawOb": "METAR SBJR 080000Z 03008KT 9999 -RA BKN020 OVC100 24/23 Q1011",
    "clouds": [{"cover": "BKN", "base": 2000}, {"cover": "OVC", "base": 10000}],
    "fltCat": "MVFR",
}]

FIXTURE_CAVOK = [{
    "icaoId": "SBJR", "obsTime": 1794096000,
    "rawOb": "METAR SBJR 080000Z 00000KT CAVOK 31/19 Q1013",
    "metarType": "METAR",
}]

FIXTURE_RAJADA = [{
    "icaoId": "SBJR", "obsTime": 1794096000,
    "rawOb": "METAR SBJR 080000Z VRB15G27KT 4000 TSRA SCT012CB BKN025 22/21 Q1005",
}]

FIXTURE_SEM_NUVENS = [{
    "icaoId": "SBJR", "obsTime": 1794096000, "temp": 30, "dewp": 20,
    "wdir": 90, "wspd": 12, "altim": 1012, "wxString": "",
    "rawOb": "METAR SBJR 080000Z 09012KT 8000 SCT030 30/20 Q1012",
}]


def autoteste():
    falhas = 0

    def checar(rotulo, condicao, detalhe=""):
        nonlocal falhas
        if condicao:
            print(f"  PASS  {rotulo}")
        else:
            falhas += 1
            print(f"  FALHA {rotulo} {detalhe}")

    print("autoteste do coletor METAR")

    observacao = montar_observacao(FIXTURE_COMPLETA[0])
    checar("raw preservado", observacao["metar_bruto"].startswith("METAR SBJR"))
    checar("vento 030/08", observacao["vento"]["direcao_graus"] == 30 and observacao["vento"]["velocidade_kt"] == 8)
    checar("visibilidade 9999 m", observacao["visibilidade"]["metros"] == 9999)
    checar("temperatura/orvalho", observacao["temperatura_c"] == 24 and observacao["ponto_orvalho_c"] == 23)
    checar("qnh", observacao["qnh_hpa"] == 1011)
    checar("condições", observacao["condicoes"] == "-RA")
    checar("nebulosidade", len(observacao["nuvens"]) == 2 and observacao["nuvens"][0]["base_ft"] == 2000)
    checar("categoria de voo", observacao["categoria_voo"] == "MVFR")
    checar("obs_brt com fuso -03", observacao["observado_brt"].endswith("-03:00"),
           observacao["observado_brt"])

    cavok = montar_observacao(FIXTURE_CAVOK[0])
    checar("CAVOK detectado", cavok["visibilidade"]["cavok"] is True)
    checar("vento calmo", cavok["vento"]["calmo"] is True and cavok["vento"]["velocidade_kt"] == 0)
    checar("QNH via bruto", cavok["qnh_hpa"] == 1013)
    checar("temperatura via bruto", cavok["temperatura_c"] == 31)

    rajada = montar_observacao(FIXTURE_RAJADA[0])
    checar("vento variável", rajada["vento"]["direcao_variavel"] is True)
    checar("rajada 27 kt", rajada["vento"]["rajada_kt"] == 27)
    checar("fenômeno TSRA", rajada["condicoes"] == "TSRA")
    checar("nuvem com tipo CB", rajada["nuvens"][0]["tipo"] == "CB")

    sem_nuvens = montar_observacao(FIXTURE_SEM_NUVENS[0])
    checar("visibilidade do bruto 8000", sem_nuvens["visibilidade"]["metros"] == 8000)
    checar("nebulosidade via bruto", sem_nuvens["nuvens"][0]["cobertura"] == "SCT")

    for ruim, esperado in [
        ("texto qualquer", "resposta da fonte em formato inesperado"),
        ({}, "resposta sem observação METAR"),
        ({"obsTime": 1794096000}, "resposta sem observação METAR"),
        ({"rawOb": "METAR SBJR 080000Z 03008KT"}, "observação sem horário válido"),
    ]:
        try:
            montar_observacao(ruim)
            checar(f"rejeita {esperado}", False)
        except ErroColeta as erro:
            checar(f"rejeita {esperado}", erro.mensagem == esperado, erro.mensagem)

    # escrita atômica e preservação em falha
    with tempfile.TemporaryDirectory() as area:
        saida = os.path.join(area, "web", "metar.json")
        estado = os.path.join(area, "estado", "ultima.json")

        origem_ok = os.path.join(area, "ok.json")
        with open(origem_ok, "w", encoding="utf-8") as arquivo:
            json.dump(FIXTURE_COMPLETA, arquivo)
        codigo = coletar("SBJR", "file://" + origem_ok, saida, estado)
        checar("coleta ok retorna 0", codigo == 0)
        with open(saida, encoding="utf-8") as arquivo:
            publicado = json.load(arquivo)
        checar("publicado com resultado ok", publicado["coleta"]["resultado"] == "ok")
        checar("publicado sem campo interno",
               not any(c in json.dumps(publicado).lower() for c in ("/opt/", "/var/", "hostname", "traceback")))

        origem_vazia = os.path.join(area, "vazio.json")
        with open(origem_vazia, "w", encoding="utf-8") as arquivo:
            json.dump([], arquivo)
        codigo = coletar("SBJR", "file://" + origem_vazia, saida, estado)
        checar("resposta vazia retorna 1", codigo == 1)
        with open(saida, encoding="utf-8") as arquivo:
            depois = json.load(arquivo)
        checar("observação preservada após falha",
               depois["observacao"]["metar_bruto"] == publicado["observacao"]["metar_bruto"])
        checar("falha sinalizada", depois["coleta"]["resultado"] == "erro")

        origem_quebrada = os.path.join(area, "quebrado.json")
        with open(origem_quebrada, "w", encoding="utf-8") as arquivo:
            arquivo.write("{nao é json")
        codigo = coletar("SBJR", "file://" + origem_quebrada, saida, estado)
        checar("JSON inválido retorna 1", codigo == 1)
        checar("JSON inválido preserva observação", ler_estado(estado) is not None)

        codigo = coletar("SBJR", "file://" + os.path.join(area, "inexistente.json"), saida, estado)
        checar("arquivo inexistente retorna 1", codigo == 1)

        # sem estado anterior: publica documento sem observação
        saida2 = os.path.join(area, "web2", "metar.json")
        estado2 = os.path.join(area, "estado2", "ultima.json")
        coletar("SBJR", "file://" + origem_vazia, saida2, estado2)
        with open(saida2, encoding="utf-8") as arquivo:
            sem_anterior = json.load(arquivo)
        checar("sem observação anterior publica observacao=null",
               sem_anterior["observacao"] is None and sem_anterior["coleta"]["resultado"] == "erro")

        checar("nenhum arquivo temporário órfão",
               not [n for n in os.listdir(os.path.dirname(saida)) if n.startswith(".tmp-")])

    print(f"autoteste concluído: {'ok' if falhas == 0 else str(falhas) + ' falha(s)'}")
    return 0 if falhas == 0 else 1


def main(argv=None):
    analisador = argparse.ArgumentParser(description="Coletor METAR SBJR (Jacaré Cloud)")
    analisador.add_argument("--estacao", default="SBJR", help="código ICAO (padrão: SBJR)")
    analisador.add_argument("--origem", default=API_URL,
                            help="URL da API ou file:// para testes")
    analisador.add_argument("--saida", default="/var/www/jacare.cloud/data/metar.json",
                            help="JSON público consumido pelo dashboard")
    analisador.add_argument("--estado", default="/var/lib/jacare-metar/ultima-observacao.json",
                            help="cópia privada da última observação válida")
    analisador.add_argument("--autoteste", action="store_true", help="executa testes sem rede")
    argumentos = analisador.parse_args(argv)

    if argumentos.autoteste:
        return autoteste()

    return coletar(argumentos.estacao, argumentos.origem, argumentos.saida, argumentos.estado)


if __name__ == "__main__":
    sys.exit(main())
