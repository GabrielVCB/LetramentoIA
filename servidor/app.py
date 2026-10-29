"""
Sentinela — servidor Flask na nuvem, com banco Postgres externo.

Execução (Render):
    gunicorn app:app

O banco vem de SENTINELA_DB_URL (Neon/Supabase). Não existe modo local: o
servidor não inicia sem essa variável.

Rotas públicas:
    GET  /                   landing (primeira tela)
    GET  /login              formulário de acesso
    GET  /api/ping
    GET  /api/config          (identifica a extensão)
    POST /api/alertas         (identifica a extensão)

Painel (sessão):
    /painel, /logout
    /api/admin/*             (JSON, protegido por sessão)

O servidor nunca recebe o texto digitado pelo colaborador: apenas metadados
do alerta (site, departamento, nível, tipos detectados, origem, ação e IP).
"""
import csv
import hmac
import io
import os
import re
import time
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash

import db
import pdf

VERSAO = "2.6"

# ---------------------------------------------------------------------------
# Configuração (sempre por variáveis de ambiente, com padrão de desenvolvimento)
# ---------------------------------------------------------------------------

ADMIN_USUARIO = os.environ.get("SENTINELA_ADMIN_USUARIO", "admin")
ADMIN_SENHA = os.environ.get("SENTINELA_ADMIN_SENHA", "admin123")
SECRET_KEY = os.environ.get("SENTINELA_SECRET_KEY", "dev-secret-mude-isto")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=SECRET_KEY,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    # Na nuvem o painel é servido por https; o cookie só trafega por https.
    SESSION_COOKIE_SECURE=os.environ.get("SENTINELA_COOKIE_SEGURO", "1") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    MAX_CONTENT_LENGTH=256 * 1024,
)

# Atrás do proxy do Render: recupera o IP real do colaborador e o esquema https.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
    allow_headers=["Content-Type", "X-API-Token"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)

db.inicializar_banco(ADMIN_USUARIO, ADMIN_SENHA)


@app.context_processor
def variaveis_globais():
    """Deixa a versão disponível em todos os templates.

    Ela entra no endereço dos arquivos estáticos (?v=2.6), então o navegador não
    reaproveita um painel.js ou um CSS de uma publicação anterior.
    """
    return {"versao": VERSAO}


class ErroValidacao(Exception):
    """Erro de entrada do usuário, convertido em resposta 400."""


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def conexao():
    return db.conectar()


# ---------------------------------------------------------------------------
# Fuso horário
#
# O banco guarda tudo em UTC (sem fuso), que é o horário que não muda quando a
# Render reinicia ou muda de máquina. A exibição usa o fuso de quem está vendo:
# o painel manda o horário em ISO com "Z" e o navegador converte para o relógio
# da própria máquina. Para agrupar por dia, filtrar por data e exportar, o
# servidor usa um fuso fixo, definido em SENTINELA_FUSO_HORAS (padrão -3, o
# horário de Brasília).
# ---------------------------------------------------------------------------

def _fuso_do_servidor() -> timezone:
    try:
        horas = float((os.environ.get("SENTINELA_FUSO_HORAS") or "-3").strip())
    except ValueError:
        horas = -3.0
    horas = max(-12.0, min(14.0, horas))
    return timezone(timedelta(hours=horas))

FUSO = _fuso_do_servidor()


def agora_iso() -> str:
    """Agora em UTC, sem fuso: é assim que o banco guarda o horário."""
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def como_utc(valor) -> datetime:
    """Lê um horário ISO (com ou sem fuso) e devolve em UTC, sem fuso."""
    texto = str(valor).strip()
    if texto.endswith("Z"):
        texto = texto[:-1] + "+00:00"
    momento = datetime.fromisoformat(texto)
    if momento.tzinfo is None:
        # Sem fuso, o valor já está em UTC (é o formato gravado pelo servidor).
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(timezone.utc).replace(tzinfo=None)


def iso_para_navegador(valor):
    """Devolve o horário com "Z", para o navegador converter ao fuso da máquina."""
    if valor in (None, ""):
        return None
    try:
        return como_utc(valor).isoformat(timespec="seconds") + "Z"
    except ValueError:
        return valor


def hora_local(valor, formato: str = "%d/%m/%Y %H:%M") -> str:
    """Horário já no fuso do servidor, pronto para CSV e PDF."""
    if valor in (None, ""):
        return ""
    try:
        return como_utc(valor).replace(tzinfo=timezone.utc).astimezone(FUSO).strftime(formato)
    except ValueError:
        return str(valor)


def dia_local(valor) -> str:
    """Data (AAAA-MM-DD) no fuso do servidor — usada nos gráficos por dia."""
    try:
        return como_utc(valor).replace(tzinfo=timezone.utc).astimezone(FUSO).date().isoformat()
    except ValueError:
        return str(valor)[:10]


def limite_utc(data_texto: str, fim: bool = False) -> str:
    """Converte uma data local (AAAA-MM-DD) no começo/fim do dia, em UTC."""
    dia = datetime.strptime(data_texto, "%Y-%m-%d").replace(tzinfo=FUSO)
    if fim:
        dia = dia + timedelta(days=1)
    return dia.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Código de instalação e IP de origem
# ---------------------------------------------------------------------------

def ip_do_cliente() -> str:
    """IP de quem enviou o alerta. Atrás do proxy, o ProxyFix já resolveu isto."""
    endereco = (request.remote_addr or "").strip()
    if not endereco:
        return "desconhecido"
    return endereco[:64]


def token_esperado() -> str:
    """Variável de ambiente tem prioridade; senão vale o código gerado no banco."""
    definido = (os.environ.get("SENTINELA_API_TOKEN") or "").strip()
    return definido or db.token_api()


def conferir_token():
    """Devolve uma resposta de erro ou None quando o código de instalação confere."""
    recebido = (request.headers.get("X-API-Token") or "").strip()
    esperado = token_esperado()
    if not recebido or not esperado or not hmac.compare_digest(recebido, esperado):
        return jsonify({"erro": "Código de instalação inválido ou ausente."}), 401
    return None


def exigir_token_api(funcao):
    @wraps(funcao)
    def interna(*args, **kwargs):
        falha = conferir_token()
        if falha is not None:
            return falha
        return funcao(*args, **kwargs)

    return interna


def normalizar_data_hora(valor) -> str:
    """Converte o horário recebido para UTC, sem fuso, como o banco guarda."""
    if valor in (None, ""):
        return agora_iso()
    try:
        momento = como_utc(valor)
    except ValueError as erro:
        raise ErroValidacao("Campo data_hora inválido.") from erro
    return momento.isoformat(timespec="seconds")


def texto_obrigatorio(valor, campo: str, maximo: int = 120) -> str:
    if not isinstance(valor, str) or not valor.strip():
        raise ErroValidacao(f"{campo} é obrigatório.")
    limpo = valor.strip()
    if len(limpo) > maximo:
        raise ErroValidacao(f"{campo} deve ter até {maximo} caracteres.")
    return limpo


def texto_opcional(valor, campo: str, maximo: int = 120):
    if valor in (None, ""):
        return None
    if not isinstance(valor, str):
        raise ErroValidacao(f"{campo} deve ser texto.")
    limpo = valor.strip()[:maximo]
    return limpo or None


def validar_nivel(valor, campo: str = "Nível") -> str:
    if valor not in db.NIVEIS:
        raise ErroValidacao(f"{campo} deve ser baixo, medio ou alto.")
    return valor


def validar_tipo_regra(valor) -> str:
    if valor not in db.TIPOS_REGRA:
        raise ErroValidacao("Tipo deve ser regex ou palavra-chave.")
    return valor


def validar_regex(padrao: str) -> None:
    try:
        re.compile(padrao)
    except re.error as erro:
        raise ErroValidacao(f"Expressão regular inválida: {erro}") from erro


def ler_corpo() -> dict:
    corpo = request.get_json(silent=True)
    if not isinstance(corpo, dict):
        raise ErroValidacao("Envie um corpo JSON válido.")
    return corpo


def exigir_sessao_api(funcao):
    @wraps(funcao)
    def interna(*args, **kwargs):
        if not session.get("admin_id"):
            return jsonify({"erro": "Sessão expirada. Entre novamente."}), 401
        return funcao(*args, **kwargs)

    return interna


def exigir_sessao_pagina(funcao):
    @wraps(funcao)
    def interna(*args, **kwargs):
        if not session.get("admin_id"):
            return redirect(url_for("login"))
        return funcao(*args, **kwargs)

    return interna


def percentual(parte: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(parte * 100 / total, 1)


def nivel_por_itens(itens, fallback: str) -> str:
    riscos = [item["risco"] for item in itens]
    if "alto" in riscos:
        return "alto"
    if "medio" in riscos:
        return "medio"
    return fallback if not riscos else "baixo"


def condicoes_de_filtro(args) -> tuple:
    """Monta WHERE parametrizado para listagem/exportação de alertas."""
    condicoes = []
    parametros = []

    de = (args.get("de") or "").strip()
    ate = (args.get("ate") or "").strip()
    if de:
        try:
            datetime.strptime(de, "%Y-%m-%d")
        except ValueError as erro:
            raise ErroValidacao("Data inicial inválida. Use AAAA-MM-DD.") from erro
        condicoes.append("a.data_hora >= ?")
        parametros.append(limite_utc(de))
    if ate:
        try:
            datetime.strptime(ate, "%Y-%m-%d")
        except ValueError as erro:
            raise ErroValidacao("Data final inválida. Use AAAA-MM-DD.") from erro
        # "até" inclui o dia inteiro no fuso local: compara com o começo do dia seguinte.
        condicoes.append("a.data_hora < ?")
        parametros.append(limite_utc(ate, fim=True))

    departamento = (args.get("departamento") or "").strip()
    if departamento and departamento != "todos":
        condicoes.append("a.departamento = ?")
        parametros.append(departamento[:80])

    nivel = (args.get("nivel") or "").strip()
    if nivel and nivel != "todos":
        condicoes.append("a.nivel_risco = ?")
        parametros.append(validar_nivel(nivel))

    where = " WHERE " + " AND ".join(condicoes) if condicoes else ""
    return where, parametros


def itens_do_alerta(conexao_aberta, alerta_id: int) -> list:
    linhas = conexao_aberta.execute(
        "SELECT tipo_detectado, risco, area FROM alerta_itens WHERE alerta_id = ? ORDER BY id",
        (alerta_id,),
    ).fetchall()
    return [dict(linha) for linha in linhas]


def serializar_alerta(linha, itens: list) -> dict:
    colunas = linha.keys()
    return {
        "id": linha["id"],
        "origem": linha["origem"] or "texto",
        "data_hora": iso_para_navegador(linha["data_hora"]),
        "site": linha["site"],
        "departamento": linha["departamento"],
        "colaborador": linha["colaborador"],
        "ip": linha["ip"] if "ip" in colunas else None,
        "nivel_risco": linha["nivel_risco"],
        "acao": linha["acao"],
        "itens": itens,
    }


# ---------------------------------------------------------------------------
# Tratamento de erros
# ---------------------------------------------------------------------------

@app.errorhandler(ErroValidacao)
def tratar_validacao(erro):
    return jsonify({"erro": str(erro)}), 400


@app.errorhandler(404)
def tratar_404(erro):
    if request.path.startswith("/api/"):
        return jsonify({"erro": "Recurso não encontrado."}), 404
    return render_template("landing.html", **contexto_landing()), 404


@app.errorhandler(413)
def tratar_413(erro):
    return jsonify({"erro": "Corpo da requisição muito grande."}), 413


@app.after_request
def cabecalhos_de_seguranca(resposta):
    resposta.headers.setdefault("X-Content-Type-Options", "nosniff")
    resposta.headers.setdefault("X-Frame-Options", "DENY")
    resposta.headers.setdefault("Referrer-Policy", "no-referrer")
    resposta.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    )
    return resposta


# ---------------------------------------------------------------------------
# Rotas públicas / extensão
# ---------------------------------------------------------------------------

@app.get("/api/ping")
def api_ping():
    return jsonify(
        {
            "ok": True,
            "mensagem": "Sentinela online.",
            "versao": VERSAO,
            "hora": agora_iso(),
            "hora_local": datetime.now(FUSO).isoformat(timespec="seconds"),
            "fuso_horas": round(FUSO.utcoffset(None).total_seconds() / 3600, 1),
        }
    )


@app.get("/api/config")
@exigir_token_api
def api_config():
    conexao_aberta = conexao()
    try:
        regras = conexao_aberta.execute(
            """
            SELECT r.id, r.nome, r.tipo, r.padrao, r.risco, r.ativo, a.nome AS area
            FROM regras r
            JOIN areas a ON a.id = r.area_id
            WHERE r.ativo = 1
            ORDER BY a.nome, r.nome
            """
        ).fetchall()
        mensagens = {
            linha["nivel"]: linha["texto"]
            for linha in conexao_aberta.execute(
                "SELECT nivel, texto FROM mensagens"
            ).fetchall()
        }
        # Lista fechada de departamentos: as Opções da extensão mostram só estes
        # nomes, para ninguém gravar um departamento que não existe.
        areas = [
            linha["nome"]
            for linha in conexao_aberta.execute(
                "SELECT nome FROM areas ORDER BY id"
            ).fetchall()
        ]
        return jsonify(
            {
                "regras": [
                    {
                        "id": linha["id"],
                        "nome": linha["nome"],
                        "tipo": linha["tipo"],
                        "padrao": linha["padrao"],
                        "risco": linha["risco"],
                        "ativo": bool(linha["ativo"]),
                        "area": linha["area"],
                    }
                    for linha in regras
                ],
                "mensagens": {
                    nivel: mensagens.get(nivel, db.MENSAGENS_PADRAO[nivel])
                    for nivel in db.NIVEIS
                },
                "areas": areas,
                "atualizado_em": agora_iso(),
            }
        )
    finally:
        conexao_aberta.close()


@app.post("/api/alertas")
@exigir_token_api
def api_criar_alerta():
    # O código de instalação já foi conferido por @exigir_token_api antes de
    # qualquer gravação.
    corpo = ler_corpo()
    ip = ip_do_cliente()

    site = texto_obrigatorio(corpo.get("site"), "Site", 120)
    departamento = texto_obrigatorio(corpo.get("departamento"), "Departamento", 80)
    colaborador = texto_opcional(corpo.get("colaborador"), "Colaborador", 80)
    nivel_informado = validar_nivel(corpo.get("nivel_risco"), "Nível de risco")
    acao = corpo.get("acao")
    if acao not in db.ACOES:
        raise ErroValidacao("Ação deve ser enviou ou cancelou.")
    data_hora = normalizar_data_hora(corpo.get("data_hora"))

    evento_id = texto_opcional(corpo.get("evento_id"), "Identificador do evento", 64)
    origem = (corpo.get("origem") or "texto").strip().lower()
    if origem not in db.ORIGENS:
        raise ErroValidacao("Origem deve ser texto, colagem, imagem, pdf ou anexo.")

    tipos = corpo.get("tipos_detectados", [])
    if not isinstance(tipos, list) or len(tipos) > 20:
        raise ErroValidacao("tipos_detectados deve ser uma lista com até 20 itens.")

    itens = []
    for entrada in tipos:
        if isinstance(entrada, str):
            itens.append(
                {
                    "tipo_detectado": texto_obrigatorio(entrada, "Tipo detectado", 80),
                    "risco": nivel_informado,
                    "area": None,
                }
            )
        elif isinstance(entrada, dict):
            itens.append(
                {
                    "tipo_detectado": texto_obrigatorio(
                        entrada.get("tipo_detectado") or entrada.get("tipo"),
                        "Tipo detectado",
                        80,
                    ),
                    "risco": validar_nivel(entrada.get("risco"), "Risco do item"),
                    "area": texto_opcional(entrada.get("area"), "Área", 60),
                }
            )
        else:
            raise ErroValidacao("Cada item de tipos_detectados deve ser texto ou objeto.")

    # A classificação final é recalculada no servidor para não depender do cliente.
    nivel_final = nivel_por_itens(itens, nivel_informado)

    conexao_aberta = conexao()
    try:
        # Idempotência: se a extensão repetir o envio do mesmo evento (retentativa
        # imediata), a auditoria continua com uma linha só.
        if evento_id:
            existente = conexao_aberta.execute(
                "SELECT id FROM alertas WHERE evento_id = ?", (evento_id,)
            ).fetchone()
            if existente is not None:
                return (
                    jsonify(
                        {
                            "id": existente["id"],
                            "duplicado": True,
                            "mensagem": "Alerta já registrado.",
                        }
                    ),
                    200,
                )

        try:
            alerta_id = db.inserir_id(
                conexao_aberta,
                """
                INSERT INTO alertas
                    (evento_id, origem, data_hora, site, departamento, colaborador, ip,
                     nivel_risco, acao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evento_id,
                    origem,
                    data_hora,
                    site,
                    departamento,
                    colaborador,
                    ip,
                    nivel_final,
                    acao,
                ),
            )
        except db.ERROS_INTEGRIDADE:
            conexao_aberta.rollback()
            existente = conexao_aberta.execute(
                "SELECT id FROM alertas WHERE evento_id = ?", (evento_id,)
            ).fetchone()
            return (
                jsonify(
                    {
                        "id": existente["id"] if existente else None,
                        "duplicado": True,
                        "mensagem": "Alerta já registrado.",
                    }
                ),
                200,
            )

        conexao_aberta.executemany(
            """
            INSERT INTO alerta_itens (alerta_id, tipo_detectado, risco, area)
            VALUES (?, ?, ?, ?)
            """,
            [
                (alerta_id, item["tipo_detectado"], item["risco"], item["area"])
                for item in itens
            ],
        )
        conexao_aberta.commit()
        return jsonify({"id": alerta_id, "mensagem": "Alerta registrado."}), 201
    finally:
        conexao_aberta.close()


# ---------------------------------------------------------------------------
# Autenticação do painel
# ---------------------------------------------------------------------------

def areas_para_landing() -> list:
    """Matriz de risco exibida na página inicial, direto do banco."""
    conexao_aberta = conexao()
    try:
        areas = conexao_aberta.execute(
            "SELECT id, nome, descricao FROM areas ORDER BY id"
        ).fetchall()
        regras = conexao_aberta.execute(
            "SELECT area_id, nome, risco FROM regras WHERE ativo = 1 ORDER BY id"
        ).fetchall()
    finally:
        conexao_aberta.close()

    por_area = {}
    for regra in regras:
        por_area.setdefault(regra["area_id"], []).append(
            {"nome": regra["nome"], "risco": regra["risco"]}
        )

    return [
        {
            "nome": area["nome"],
            "descricao": area["descricao"],
            "regras": por_area.get(area["id"], []),
        }
        for area in areas
    ]


def contexto_landing() -> dict:
    return {"areas": areas_para_landing(), "ano": datetime.now(FUSO).year}


@app.get("/")
def landing():
    return render_template("landing.html", **contexto_landing())


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        usuario = (request.form.get("usuario") or "").strip()
        senha = request.form.get("senha") or ""

        conexao_aberta = conexao()
        try:
            linha = conexao_aberta.execute(
                "SELECT id, usuario, senha_hash FROM usuarios_admin WHERE usuario = ?",
                (usuario,),
            ).fetchone()
        finally:
            conexao_aberta.close()

        if linha is None or not check_password_hash(linha["senha_hash"], senha):
            time.sleep(0.3)  # atraso simples contra tentativa em massa
            return (
                render_template(
                    "login.html",
                    erro="Usuário ou senha inválidos.",
                    usuario=usuario,
                ),
                401,
            )

        session.clear()
        session["admin_id"] = linha["id"]
        session["admin_usuario"] = linha["usuario"]
        session.permanent = True
        return redirect(url_for("painel"))

    if session.get("admin_id"):
        return redirect(url_for("painel"))
    return render_template("login.html", erro=None, usuario="")


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("landing"))


@app.get("/painel")
@exigir_sessao_pagina
def painel():
    return render_template(
        "painel.html",
        usuario=session.get("admin_usuario", "admin"),
        limiar_padrao=obter_limiar(),
    )


# ---------------------------------------------------------------------------
# API administrativa — relatórios
# ---------------------------------------------------------------------------

def obter_limiar() -> int:
    conexao_aberta = conexao()
    try:
        linha = conexao_aberta.execute(
            "SELECT valor FROM configuracoes WHERE chave = 'limiar_gargalo'"
        ).fetchone()
        return int(linha["valor"]) if linha else 30
    except (TypeError, ValueError):
        return 30
    finally:
        conexao_aberta.close()


@app.get("/api/admin/resumo")
@exigir_sessao_api
def api_resumo():
    limiar = request.args.get("limiar", type=int)
    if limiar is None:
        limiar = obter_limiar()
    limiar = max(0, min(100, limiar))

    conexao_aberta = conexao()
    try:
        alertas = conexao_aberta.execute(
            "SELECT * FROM alertas ORDER BY data_hora DESC LIMIT 5000"
        ).fetchall()
        itens = conexao_aberta.execute(
            """
            SELECT ai.alerta_id, ai.tipo_detectado, ai.risco, ai.area
            FROM alerta_itens ai
            JOIN alertas a ON a.id = ai.alerta_id
            """
        ).fetchall()
    finally:
        conexao_aberta.close()

    itens_por_alerta = {}
    for item in itens:
        itens_por_alerta.setdefault(item["alerta_id"], []).append(dict(item))

    total = len(alertas)
    total_alto = sum(1 for alerta in alertas if alerta["nivel_risco"] == "alto")
    total_enviou = sum(1 for alerta in alertas if alerta["acao"] == "enviou")
    total_cancelou = total - total_enviou

    departamentos = {}
    for alerta in alertas:
        dados = departamentos.setdefault(
            alerta["departamento"],
            {"total": 0, "alto": 0, "enviou": 0, "cancelou": 0},
        )
        dados["total"] += 1
        if alerta["nivel_risco"] == "alto":
            dados["alto"] += 1
        if alerta["acao"] == "enviou":
            dados["enviou"] += 1
        else:
            dados["cancelou"] += 1

    por_departamento = []
    for nome, dados in departamentos.items():
        por_departamento.append(
            {
                "departamento": nome,
                **dados,
                "taxa_alto": percentual(dados["alto"], dados["total"]),
                "taxa_envio": percentual(dados["enviou"], dados["total"]),
            }
        )
    por_departamento.sort(key=lambda item: item["total"], reverse=True)

    gargalos = [
        item
        for item in por_departamento
        if item["total"] >= 3 and item["taxa_alto"] >= limiar
    ]

    contagem_tipos = {}
    for item in itens:
        registro = contagem_tipos.setdefault(
            item["tipo_detectado"],
            {
                "tipo": item["tipo_detectado"],
                "area": item["area"] or "Geral",
                "risco": item["risco"],
                "total": 0,
            },
        )
        registro["total"] += 1
    tipos = sorted(contagem_tipos.values(), key=lambda item: item["total"], reverse=True)[:7]

    dias = []
    hoje = datetime.now(FUSO).date()
    for indice in range(13, -1, -1):
        dia = hoje - timedelta(days=indice)
        dias.append(
            {
                "data": dia.isoformat(),
                "total": 0,
                "alto": 0,
                "medio": 0,
                "baixo": 0,
                "cancelou": 0,
            }
        )
    indice_por_dia = {dia["data"]: numero for numero, dia in enumerate(dias)}
    for alerta in alertas:
        chave = dia_local(alerta["data_hora"])
        posicao = indice_por_dia.get(chave)
        if posicao is None:
            continue
        dias[posicao]["total"] += 1
        dias[posicao][alerta["nivel_risco"]] += 1
        if alerta["acao"] == "cancelou":
            dias[posicao]["cancelou"] += 1

    ultimos = []
    for alerta in alertas[:5]:
        ultimos.append(
            serializar_alerta(
                alerta,
                [
                    {
                        "tipo_detectado": item["tipo_detectado"],
                        "risco": item["risco"],
                        "area": item["area"],
                    }
                    for item in itens_por_alerta.get(alerta["id"], [])
                ],
            )
        )

    return jsonify(
        {
            "total": total,
            "total_alto": total_alto,
            "total_enviou": total_enviou,
            "total_cancelou": total_cancelou,
            "taxa_envio": percentual(total_enviou, total),
            "taxa_alto": percentual(total_alto, total),
            "tipos_distintos": len(contagem_tipos),
            "departamentos_ativos": len(departamentos),
            "limiar": limiar,
            "por_departamento": por_departamento,
            "gargalos": gargalos,
            "tipos": tipos,
            "evolucao": dias,
            "ultimos": ultimos,
        }
    )


# ---------------------------------------------------------------------------
# API administrativa — alertas
# ---------------------------------------------------------------------------

@app.get("/api/admin/alertas")
@exigir_sessao_api
def api_listar_alertas():
    where, parametros = condicoes_de_filtro(request.args)
    pagina = max(1, request.args.get("pagina", default=1, type=int) or 1)
    por_pagina = request.args.get("por_pagina", default=12, type=int) or 12
    por_pagina = max(5, min(50, por_pagina))

    conexao_aberta = conexao()
    try:
        total = conexao_aberta.execute(
            f"SELECT COUNT(*) AS total FROM alertas a{where}", parametros
        ).fetchone()["total"]
        total_paginas = max(1, -(-total // por_pagina))
        pagina = min(pagina, total_paginas)
        deslocamento = (pagina - 1) * por_pagina

        linhas = conexao_aberta.execute(
            f"""
            SELECT a.* FROM alertas a{where}
            ORDER BY a.data_hora DESC
            LIMIT ? OFFSET ?
            """,
            parametros + [por_pagina, deslocamento],
        ).fetchall()

        ids = [linha["id"] for linha in linhas]
        itens = []
        if ids:
            marcadores = ",".join("?" for _ in ids)
            itens = conexao_aberta.execute(
                f"""
                SELECT alerta_id, tipo_detectado, risco, area
                FROM alerta_itens
                WHERE alerta_id IN ({marcadores})
                ORDER BY id
                """,
                ids,
            ).fetchall()
    finally:
        conexao_aberta.close()

    itens_por_alerta = {}
    for item in itens:
        itens_por_alerta.setdefault(item["alerta_id"], []).append(
            {
                "tipo_detectado": item["tipo_detectado"],
                "risco": item["risco"],
                "area": item["area"],
            }
        )

    return jsonify(
        {
            "registros": [
                serializar_alerta(linha, itens_por_alerta.get(linha["id"], []))
                for linha in linhas
            ],
            "total": total,
            "pagina": pagina,
            "total_paginas": total_paginas,
            "por_pagina": por_pagina,
        }
    )


@app.get("/api/admin/alertas/<int:alerta_id>")
@exigir_sessao_api
def api_detalhar_alerta(alerta_id: int):
    conexao_aberta = conexao()
    try:
        linha = conexao_aberta.execute(
            "SELECT * FROM alertas WHERE id = ?", (alerta_id,)
        ).fetchone()
        if linha is None:
            return jsonify({"erro": "Alerta não encontrado."}), 404
        return jsonify(serializar_alerta(linha, itens_do_alerta(conexao_aberta, alerta_id)))
    finally:
        conexao_aberta.close()


@app.delete("/api/admin/alertas/<int:alerta_id>")
@exigir_sessao_api
def api_remover_alerta(alerta_id: int):
    conexao_aberta = conexao()
    try:
        cursor = conexao_aberta.execute("DELETE FROM alertas WHERE id = ?", (alerta_id,))
        conexao_aberta.commit()
        if cursor.rowcount == 0:
            return jsonify({"erro": "Alerta não encontrado."}), 404
        return jsonify({"mensagem": "Alerta removido.", "removidos": cursor.rowcount})
    finally:
        conexao_aberta.close()


@app.post("/api/admin/alertas/limpar-idade")
@exigir_sessao_api
def api_limpar_por_idade():
    corpo = ler_corpo()
    try:
        dias = int(corpo.get("dias"))
    except (TypeError, ValueError) as erro:
        raise ErroValidacao("Informe um número de dias válido.") from erro
    if dias < 1 or dias > 3650:
        raise ErroValidacao("O número de dias deve ficar entre 1 e 3650.")

    limite = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=dias)).isoformat(
        timespec="seconds"
    )
    conexao_aberta = conexao()
    try:
        cursor = conexao_aberta.execute("DELETE FROM alertas WHERE data_hora < ?", (limite,))
        conexao_aberta.commit()
        return jsonify({"removidos": cursor.rowcount, "limite": limite})
    finally:
        conexao_aberta.close()


@app.delete("/api/admin/alertas")
@exigir_sessao_api
def api_limpar_tudo():
    conexao_aberta = conexao()
    try:
        cursor = conexao_aberta.execute("DELETE FROM alertas")
        conexao_aberta.commit()
        return jsonify({"removidos": cursor.rowcount})
    finally:
        conexao_aberta.close()


@app.get("/api/admin/exportar.csv")
@exigir_sessao_api
def api_exportar_csv():
    where, parametros = condicoes_de_filtro(request.args)
    conexao_aberta = conexao()
    try:
        linhas = conexao_aberta.execute(
            f"""
            SELECT a.*, GROUP_CONCAT(ai.tipo_detectado, ' | ') AS tipos
            FROM alertas a
            LEFT JOIN alerta_itens ai ON ai.alerta_id = a.id
            {where}
            GROUP BY a.id
            ORDER BY a.data_hora DESC
            LIMIT 5000
            """,
            parametros,
        ).fetchall()
    finally:
        conexao_aberta.close()

    saida = io.StringIO()
    escritor = csv.writer(saida, delimiter=";", lineterminator="\r\n")
    escritor.writerow(
        [
            "Data/hora",
            "Site",
            "Origem",
            "Departamento",
            "Colaborador",
            "IP",
            "Nível",
            "Ação",
            "Tipos",
        ]
    )
    rotulos = {"baixo": "Baixo", "medio": "Médio", "alto": "Alto"}
    origens = {
        "texto": "Texto digitado",
        "colagem": "Colagem em massa",
        "imagem": "Print ou imagem",
        "pdf": "Arquivo PDF",
        "anexo": "Imagem e PDF",
    }
    for linha in linhas:
        escritor.writerow(
            [
                hora_local(linha["data_hora"]),
                linha["site"],
                origens.get(linha["origem"], "Texto digitado"),
                linha["departamento"],
                linha["colaborador"] or "anônimo",
                linha["ip"] or "—",
                rotulos.get(linha["nivel_risco"], linha["nivel_risco"]),
                "Enviou mesmo assim" if linha["acao"] == "enviou" else "Cancelou",
                linha["tipos"] or "",
            ]
        )

    conteudo = "\ufeff" + saida.getvalue()
    return Response(
        conteudo,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="alertas-sentinela.csv"'},
    )


@app.get("/api/admin/exportar.pdf")
@exigir_sessao_api
def api_exportar_pdf():
    """Mesma listagem do CSV, em PDF — gerado em memória, sem dependências."""
    where, parametros = condicoes_de_filtro(request.args)
    conexao_aberta = conexao()
    try:
        linhas = conexao_aberta.execute(
            f"""
            SELECT a.*, GROUP_CONCAT(ai.tipo_detectado, ' · ') AS tipos
            FROM alertas a
            LEFT JOIN alerta_itens ai ON ai.alerta_id = a.id
            {where}
            GROUP BY a.id
            ORDER BY a.data_hora DESC
            LIMIT 5000
            """,
            parametros,
        ).fetchall()
    finally:
        conexao_aberta.close()

    rotulos = {"baixo": "Baixo", "medio": "Médio", "alto": "Alto"}
    origens = {
        "texto": "Texto",
        "colagem": "Colagem",
        "imagem": "Imagem",
        "pdf": "PDF",
        "anexo": "Imagem+PDF",
    }
    registros = []
    for linha in linhas:
        registros.append(
            [
                hora_local(linha["data_hora"]),
                linha["departamento"],
                linha["colaborador"] or "anônimo",
                linha["ip"] or "—",
                linha["site"],
                origens.get(linha["origem"], "Texto"),
                rotulos.get(linha["nivel_risco"], linha["nivel_risco"]),
                "Enviou" if linha["acao"] == "enviou" else "Cancelou",
                linha["tipos"] or "",
            ]
        )

    filtros = []
    if request.args.get("de"):
        filtros.append("de " + request.args["de"])
    if request.args.get("ate"):
        filtros.append("até " + request.args["ate"])
    if request.args.get("departamento") and request.args["departamento"] != "todos":
        filtros.append("departamento " + request.args["departamento"])
    if request.args.get("nivel") and request.args["nivel"] != "todos":
        filtros.append("risco " + rotulos.get(request.args["nivel"], request.args["nivel"]))

    subtitulo = (
        f"Auditoria de alertas · {len(registros)} registro(s)"
        + (" · " + " · ".join(filtros) if filtros else " · sem filtro")
    )

    conteudo = pdf.gerar_pdf(
        "Sentinela — relatório de alertas",
        subtitulo,
        [
            ("Data/hora", 1.15),
            ("Departamento", 1.1),
            ("Colaborador", 1.05),
            ("IP", 1.05),
            ("Site", 1.25),
            ("Origem", 0.85),
            ("Nível", 0.62),
            ("Ação", 0.85),
            ("Tipos", 2.4),
        ],
        registros,
        "Somente metadados: o texto digitado nunca é armazenado.",
        gerado_em=datetime.now(FUSO).strftime("%d/%m/%Y %H:%M"),
    )
    return Response(
        conteudo,
        mimetype="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="alertas-sentinela.pdf"'},
    )


@app.get("/api/admin/departamentos")
@exigir_sessao_api
def api_listar_departamentos():
    """Departamentos que já aparecem em alertas, incluindo “Não informado”."""
    conexao_aberta = conexao()
    try:
        linhas = conexao_aberta.execute(
            """
            SELECT departamento, COUNT(*) AS total
            FROM alertas
            GROUP BY departamento
            ORDER BY LOWER(departamento)
            """
        ).fetchall()
    finally:
        conexao_aberta.close()
    return jsonify(
        [
            {"departamento": linha["departamento"], "total": linha["total"]}
            for linha in linhas
        ]
    )


# ---------------------------------------------------------------------------
# API administrativa — instalação e contas de administrador
# ---------------------------------------------------------------------------

@app.get("/api/admin/instalacao")
@exigir_sessao_api
def api_instalacao():
    url_base = request.url_root.rstrip("/")
    return jsonify(
        {
            "url_base": url_base,
            "token": token_esperado(),
            "endereco_visto": ip_do_cliente(),
            "versao": VERSAO,
        }
    )


@app.post("/api/admin/instalacao/renovar-token")
@exigir_sessao_api
def api_renovar_token():
    if (os.environ.get("SENTINELA_API_TOKEN") or "").strip():
        raise ErroValidacao(
            "O código está definido em SENTINELA_API_TOKEN. Troque o valor lá e reinicie o servidor."
        )
    novo = db.renovar_token_api()
    return jsonify(
        {
            "token": novo,
            "mensagem": "Código renovado. Reconfigure as extensões com o novo valor.",
        }
    )


def validar_senha_admin(valor) -> str:
    if not isinstance(valor, str) or len(valor.strip()) < 8:
        raise ErroValidacao("A senha deve ter pelo menos 8 caracteres.")
    return valor


@app.get("/api/admin/usuarios")
@exigir_sessao_api
def api_listar_usuarios():
    atual = session.get("admin_id")
    return jsonify(
        [
            {
                "id": admin["id"],
                "usuario": admin["usuario"],
                "criado_em": iso_para_navegador(admin["criado_em"]),
                "atual": admin["id"] == atual,
            }
            for admin in db.listar_admins()
        ]
    )


@app.post("/api/admin/usuarios")
@exigir_sessao_api
def api_criar_usuario():
    corpo = ler_corpo()
    usuario = texto_obrigatorio(corpo.get("usuario"), "Usuário", 40)
    if not re.fullmatch(r"[A-Za-z0-9._@-]{3,40}", usuario):
        raise ErroValidacao("Use letras, números, ponto, hífen, @ ou _ no usuário.")
    senha = validar_senha_admin(corpo.get("senha"))

    conexao_aberta = conexao()
    try:
        existente = conexao_aberta.execute(
            "SELECT id FROM usuarios_admin WHERE LOWER(usuario) = LOWER(?)", (usuario,)
        ).fetchone()
    finally:
        conexao_aberta.close()
    if existente:
        return jsonify({"erro": "Já existe um administrador com esse usuário."}), 409

    novo_id = db.criar_admin(usuario, senha)
    return jsonify({"id": novo_id, "mensagem": "Administrador criado."}), 201


@app.delete("/api/admin/usuarios/<int:admin_id>")
@exigir_sessao_api
def api_remover_usuario(admin_id: int):
    if admin_id == session.get("admin_id"):
        raise ErroValidacao("Você não pode remover a sua própria conta.")
    if db.total_admins() <= 1:
        raise ErroValidacao("O painel precisa de pelo menos um administrador.")
    if db.remover_admin(admin_id) == 0:
        return jsonify({"erro": "Administrador não encontrado."}), 404
    return jsonify({"mensagem": "Administrador removido."})


@app.put("/api/admin/usuarios/<int:admin_id>/senha")
@exigir_sessao_api
def api_trocar_senha(admin_id: int):
    corpo = ler_corpo()
    senha = validar_senha_admin(corpo.get("senha"))
    if db.trocar_senha_admin(admin_id, senha) == 0:
        return jsonify({"erro": "Administrador não encontrado."}), 404
    return jsonify({"mensagem": "Senha atualizada."})


# ---------------------------------------------------------------------------
# API administrativa — áreas
# ---------------------------------------------------------------------------

@app.get("/api/admin/areas")
@exigir_sessao_api
def api_listar_areas():
    conexao_aberta = conexao()
    try:
        linhas = conexao_aberta.execute(
            """
            SELECT a.id, a.nome, a.descricao,
                   COUNT(r.id) AS total_regras,
                   SUM(CASE WHEN r.ativo = 1 THEN 1 ELSE 0 END) AS total_ativas
            FROM areas a
            LEFT JOIN regras r ON r.area_id = a.id
            GROUP BY a.id
            ORDER BY LOWER(a.nome)
            """
        ).fetchall()
        return jsonify(
            [
                {
                    "id": linha["id"],
                    "nome": linha["nome"],
                    "descricao": linha["descricao"] or "",
                    "total_regras": linha["total_regras"],
                    "total_ativas": linha["total_ativas"] or 0,
                }
                for linha in linhas
            ]
        )
    finally:
        conexao_aberta.close()


def validar_area(corpo: dict) -> tuple:
    nome = texto_obrigatorio(corpo.get("nome"), "Nome da área", 60)
    descricao = texto_opcional(corpo.get("descricao"), "Descrição", 240)
    return nome, descricao


@app.post("/api/admin/areas")
@exigir_sessao_api
def api_criar_area():
    nome, descricao = validar_area(ler_corpo())
    conexao_aberta = conexao()
    try:
        existente = conexao_aberta.execute(
            "SELECT id FROM areas WHERE LOWER(nome) = LOWER(?)", (nome,)
        ).fetchone()
        if existente:
            return jsonify({"erro": "Já existe uma área com esse nome."}), 409
        novo_id = db.inserir_id(
            conexao_aberta,
            "INSERT INTO areas (nome, descricao) VALUES (?, ?)",
            (nome, descricao),
        )
        conexao_aberta.commit()
        return jsonify({"id": novo_id, "mensagem": "Área criada."}), 201
    finally:
        conexao_aberta.close()


@app.put("/api/admin/areas/<int:area_id>")
@exigir_sessao_api
def api_atualizar_area(area_id: int):
    nome, descricao = validar_area(ler_corpo())
    conexao_aberta = conexao()
    try:
        if not conexao_aberta.execute("SELECT id FROM areas WHERE id = ?", (area_id,)).fetchone():
            return jsonify({"erro": "Área não encontrada."}), 404
        existente = conexao_aberta.execute(
            "SELECT id FROM areas WHERE LOWER(nome) = LOWER(?) AND id <> ?",
            (nome, area_id),
        ).fetchone()
        if existente:
            return jsonify({"erro": "Já existe uma área com esse nome."}), 409
        conexao_aberta.execute(
            "UPDATE areas SET nome = ?, descricao = ? WHERE id = ?",
            (nome, descricao, area_id),
        )
        conexao_aberta.commit()
        return jsonify({"mensagem": "Área atualizada."})
    finally:
        conexao_aberta.close()


@app.delete("/api/admin/areas/<int:area_id>")
@exigir_sessao_api
def api_remover_area(area_id: int):
    conexao_aberta = conexao()
    try:
        total_regras = conexao_aberta.execute(
            "SELECT COUNT(*) AS total FROM regras WHERE area_id = ?", (area_id,)
        ).fetchone()["total"]
        cursor = conexao_aberta.execute("DELETE FROM areas WHERE id = ?", (area_id,))
        conexao_aberta.commit()
        if cursor.rowcount == 0:
            return jsonify({"erro": "Área não encontrada."}), 404
        return jsonify({"mensagem": "Área removida.", "regras_removidas": total_regras})
    finally:
        conexao_aberta.close()


# ---------------------------------------------------------------------------
# API administrativa — regras
# ---------------------------------------------------------------------------

@app.get("/api/admin/regras")
@exigir_sessao_api
def api_listar_regras():
    conexao_aberta = conexao()
    try:
        linhas = conexao_aberta.execute(
            """
            SELECT r.id, r.area_id, r.nome, r.tipo, r.padrao, r.risco, r.ativo,
                   a.nome AS area
            FROM regras r
            JOIN areas a ON a.id = r.area_id
            ORDER BY LOWER(a.nome), LOWER(r.nome)
            """
        ).fetchall()
        return jsonify(
            [
                {
                    "id": linha["id"],
                    "area_id": linha["area_id"],
                    "area": linha["area"],
                    "nome": linha["nome"],
                    "tipo": linha["tipo"],
                    "padrao": linha["padrao"],
                    "risco": linha["risco"],
                    "ativo": bool(linha["ativo"]),
                }
                for linha in linhas
            ]
        )
    finally:
        conexao_aberta.close()


def validar_regra(corpo: dict) -> dict:
    try:
        area_id = int(corpo.get("area_id"))
    except (TypeError, ValueError) as erro:
        raise ErroValidacao("Selecione uma área válida.") from erro

    nome = texto_obrigatorio(corpo.get("nome"), "Nome da regra", 80)
    tipo = validar_tipo_regra(corpo.get("tipo"))
    padrao = texto_obrigatorio(corpo.get("padrao"), "Padrão", 500)
    risco = validar_nivel(corpo.get("risco"))
    ativo = 1 if corpo.get("ativo", True) else 0

    if tipo == "regex":
        validar_regex(padrao)

    return {
        "area_id": area_id,
        "nome": nome,
        "tipo": tipo,
        "padrao": padrao,
        "risco": risco,
        "ativo": ativo,
    }


def area_existe(conexao_aberta, area_id: int) -> bool:
    return (
        conexao_aberta.execute("SELECT id FROM areas WHERE id = ?", (area_id,)).fetchone()
        is not None
    )


@app.post("/api/admin/regras")
@exigir_sessao_api
def api_criar_regra():
    dados = validar_regra(ler_corpo())
    conexao_aberta = conexao()
    try:
        if not area_existe(conexao_aberta, dados["area_id"]):
            raise ErroValidacao("Selecione uma área válida.")
        novo_id = db.inserir_id(
            conexao_aberta,
            """
            INSERT INTO regras (area_id, nome, tipo, padrao, risco, ativo)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                dados["area_id"],
                dados["nome"],
                dados["tipo"],
                dados["padrao"],
                dados["risco"],
                dados["ativo"],
            ),
        )
        conexao_aberta.commit()
        # A regra também entra na lista do crud.py, que é o cadastro de origem.
        db.criar_na_memoria(
            dados["nome"],
            db.nome_da_area(conexao_aberta, dados["area_id"]),
            dados["tipo"],
            dados["padrao"],
            dados["risco"],
            bool(dados["ativo"]),
        )
        return jsonify({"id": novo_id, "mensagem": "Regra criada."}), 201
    finally:
        conexao_aberta.close()


@app.put("/api/admin/regras/<int:regra_id>")
@exigir_sessao_api
def api_atualizar_regra(regra_id: int):
    dados = validar_regra(ler_corpo())
    conexao_aberta = conexao()
    try:
        anterior = conexao_aberta.execute(
            """
            SELECT r.nome, a.nome AS area
            FROM regras r
            JOIN areas a ON a.id = r.area_id
            WHERE r.id = ?
            """,
            (regra_id,),
        ).fetchone()
        if anterior is None:
            return jsonify({"erro": "Regra não encontrada."}), 404
        if not area_existe(conexao_aberta, dados["area_id"]):
            raise ErroValidacao("Selecione uma área válida.")
        conexao_aberta.execute(
            """
            UPDATE regras
            SET area_id = ?, nome = ?, tipo = ?, padrao = ?, risco = ?, ativo = ?
            WHERE id = ?
            """,
            (
                dados["area_id"],
                dados["nome"],
                dados["tipo"],
                dados["padrao"],
                dados["risco"],
                dados["ativo"],
                regra_id,
            ),
        )
        conexao_aberta.commit()
        # Mesma edição na lista do crud.py: a regra é procurada pelo nome e
        # pela área antigos e sai de lá já com os dados novos.
        db.atualizar_na_memoria(
            anterior["nome"],
            anterior["area"],
            dados["nome"],
            db.nome_da_area(conexao_aberta, dados["area_id"]),
            dados["tipo"],
            dados["padrao"],
            dados["risco"],
            bool(dados["ativo"]),
        )
        return jsonify({"mensagem": "Regra atualizada."})
    finally:
        conexao_aberta.close()


@app.delete("/api/admin/regras/<int:regra_id>")
@exigir_sessao_api
def api_remover_regra(regra_id: int):
    conexao_aberta = conexao()
    try:
        anterior = conexao_aberta.execute(
            """
            SELECT r.nome, a.nome AS area
            FROM regras r
            JOIN areas a ON a.id = r.area_id
            WHERE r.id = ?
            """,
            (regra_id,),
        ).fetchone()
        if anterior is None:
            return jsonify({"erro": "Regra não encontrada."}), 404
        cursor = conexao_aberta.execute("DELETE FROM regras WHERE id = ?", (regra_id,))
        conexao_aberta.commit()
        if cursor.rowcount == 0:
            return jsonify({"erro": "Regra não encontrada."}), 404
        # A regra também sai da lista do crud.py.
        db.excluir_da_memoria(anterior["nome"], anterior["area"])
        return jsonify({"mensagem": "Regra removida."})
    finally:
        conexao_aberta.close()


# ---------------------------------------------------------------------------
# API administrativa — mensagens e configurações
# ---------------------------------------------------------------------------

@app.get("/api/admin/mensagens")
@exigir_sessao_api
def api_listar_mensagens():
    conexao_aberta = conexao()
    try:
        salvas = {
            linha["nivel"]: linha["texto"]
            for linha in conexao_aberta.execute(
                "SELECT nivel, texto FROM mensagens"
            ).fetchall()
        }
    finally:
        conexao_aberta.close()
    return jsonify(
        [
            {"nivel": nivel, "texto": salvas.get(nivel, db.MENSAGENS_PADRAO[nivel])}
            for nivel in db.NIVEIS
        ]
    )


@app.put("/api/admin/mensagens/<nivel>")
@exigir_sessao_api
def api_atualizar_mensagem(nivel: str):
    validar_nivel(nivel)
    corpo = ler_corpo()
    texto = texto_obrigatorio(corpo.get("texto"), "Mensagem", 600)
    conexao_aberta = conexao()
    try:
        conexao_aberta.execute(
            """
            INSERT INTO mensagens (nivel, texto) VALUES (?, ?)
            ON CONFLICT(nivel) DO UPDATE SET texto = excluded.texto
            """,
            (nivel, texto),
        )
        conexao_aberta.commit()
        return jsonify({"mensagem": "Mensagem atualizada."})
    finally:
        conexao_aberta.close()


@app.get("/api/admin/configuracoes")
@exigir_sessao_api
def api_obter_configuracoes():
    return jsonify({"limiar_gargalo": obter_limiar()})


@app.put("/api/admin/configuracoes")
@exigir_sessao_api
def api_salvar_configuracoes():
    corpo = ler_corpo()
    try:
        limiar = int(corpo.get("limiar_gargalo"))
    except (TypeError, ValueError) as erro:
        raise ErroValidacao("Informe um limiar numérico.") from erro
    if limiar < 0 or limiar > 100:
        raise ErroValidacao("O limiar deve ficar entre 0 e 100%.")

    conexao_aberta = conexao()
    try:
        conexao_aberta.execute(
            """
            INSERT INTO configuracoes (chave, valor) VALUES ('limiar_gargalo', ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
            """,
            (str(limiar),),
        )
        conexao_aberta.commit()
        return jsonify({"limiar_gargalo": limiar, "mensagem": "Limiar atualizado."})
    finally:
        conexao_aberta.close()


# ---------------------------------------------------------------------------
# Inicialização
# ---------------------------------------------------------------------------

def avisar_configuracao() -> None:
    """Deixa no log da hospedagem o que ainda está com valor de exemplo."""
    if ADMIN_SENHA == "admin123":
        print("[AVISO] Senha inicial do painel é 'admin123'. Defina SENTINELA_ADMIN_SENHA.")
    if SECRET_KEY == "dev-secret-mude-isto":
        print("[AVISO] SECRET_KEY de desenvolvimento. Defina SENTINELA_SECRET_KEY.")
    print("[Sentinela] Banco: Postgres externo (SENTINELA_DB_URL)")
    print(f"[Sentinela] Usuário admin: {ADMIN_USUARIO}")
    print("[Sentinela] Código de instalação: painel → seção 06 · Instalação.")


avisar_configuracao()
