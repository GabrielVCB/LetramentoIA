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

MATRIZ = [
    {
        "nome": "RH",
        "descricao": "Dados pessoais, remuneração e vínculos de colaboradores.",
        "regras": [
            ("CPF", "regex", r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", "alto"),
            ("Nome do funcionário", "palavra-chave", "nome do funcionário, nome do colaborador", "baixo"),
            ("Cargo ou função", "palavra-chave", "cargo atual, função exercida", "baixo"),
            ("Salário", "palavra-chave", "salário, salario, remuneração, holerite", "alto"),
            ("Dados bancários", "palavra-chave", "dados bancários, agência, conta salário, chave pix", "alto"),
        ],
    },
    {
        "nome": "Financeiro",
        "descricao": "Valores, orçamento e resultados da companhia.",
        "regras": [
            ("Nome de conta ou setor", "palavra-chave", "centro de custo, nome da conta, setor financeiro", "baixo"),
            ("Valor de despesa", "regex", r"R\$\s?\d[\d.,]*", "medio"),
            ("Orçamento interno", "palavra-chave", "orçamento, orcamento, budget", "medio"),
            ("Faturamento", "palavra-chave", "faturamento, receita bruta, receita anual", "alto"),
            ("Dados bancários da empresa", "palavra-chave", "dados bancários da empresa, conta da empresa, cnpj", "alto"),
        ],
    },
    {
        "nome": "TI",
        "descricao": "Infraestrutura, credenciais e código proprietário.",
        "regras": [
            ("Nome de software", "palavra-chave", "versão do software, licença do software", "baixo"),
            ("Mensagem de erro genérica", "palavra-chave", "mensagem de erro, erro 500, stack trace", "baixo"),
            ("IP ou servidor interno", "regex", r"\b(?:10|192\.168)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "alto"),
            ("Código-fonte interno", "palavra-chave", "código-fonte, codigo fonte, repositório interno", "alto"),
            ("Senha ou credencial", "regex", r"(?:senha|password|pwd|credencial)\s*[:=]", "alto"),
            ("Token ou chave de API", "regex", r"\b(?:sk-[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,})", "alto"),
        ],
    },
    {
        "nome": "Jurídico",
        "descricao": "Contratos, fornecedores e cláusulas.",
        "regras": [
            ("Nome de fornecedor", "palavra-chave", "fornecedor, prestador de serviço", "baixo"),
            ("Número de contrato", "palavra-chave", "número do contrato, numero do contrato, contrato nº", "medio"),
            ("Valor de contrato", "palavra-chave", "valor do contrato, valor contratual", "alto"),
            ("Cláusulas contratuais", "palavra-chave", "cláusula, clausula, cláusulas contratuais", "alto"),
        ],
    },
    {
        "nome": "Projetos e Estratégias",
        "descricao": "Roadmap, lançamentos e movimentos competitivos.",
        "regras": [
            ("Nome de projeto interno", "palavra-chave", "projeto interno, codinome do projeto, nome do projeto", "medio"),
            ("Cronograma de projeto", "palavra-chave", "cronograma, roadmap, marcos do projeto", "medio"),
            ("Produto não lançado", "palavra-chave", "produto não lançado, produto nao lancado, lançamento confidencial", "alto"),
            ("Estratégia de negócio", "palavra-chave", "estratégia, estrategia, plano estratégico, fusão, aquisição", "alto"),
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


def inicializar_banco(usuario: str, senha: str) -> None:
    """Cria o esquema, semeia a matriz e garante o administrador inicial."""
    conexao = conectar()
    try:
        conexao.executescript(ESQUEMA)
        total_areas = conexao.execute("SELECT COUNT(*) FROM areas").fetchone()[0]

        if total_areas == 0:
            for area in MATRIZ:
                cursor = conexao.execute(
                    "INSERT INTO areas (nome, descricao) VALUES (?, ?)",
                    (area["nome"], area["descricao"]),
                )
                area_id = cursor.lastrowid
                conexao.executemany(
                    """
                    INSERT INTO regras (area_id, nome, tipo, padrao, risco, ativo)
                    VALUES (?, ?, ?, ?, ?, 1)
                    """,
                    [
                        (area_id, nome, tipo, padrao, risco)
                        for nome, tipo, padrao, risco in area["regras"]
                    ],
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
