"""
Sentinela — acesso ao banco (Postgres na nuvem ou SQLite na própria máquina).

Cria as tabelas, semeia a matriz de risco e as mensagens educativas e garante o
usuário administrador inicial.

O banco é escolhido pela variável SENTINELA_DB_URL:
    - definida com um endereço postgres://...  -> Postgres externo (nuvem)
    - ausente                                  -> arquivo SQLite ao lado do código

Todo acesso é feito com consultas parametrizadas por quem usa este módulo.
"""
import os
import secrets
import sqlite3
from datetime import datetime

from werkzeug.security import generate_password_hash

CAMINHO_PADRAO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentinela.db")

# Banco externo da nuvem. Aceita também o nome DATABASE_URL, usado por vários
# painéis de hospedagem. Sem nenhuma das duas, vale o arquivo SQLite local.
URL_BANCO = (
    os.environ.get("SENTINELA_DB_URL") or os.environ.get("DATABASE_URL") or ""
).strip()

try:  # o psycopg só é necessário quando existe um Postgres configurado
    import psycopg
    from psycopg.rows import dict_row

except ImportError:  # pragma: no cover - instalação mínima, só com SQLite
    psycopg = None
    dict_row = None

ERROS_INTEGRIDADE = (
    (sqlite3.IntegrityError,)
    if psycopg is None
    else (sqlite3.IntegrityError, psycopg.errors.IntegrityError)
)

NIVEIS = ("baixo", "medio", "alto")
ACOES = ("enviou", "cancelou")
TIPOS_REGRA = ("regex", "palavra-chave")
ORIGENS = ("texto", "colagem", "imagem", "pdf", "anexo")

# Versão da matriz de risco. Ao subir a versão, as regras semeadas são
# atualizadas (padrão, tipo e risco), preservando regras criadas no painel.
VERSAO_MATRIZ = "2"

# As regras de palavra-chave são bilíngues: português e inglês no mesmo campo,
# separados por vírgula. A busca ignora acentos e maiúsculas.
MATRIZ = [
    {
        "nome": "RH",
        "descricao": (
            "Dados pessoais, documentos, remuneração e vínculos de colaboradores. "
            "Acesso restrito ao time de pessoas."
        ),
        "regras": [
            ("CPF", "regex", r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", "alto"),
            (
                "Nome do funcionário",
                "palavra-chave",
                "nome do funcionário, nome do colaborador, ficha do colaborador, "
                "employee name, employee record, staff name",
                "baixo",
            ),
            (
                "Cargo ou função",
                "palavra-chave",
                "cargo atual, função exercida, cargo de, job title, job role, "
                "position at the company",
                "baixo",
            ),
            (
                "Salário",
                "palavra-chave",
                "salário, salario, remuneração, remuneracao, holerite, contracheque, "
                "salary, payroll, compensation, payslip, wage",
                "alto",
            ),
            (
                "Dados bancários",
                "palavra-chave",
                "dados bancários, dados bancarios, agência, agencia, conta salário, "
                "conta salario, chave pix, bank account, account number, routing number, "
                "iban, sort code",
                "alto",
            ),
            (
                "Documento de identidade",
                "palavra-chave",
                "carteira de identidade, documento de identidade, rg, cnh, passaporte, "
                "passport, driver's license, national id, social security",
                "alto",
            ),
            (
                "Data de nascimento",
                "palavra-chave",
                "data de nascimento, nascimento, date of birth, birth date, dob",
                "medio",
            ),
            (
                "Endereço residencial",
                "palavra-chave",
                "endereço residencial, endereco residencial, endereço completo, "
                "home address, street address, residential address",
                "medio",
            ),
            (
                "Dados de saúde",
                "palavra-chave",
                "dados de saúde, dados de saude, diagnóstico, diagnostico, "
                "atestado médico, atestado medico, licença médica, licenca medica, "
                "biometria, health data, medical record, diagnosis, sick leave, biometric",
                "alto",
            ),
            (
                "Avaliação de desempenho",
                "palavra-chave",
                "avaliação de desempenho, avaliacao de desempenho, feedback do gestor, "
                "performance review, employee evaluation",
                "medio",
            ),
        ],
    },
    {
        "nome": "Financeiro",
        "descricao": "Valores, orçamento e resultados da companhia. Publicação somente em canais aprovados.",
        "regras": [
            (
                "Nome de conta ou setor",
                "palavra-chave",
                "centro de custo, nome da conta, setor financeiro, cost center, "
                "account name, finance department",
                "baixo",
            ),
            ("Valor de despesa", "regex", r"(?:R\$|US\$)\s?\d[\d.,]*|\$\s?\d[\d.,]{2,}", "medio"),
            (
                "Orçamento interno",
                "palavra-chave",
                "orçamento, orcamento, budget, budget plan, planejamento orçamentário",
                "medio",
            ),
            (
                "Faturamento",
                "palavra-chave",
                "faturamento, receita bruta, receita anual, revenue, gross revenue, "
                "annual revenue, sales figures",
                "alto",
            ),
            (
                "Dados bancários da empresa",
                "palavra-chave",
                "dados bancários da empresa, dados bancarios da empresa, conta da empresa, "
                "cnpj, company bank account, business account, swift code",
                "alto",
            ),
            (
                "Nota fiscal ou pedido",
                "palavra-chave",
                "nota fiscal, pedido de compra, purchase order, invoice number, billing details",
                "medio",
            ),
            (
                "Previsão de resultados",
                "palavra-chave",
                "previsão de resultados, previsao de resultados, projeção de receita, "
                "projecao de receita, guidance, earnings forecast, profit forecast",
                "alto",
            ),
        ],
    },
    {
        "nome": "TI",
        "descricao": "Infraestrutura, credenciais e código proprietário. Nunca deve ser colado em ferramentas externas.",
        "regras": [
            (
                "Nome de software",
                "palavra-chave",
                "versão do software, versao do software, licença do software, "
                "software version, software license",
                "baixo",
            ),
            (
                "Mensagem de erro genérica",
                "palavra-chave",
                "mensagem de erro, erro 500, stack trace, error message, exception, "
                "error log, traceback",
                "baixo",
            ),
            (
                "IP ou servidor interno",
                "regex",
                r"\b(?:10|192\.168)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|"
                r"\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b",
                "alto",
            ),
            (
                "Código-fonte interno",
                "palavra-chave",
                "código-fonte, codigo fonte, repositório interno, repositorio interno, "
                "branch privada, source code, private repository, proprietary code, internal repo",
                "alto",
            ),
            (
                "Senha ou credencial",
                "regex",
                r"(?:senha|password|passwd|pwd|credencial|credential)\s*[:=]",
                "alto",
            ),
            (
                "Token ou chave de API",
                "regex",
                r"\b(?:sk-[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|"
                r"AIza[A-Za-z0-9_-]{20,})",
                "alto",
            ),
            (
                "Chave privada",
                "regex",
                r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
                "alto",
            ),
            (
                "String de conexão",
                "regex",
                r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql)://[^\s\"']+",
                "alto",
            ),
            (
                "URL com token de sessão",
                "regex",
                r"https?://[^\s'\"<>]*[?&](?:token|access_token|signature|"
                r"X-Amz-Signature|sig|key)=[^\s&]+",
                "alto",
            ),
            (
                "Credencial em URL",
                "regex",
                r"\b[a-z0-9._%-]+:[^\s@/]{4,}@[a-z0-9.-]+\.[a-z]{2,}\b",
                "alto",
            ),
        ],
    },
    {
        "nome": "Segurança da Informação",
        "descricao": (
            "As causas mais comuns de incidentes: credenciais expostas, backups, "
            "dados de clientes e informação marcada como confidencial."
        ),
        "regras": [
            (
                "Documento confidencial",
                "palavra-chave",
                "confidencial, uso interno, não divulgar, nao divulgar, nda, "
                "confidential, internal use only, do not distribute, restricted",
                "medio",
            ),
            (
                "Código de verificação ou MFA",
                "palavra-chave",
                "código de verificação, codigo de verificacao, código de recuperação, "
                "codigo de recuperacao, one-time password, otp, 2fa code, mfa code, "
                "recovery code",
                "alto",
            ),
            (
                "Dump ou backup de banco",
                "palavra-chave",
                "dump do banco, backup do banco, exportação do banco, exportacao do banco, "
                "database dump, database backup, sql dump, .sql, .bak",
                "alto",
            ),
            (
                "Dados de clientes",
                "palavra-chave",
                "lista de clientes, base de clientes, dados de clientes, "
                "exportação do crm, exportacao do crm, leads, customer list, client list, "
                "customer database, prospect list",
                "alto",
            ),
            (
                "Acesso remoto ou VPN",
                "palavra-chave",
                "credenciais de vpn, acesso vpn, acesso remoto, remote access, "
                "vpn credentials, rdp, ssh access",
                "alto",
            ),
            (
                "Relatório de vulnerabilidade",
                "palavra-chave",
                "relatório de vulnerabilidade, relatorio de vulnerabilidade, cve-, "
                "exploit, penetration test, pentest, security audit",
                "medio",
            ),
            (
                "Arquivo de ambiente",
                "palavra-chave",
                ".env, variáveis de ambiente, variaveis de ambiente, environment variables, "
                "dotenv, secrets manager",
                "medio",
            ),
        ],
    },
    {
        "nome": "Jurídico",
        "descricao": "Contratos, fornecedores e cláusulas. Compartilhamento exige revisão da área jurídica.",
        "regras": [
            (
                "Nome de fornecedor",
                "palavra-chave",
                "fornecedor, prestador de serviço, prestador de servico, supplier, vendor, "
                "third-party contract",
                "baixo",
            ),
            (
                "Número de contrato",
                "palavra-chave",
                "número do contrato, numero do contrato, contrato nº, contrato n°, "
                "contract number, agreement number",
                "medio",
            ),
            (
                "Valor de contrato",
                "palavra-chave",
                "valor do contrato, valor contratual, contract value, contract amount, "
                "total contract value",
                "alto",
            ),
            (
                "Cláusulas contratuais",
                "palavra-chave",
                "cláusula, clausula, cláusulas contratuais, clausulas contratuais, "
                "contract clause, nda terms, indemnity clause",
                "alto",
            ),
            (
                "Processo judicial",
                "palavra-chave",
                "processo judicial, ação judicial, acao judicial, litigation, lawsuit, "
                "settlement, legal claim",
                "alto",
            ),
        ],
    },
    {
        "nome": "Projetos e Estratégias",
        "descricao": "Roadmap, lançamentos e movimentos competitivos. Informação estratégica antes do anúncio oficial.",
        "regras": [
            (
                "Nome de projeto interno",
                "palavra-chave",
                "projeto interno, codinome do projeto, nome do projeto, project code name, "
                "internal project, confidential project",
                "medio",
            ),
            (
                "Cronograma de projeto",
                "palavra-chave",
                "cronograma, roadmap, marcos do projeto, project timeline, launch schedule, "
                "milestones",
                "medio",
            ),
            (
                "Produto não lançado",
                "palavra-chave",
                "produto não lançado, produto nao lancado, lançamento confidencial, "
                "lancamento confidencial, unreleased product, unannounced product, "
                "stealth launch",
                "alto",
            ),
            (
                "Estratégia de negócio",
                "palavra-chave",
                "estratégia, estrategia, plano estratégico, plano estrategico, fusão, fusao, "
                "aquisição, aquisicao, business strategy, strategic plan, merger, acquisition, "
                "go-to-market",
                "alto",
            ),
            (
                "Precificação ou proposta",
                "palavra-chave",
                "precificação, precificacao, tabela de preços, tabela de precos, "
                "proposta comercial, pricing, price list, quote, commercial proposal",
                "alto",
            ),
        ],
    },
]

# Texto usado pela versão 2.1. Bancos antigos são atualizados para a mensagem
# nova apenas enquanto o administrador não tiver editado o texto.
MENSAGEM_BAIXO_ANTERIOR = (
    "Não foram identificados os tipos de informações corporativas analisados pelo sistema. "
    "Ainda assim, revise o conteúdo antes de compartilhá-lo."
)

MENSAGENS_PADRAO = {
    "baixo": (
        "Nenhum dado de risco médio ou alto foi identificado neste conteúdo. Revise antes de "
        "compartilhar: o envio fica registrado no painel de governança."
    ),
    "medio": (
        "Esta informação contém dados internos que podem apresentar riscos à empresa. Evite "
        "compartilhar informações desnecessárias e verifique as regras de uso de IA da empresa "
        "antes do compartilhamento."
    ),
    "alto": (
        "Esta informação contém dados confidenciais, pessoais, estratégicos ou relacionados à "
        "segurança da empresa. Não compartilhe com uma IA pública. Remova os dados sensíveis ou "
        "utilize uma ferramenta de IA corporativa autorizada."
    ),
}

ESQUEMA = """
CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT
);

CREATE TABLE IF NOT EXISTS regras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('regex', 'palavra-chave')),
    padrao TEXT NOT NULL,
    risco TEXT NOT NULL CHECK (risco IN ('baixo', 'medio', 'alto')),
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_regras_area ON regras(area_id);

CREATE TABLE IF NOT EXISTS mensagens (
    nivel TEXT PRIMARY KEY CHECK (nivel IN ('baixo', 'medio', 'alto')),
    texto TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id TEXT,
    origem TEXT NOT NULL DEFAULT 'texto',
    data_hora TEXT NOT NULL,
    site TEXT NOT NULL,
    departamento TEXT NOT NULL,
    colaborador TEXT,
    ip TEXT,
    nivel_risco TEXT NOT NULL CHECK (nivel_risco IN ('baixo', 'medio', 'alto')),
    acao TEXT NOT NULL CHECK (acao IN ('enviou', 'cancelou'))
);

CREATE INDEX IF NOT EXISTS idx_alertas_data ON alertas(data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_departamento ON alertas(departamento);
CREATE INDEX IF NOT EXISTS idx_alertas_nivel ON alertas(nivel_risco);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_evento ON alertas(evento_id)
    WHERE evento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS alerta_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alerta_id INTEGER NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
    tipo_detectado TEXT NOT NULL,
    risco TEXT NOT NULL CHECK (risco IN ('baixo', 'medio', 'alto')),
    area TEXT
);

CREATE INDEX IF NOT EXISTS idx_itens_alerta ON alerta_itens(alerta_id);

CREATE TABLE IF NOT EXISTS usuarios_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
"""

# Mesmo esquema, no dialeto do Postgres. O servidor cria as tabelas sozinho no
# primeiro acesso ao banco da nuvem: não é preciso rodar SQL na mão.
ESQUEMA_POSTGRES = """
CREATE TABLE IF NOT EXISTS areas (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    nome text NOT NULL UNIQUE,
    descricao text
);

CREATE TABLE IF NOT EXISTS regras (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    area_id integer NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    nome text NOT NULL,
    tipo text NOT NULL CHECK (tipo IN ('regex', 'palavra-chave')),
    padrao text NOT NULL,
    risco text NOT NULL CHECK (risco IN ('baixo', 'medio', 'alto')),
    ativo integer NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_regras_area ON regras(area_id);

CREATE TABLE IF NOT EXISTS mensagens (
    nivel text PRIMARY KEY CHECK (nivel IN ('baixo', 'medio', 'alto')),
    texto text NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    evento_id text,
    origem text NOT NULL DEFAULT 'texto',
    data_hora text NOT NULL,
    site text NOT NULL,
    departamento text NOT NULL,
    colaborador text,
    ip text,
    nivel_risco text NOT NULL CHECK (nivel_risco IN ('baixo', 'medio', 'alto')),
    acao text NOT NULL CHECK (acao IN ('enviou', 'cancelou'))
);

CREATE INDEX IF NOT EXISTS idx_alertas_data ON alertas(data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_departamento ON alertas(departamento);
CREATE INDEX IF NOT EXISTS idx_alertas_nivel ON alertas(nivel_risco);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_evento ON alertas(evento_id)
    WHERE evento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS alerta_itens (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    alerta_id integer NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
    tipo_detectado text NOT NULL,
    risco text NOT NULL CHECK (risco IN ('baixo', 'medio', 'alto')),
    area text
);

CREATE INDEX IF NOT EXISTS idx_itens_alerta ON alerta_itens(alerta_id);

CREATE TABLE IF NOT EXISTS usuarios_admin (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    usuario text NOT NULL UNIQUE,
    senha_hash text NOT NULL,
    criado_em text NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
    chave text PRIMARY KEY,
    valor text NOT NULL
);
"""


def caminho_banco() -> str:
    """Permite trocar o arquivo do banco em testes (variável de ambiente)."""
    return os.environ.get("SENTINELA_DB", CAMINHO_PADRAO)


def usando_postgres() -> bool:
    """Verdadeiro quando SENTINELA_DB_URL aponta para um Postgres externo."""
    return URL_BANCO.startswith(("postgres://", "postgresql://"))


def descricao_banco() -> str:
    """Texto curto do banco em uso, para o log e para o painel."""
    if usando_postgres():
        return "Postgres externo (SENTINELA_DB_URL)"
    return f"SQLite local ({caminho_banco()})"


def _traduzir_sql(texto: str, parametros) -> str:
    """Ajusta o SQL escrito no estilo SQLite para o dialeto do Postgres.

    Só duas construções precisam de tradução; o restante do SQL é comum aos
    dois bancos: `GROUP_CONCAT(x, sep)` vira `string_agg(x, sep)` e o marcador
    `?` vira `%s`. Em consultas com parâmetros, o sinal `%` literal do texto
    (por exemplo em um LIKE '%termo%') precisa ser duplicado para o psycopg.
    """
    if not usando_postgres():
        return texto
    texto = texto.replace("GROUP_CONCAT(", "string_agg(")
    if parametros:
        texto = texto.replace("%", "%%")
    return texto.replace("?", "%s")


class _Cursor:
    """Cursor com a mesma interface nos dois bancos."""

    def __init__(self, cursor, ultimo_id=None):
        self._cursor = cursor
        self.rowcount = getattr(cursor, "rowcount", -1)
        self.lastrowid = ultimo_id

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def __iter__(self):
        return iter(self._cursor)


class _Conexao:
    """Conexão com execute/executemany/commit/rollback/close iguais nos dois bancos."""

    def __init__(self, conexao):
        self._conexao = conexao

    def execute(self, sql: str, parametros=None) -> _Cursor:
        cursor = self._conexao.cursor()
        consulta = _traduzir_sql(sql, parametros)
        if parametros is None:
            cursor.execute(consulta)
        else:
            cursor.execute(consulta, parametros)
        return _Cursor(cursor, getattr(cursor, "lastrowid", None))

    def executemany(self, sql: str, sequencia) -> _Cursor:
        cursor = self._conexao.cursor()
        cursor.executemany(_traduzir_sql(sql, sequencia), sequencia)
        return _Cursor(cursor)

    def executescript(self, script: str) -> None:
        if not usando_postgres():
            self._conexao.executescript(script)
            return
        # O psycopg executa um comando por vez: o script de criação das tabelas
        # é enviado separado por ponto e vírgula.
        for comando in script.split(";"):
            if comando.strip():
                self.execute(comando)

    def commit(self) -> None:
        self._conexao.commit()

    def rollback(self) -> None:
        self._conexao.rollback()

    def close(self) -> None:
        self._conexao.close()


def conectar() -> _Conexao:
    """Abre conexão com chaves estrangeiras ativas e linhas acessíveis por nome."""
    if usando_postgres():
        if psycopg is None:
            raise RuntimeError(
                "SENTINELA_DB_URL está definido, mas o pacote psycopg não está "
                "instalado. Rode: pip install -r requirements.txt"
            )
        return _Conexao(
            psycopg.connect(
                URL_BANCO,
                row_factory=dict_row,
                connect_timeout=15,
                # O pooler do Supabase (porta 6543) recusa prepared statements.
                prepare_threshold=None,
            )
        )

    conexao = sqlite3.connect(caminho_banco())
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA foreign_keys = ON")
    return _Conexao(conexao)


def inserir_id(conexao_aberta: _Conexao, sql: str, parametros) -> int:
    """Executa um INSERT e devolve o id criado.

    No SQLite o id vem de lastrowid; no Postgres é preciso pedir RETURNING.
    """
    if usando_postgres():
        cursor = conexao_aberta.execute(
            sql.rstrip().rstrip(";") + " RETURNING id", parametros
        )
        linha = cursor.fetchone()
        return linha["id"] if linha else None
    return conexao_aberta.execute(sql, parametros).lastrowid


def _colunas(conexao_aberta: _Conexao, tabela: str) -> set:
    return {
        linha["name"] for linha in conexao_aberta.execute(f"PRAGMA table_info({tabela})")
    }


def _atualizar_para_v2(conexao_aberta: _Conexao) -> None:
    """Adiciona colunas novas em bancos SQLite criados por uma versão anterior."""
    colunas = _colunas(conexao_aberta, "alertas")
    if "evento_id" not in colunas:
        conexao_aberta.execute("ALTER TABLE alertas ADD COLUMN evento_id TEXT")
    if "origem" not in colunas:
        conexao_aberta.execute(
            "ALTER TABLE alertas ADD COLUMN origem TEXT NOT NULL DEFAULT 'texto'"
        )
    # 2.2: o servidor na nuvem registra o IP de origem de cada alerta.
    if "ip" not in colunas:
        conexao_aberta.execute("ALTER TABLE alertas ADD COLUMN ip TEXT")
    conexao_aberta.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_evento ON alertas(evento_id) "
        "WHERE evento_id IS NOT NULL"
    )


def _atualizar_para_postgres(conexao_aberta: _Conexao) -> None:
    """Mesma atualização de colunas, para bancos Postgres já existentes."""
    conexao_aberta.execute("ALTER TABLE alertas ADD COLUMN IF NOT EXISTS evento_id text")
    conexao_aberta.execute(
        "ALTER TABLE alertas ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'texto'"
    )
    conexao_aberta.execute("ALTER TABLE alertas ADD COLUMN IF NOT EXISTS ip text")


def _semear_matriz(conexao_aberta: _Conexao, forcar_atualizacao: bool) -> None:
    for area in MATRIZ:
        linha = conexao_aberta.execute(
            "SELECT id FROM areas WHERE nome = ?", (area["nome"],)
        ).fetchone()
        if linha is None:
            area_id = inserir_id(
                conexao_aberta,
                "INSERT INTO areas (nome, descricao) VALUES (?, ?)",
                (area["nome"], area["descricao"]),
            )
        else:
            area_id = linha["id"]
            if forcar_atualizacao:
                conexao_aberta.execute(
                    "UPDATE areas SET descricao = ? WHERE id = ?",
                    (area["descricao"], area_id),
                )

        for nome, tipo, padrao, risco in area["regras"]:
            existente = conexao_aberta.execute(
                "SELECT id FROM regras WHERE area_id = ? AND nome = ?",
                (area_id, nome),
            ).fetchone()
            if existente is None:
                conexao_aberta.execute(
                    """
                    INSERT INTO regras (area_id, nome, tipo, padrao, risco, ativo)
                    VALUES (?, ?, ?, ?, ?, 1)
                    """,
                    (area_id, nome, tipo, padrao, risco),
                )
            elif forcar_atualizacao:
                conexao_aberta.execute(
                    "UPDATE regras SET tipo = ?, padrao = ?, risco = ? WHERE id = ?",
                    (tipo, padrao, risco, existente["id"]),
                )


def inicializar_banco(usuario: str, senha: str) -> None:
    """Cria o esquema, sincroniza a matriz e garante o administrador inicial."""
    conexao_aberta = conectar()
    try:
        if usando_postgres():
            conexao_aberta.executescript(ESQUEMA_POSTGRES)
            _atualizar_para_postgres(conexao_aberta)
        else:
            conexao_aberta.executescript(ESQUEMA)
            _atualizar_para_v2(conexao_aberta)

        versao = conexao_aberta.execute(
            "SELECT valor FROM configuracoes WHERE chave = 'matriz_versao'"
        ).fetchone()
        atualizar = versao is None or versao["valor"] != VERSAO_MATRIZ
        _semear_matriz(conexao_aberta, atualizar)

        if atualizar:
            conexao_aberta.execute(
                """
                INSERT INTO configuracoes (chave, valor) VALUES ('matriz_versao', ?)
                ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
                """,
                (VERSAO_MATRIZ,),
            )

        for nivel, texto in MENSAGENS_PADRAO.items():
            conexao_aberta.execute(
                """
                INSERT INTO mensagens (nivel, texto) VALUES (?, ?)
                ON CONFLICT(nivel) DO NOTHING
                """,
                (nivel, texto),
            )

        # 2.2: o aviso de risco baixo passou a aparecer com conteúdo detectado,
        # então o texto antigo (“nada foi identificado”) deixou de fazer sentido.
        conexao_aberta.execute(
            "UPDATE mensagens SET texto = ? WHERE nivel = 'baixo' AND texto = ?",
            (MENSAGENS_PADRAO["baixo"], MENSAGEM_BAIXO_ANTERIOR),
        )

        conexao_aberta.execute(
            """
            INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
            ON CONFLICT(chave) DO NOTHING
            """,
            ("limiar_gargalo", "30"),
        )

        # 2.2: código de instalação usado pelas extensões quando o servidor está
        # publicado na internet. Gerado uma vez e guardado no banco.
        conexao_aberta.execute(
            """
            INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
            ON CONFLICT(chave) DO NOTHING
            """,
            ("api_token", secrets.token_urlsafe(32)),
        )

        existente = conexao_aberta.execute(
            "SELECT id FROM usuarios_admin WHERE LOWER(usuario) = LOWER(?)", (usuario,)
        ).fetchone()
        if not existente:
            conexao_aberta.execute(
                "INSERT INTO usuarios_admin (usuario, senha_hash, criado_em) VALUES (?, ?, ?)",
                (usuario, generate_password_hash(senha), datetime.now().isoformat(timespec="seconds")),
            )

        conexao_aberta.commit()
    finally:
        conexao_aberta.close()


def ler_configuracao(chave: str, padrao: str = "") -> str:
    """Lê um valor da tabela de configurações."""
    conexao_aberta = conectar()
    try:
        linha = conexao_aberta.execute(
            "SELECT valor FROM configuracoes WHERE chave = ?", (chave,)
        ).fetchone()
        return linha["valor"] if linha else padrao
    finally:
        conexao_aberta.close()


def gravar_configuracao(chave: str, valor: str) -> None:
    conexao_aberta = conectar()
    try:
        conexao_aberta.execute(
            """
            INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
            """,
            (chave, valor),
        )
        conexao_aberta.commit()
    finally:
        conexao_aberta.close()


def token_api() -> str:
    """Código de instalação que as extensões enviam para o servidor."""
    return ler_configuracao("api_token")


def renovar_token_api() -> str:
    novo = secrets.token_urlsafe(32)
    gravar_configuracao("api_token", novo)
    return novo


def listar_admins() -> list:
    conexao_aberta = conectar()
    try:
        linhas = conexao_aberta.execute(
            "SELECT id, usuario, criado_em FROM usuarios_admin ORDER BY LOWER(usuario)"
        ).fetchall()
        return [dict(linha) for linha in linhas]
    finally:
        conexao_aberta.close()


def criar_admin(usuario: str, senha: str) -> int:
    conexao_aberta = conectar()
    try:
        novo_id = inserir_id(
            conexao_aberta,
            "INSERT INTO usuarios_admin (usuario, senha_hash, criado_em) VALUES (?, ?, ?)",
            (usuario, generate_password_hash(senha), datetime.now().isoformat(timespec="seconds")),
        )
        conexao_aberta.commit()
        return novo_id
    finally:
        conexao_aberta.close()


def remover_admin(admin_id: int) -> int:
    conexao_aberta = conectar()
    try:
        cursor = conexao_aberta.execute(
            "DELETE FROM usuarios_admin WHERE id = ?", (admin_id,)
        )
        conexao_aberta.commit()
        return cursor.rowcount
    finally:
        conexao_aberta.close()


def trocar_senha_admin(admin_id: int, senha: str) -> int:
    conexao_aberta = conectar()
    try:
        cursor = conexao_aberta.execute(
            "UPDATE usuarios_admin SET senha_hash = ? WHERE id = ?",
            (generate_password_hash(senha), admin_id),
        )
        conexao_aberta.commit()
        return cursor.rowcount
    finally:
        conexao_aberta.close()


def total_admins() -> int:
    conexao_aberta = conectar()
    try:
        return conexao_aberta.execute(
            "SELECT COUNT(*) AS total FROM usuarios_admin"
        ).fetchone()["total"]
    finally:
        conexao_aberta.close()
