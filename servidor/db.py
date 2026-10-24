"""
Sentinela — banco SQLite (biblioteca padrão).

Cria as tabelas, ativa chaves estrangeiras, semeia a matriz de risco e as
mensagens educativas e garante o usuário administrador inicial.

Todo acesso é feito com consultas parametrizadas por quem usa este módulo.
"""
import os
import sqlite3
from datetime import datetime

from werkzeug.security import generate_password_hash

CAMINHO_PADRAO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentinela.db")

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

MENSAGENS_PADRAO = {
    "baixo": (
        "Não foram identificados os tipos de informações corporativas analisados pelo sistema. "
        "Ainda assim, revise o conteúdo antes de compartilhá-lo."
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


def caminho_banco() -> str:
    """Permite trocar o arquivo do banco em testes (variável de ambiente)."""
    return os.environ.get("SENTINELA_DB", CAMINHO_PADRAO)


def conectar() -> sqlite3.Connection:
    """Abre conexão com chaves estrangeiras ativas e linhas acessíveis por nome."""
    conexao = sqlite3.connect(caminho_banco())
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA foreign_keys = ON")
    return conexao


def _colunas(conexao: sqlite3.Connection, tabela: str) -> set:
    return {linha["name"] for linha in conexao.execute(f"PRAGMA table_info({tabela})")}


def _atualizar_para_v2(conexao: sqlite3.Connection) -> None:
    """Adiciona colunas novas em bancos criados pela versão anterior."""
    colunas = _colunas(conexao, "alertas")
    if "evento_id" not in colunas:
        conexao.execute("ALTER TABLE alertas ADD COLUMN evento_id TEXT")
    if "origem" not in colunas:
        conexao.execute("ALTER TABLE alertas ADD COLUMN origem TEXT NOT NULL DEFAULT 'texto'")
    conexao.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_evento ON alertas(evento_id) "
        "WHERE evento_id IS NOT NULL"
    )


def _semear_matriz(conexao: sqlite3.Connection, forcar_atualizacao: bool) -> None:
    for area in MATRIZ:
        linha = conexao.execute(
            "SELECT id FROM areas WHERE nome = ?", (area["nome"],)
        ).fetchone()
        if linha is None:
            cursor = conexao.execute(
                "INSERT INTO areas (nome, descricao) VALUES (?, ?)",
                (area["nome"], area["descricao"]),
            )
            area_id = cursor.lastrowid
        else:
            area_id = linha["id"]
            if forcar_atualizacao:
                conexao.execute(
                    "UPDATE areas SET descricao = ? WHERE id = ?",
                    (area["descricao"], area_id),
                )

        for nome, tipo, padrao, risco in area["regras"]:
            existente = conexao.execute(
                "SELECT id FROM regras WHERE area_id = ? AND nome = ?",
                (area_id, nome),
            ).fetchone()
            if existente is None:
                conexao.execute(
                    """
                    INSERT INTO regras (area_id, nome, tipo, padrao, risco, ativo)
                    VALUES (?, ?, ?, ?, ?, 1)
                    """,
                    (area_id, nome, tipo, padrao, risco),
                )
            elif forcar_atualizacao:
                conexao.execute(
                    "UPDATE regras SET tipo = ?, padrao = ?, risco = ? WHERE id = ?",
                    (tipo, padrao, risco, existente["id"]),
                )


def inicializar_banco(usuario: str, senha: str) -> None:
    """Cria o esquema, sincroniza a matriz e garante o administrador inicial."""
    conexao = conectar()
    try:
        conexao.executescript(ESQUEMA)
        _atualizar_para_v2(conexao)

        versao = conexao.execute(
            "SELECT valor FROM configuracoes WHERE chave = 'matriz_versao'"
        ).fetchone()
        atualizar = versao is None or versao["valor"] != VERSAO_MATRIZ
        _semear_matriz(conexao, atualizar)

        if atualizar:
            conexao.execute(
                "INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('matriz_versao', ?)",
                (VERSAO_MATRIZ,),
            )

        for nivel, texto in MENSAGENS_PADRAO.items():
            conexao.execute(
                "INSERT OR IGNORE INTO mensagens (nivel, texto) VALUES (?, ?)",
                (nivel, texto),
            )

        conexao.execute(
            "INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)",
            ("limiar_gargalo", "30"),
        )

        existente = conexao.execute(
            "SELECT id FROM usuarios_admin WHERE usuario = ?", (usuario,)
        ).fetchone()
        if not existente:
            conexao.execute(
                "INSERT INTO usuarios_admin (usuario, senha_hash, criado_em) VALUES (?, ?, ?)",
                (usuario, generate_password_hash(senha), datetime.now().isoformat(timespec="seconds")),
            )

        conexao.commit()
    finally:
        conexao.close()
