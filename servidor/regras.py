"""
Este arquivo é o conteúdo: cada chamada registra uma regra usando as funções
de crud.py. Só a lista de regras.

    criar(nome, área, tipo, padrão, risco)

    tipo "regex"          -> padrão é uma expressão regular (CPF, token, IP)
    tipo "palavra-chave"  -> padrão é uma lista de termos, em português e inglês

O db.py importa este arquivo
para copiar a lista para o banco na inicialização do servidor.
"""
import crud

# RH
crud.criar("CPF", "RH", "regex", r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", "alto")
crud.criar(
    "Nome do funcionário",
    "RH",
    "palavra-chave",
    "nome do funcionário, nome do colaborador, ficha do colaborador, "
    "employee name, employee record, staff name",
    "baixo",
)
crud.criar(
    "Cargo ou função",
    "RH",
    "palavra-chave",
    "cargo atual, função exercida, cargo de, job title, job role, "
    "position at the company",
    "baixo",
)
crud.criar(
    "Salário",
    "RH",
    "palavra-chave",
    "salário, salario, remuneração, remuneracao, holerite, contracheque, "
    "salary, payroll, compensation, payslip, wage",
    "alto",
)
crud.criar(
    "Dados bancários",
    "RH",
    "palavra-chave",
    "dados bancários, dados bancarios, agência, agencia, conta salário, "
    "conta salario, chave pix, bank account, account number, routing number, "
    "iban, sort code",
    "alto",
)
crud.criar(
    "Documento de identidade",
    "RH",
    "palavra-chave",
    "carteira de identidade, documento de identidade, rg, cnh, passaporte, "
    "passport, driver's license, national id, social security",
    "alto",
)
crud.criar(
    "Data de nascimento",
    "RH",
    "palavra-chave",
    "data de nascimento, nascimento, date of birth, birth date, dob",
    "medio",
)
crud.criar(
    "Endereço residencial",
    "RH",
    "palavra-chave",
    "endereço residencial, endereco residencial, endereço completo, "
    "home address, street address, residential address",
    "medio",
)
crud.criar(
    "Dados de saúde",
    "RH",
    "palavra-chave",
    "dados de saúde, dados de saude, diagnóstico, diagnostico, "
    "atestado médico, atestado medico, licença médica, licenca medica, "
    "biometria, health data, medical record, diagnosis, sick leave, biometric",
    "alto",
)
crud.criar(
    "Avaliação de desempenho",
    "RH",
    "palavra-chave",
    "avaliação de desempenho, avaliacao de desempenho, feedback do gestor, "
    "performance review, employee evaluation",
    "medio",
)

# Financeiro
crud.criar(
    "Nome de conta ou setor",
    "Financeiro",
    "palavra-chave",
    "centro de custo, nome da conta, setor financeiro, cost center, "
    "account name, finance department",
    "baixo",
)
crud.criar(
    "Valor de despesa",
    "Financeiro",
    "regex",
    r"(?:R\$|US\$)\s?\d[\d.,]*|\$\s?\d[\d.,]{2,}",
    "medio",
)
crud.criar(
    "Orçamento interno",
    "Financeiro",
    "palavra-chave",
    "orçamento, orcamento, budget, budget plan, planejamento orçamentário",
    "medio",
)
crud.criar(
    "Faturamento",
    "Financeiro",
    "palavra-chave",
    "faturamento, receita bruta, receita anual, revenue, gross revenue, "
    "annual revenue, sales figures",
    "alto",
)
crud.criar(
    "Dados bancários da empresa",
    "Financeiro",
    "palavra-chave",
    "dados bancários da empresa, dados bancarios da empresa, conta da empresa, "
    "cnpj, company bank account, business account, swift code",
    "alto",
)
crud.criar(
    "Nota fiscal ou pedido",
    "Financeiro",
    "palavra-chave",
    "nota fiscal, pedido de compra, purchase order, invoice number, billing details",
    "medio",
)
crud.criar(
    "Previsão de resultados",
    "Financeiro",
    "palavra-chave",
    "previsão de resultados, previsao de resultados, projeção de receita, "
    "projecao de receita, guidance, earnings forecast, profit forecast",
    "alto",
)

# TI
crud.criar(
    "Nome de software",
    "TI",
    "palavra-chave",
    "versão do software, versao do software, licença do software, "
    "software version, software license",
    "baixo",
)
crud.criar(
    "Mensagem de erro genérica",
    "TI",
    "palavra-chave",
    "mensagem de erro, erro 500, stack trace, error message, exception, "
    "error log, traceback",
    "baixo",
)
crud.criar(
    "IP ou servidor interno",
    "TI",
    "regex",
    r"\b(?:10|192\.168)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|"
    r"\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b",
    "alto",
)
crud.criar(
    "Código-fonte interno",
    "TI",
    "palavra-chave",
    "código-fonte, codigo fonte, repositório interno, repositorio interno, "
    "branch privada, source code, private repository, proprietary code, internal repo",
    "alto",
)
crud.criar(
    "Senha ou credencial",
    "TI",
    "regex",
    r"(?:senha|password|passwd|pwd|credencial|credential)\s*[:=]",
    "alto",
)
crud.criar(
    "Token ou chave de API",
    "TI",
    "regex",
    r"\b(?:sk-[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|"
    r"AIza[A-Za-z0-9_-]{20,})",
    "alto",
)
crud.criar(
    "Chave privada",
    "TI",
    "regex",
    r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
    "alto",
)
crud.criar(
    "String de conexão",
    "TI",
    "regex",
    r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql)://[^\s\"']+",
    "alto",
)
crud.criar(
    "URL com token de sessão",
    "TI",
    "regex",
    r"https?://[^\s'\"<>]*[?&](?:token|access_token|signature|"
    r"X-Amz-Signature|sig|key)=[^\s&]+",
    "alto",
)
crud.criar(
    "Credencial em URL",
    "TI",
    "regex",
    r"\b[a-z0-9._%-]+:[^\s@/]{4,}@[a-z0-9.-]+\.[a-z]{2,}\b",
    "alto",
)

# Segurança da Informação
crud.criar(
    "Documento confidencial",
    "Segurança da Informação",
    "palavra-chave",
    "confidencial, uso interno, não divulgar, nao divulgar, nda, "
    "confidential, internal use only, do not distribute, restricted",
    "medio",
)
crud.criar(
    "Código de verificação ou MFA",
    "Segurança da Informação",
    "palavra-chave",
    "código de verificação, codigo de verificacao, código de recuperação, "
    "codigo de recuperacao, one-time password, otp, 2fa code, mfa code, "
    "recovery code",
    "alto",
)
crud.criar(
    "Dump ou backup de banco",
    "Segurança da Informação",
    "palavra-chave",
    "dump do banco, backup do banco, exportação do banco, exportacao do banco, "
    "database dump, database backup, sql dump, .sql, .bak",
    "alto",
)
crud.criar(
    "Dados de clientes",
    "Segurança da Informação",
    "palavra-chave",
    "lista de clientes, base de clientes, dados de clientes, "
    "exportação do crm, exportacao do crm, leads, customer list, client list, "
    "customer database, prospect list",
    "alto",
)
crud.criar(
    "Acesso remoto ou VPN",
    "Segurança da Informação",
    "palavra-chave",
    "credenciais de vpn, acesso vpn, acesso remoto, remote access, "
    "vpn credentials, rdp, ssh access",
    "alto",
)
crud.criar(
    "Relatório de vulnerabilidade",
    "Segurança da Informação",
    "palavra-chave",
    "relatório de vulnerabilidade, relatorio de vulnerabilidade, cve-, "
    "exploit, penetration test, pentest, security audit",
    "medio",
)
crud.criar(
    "Arquivo de ambiente",
    "Segurança da Informação",
    "palavra-chave",
    ".env, variáveis de ambiente, variaveis de ambiente, environment variables, "
    "dotenv, secrets manager",
    "medio",
)

# Jurídico
crud.criar(
    "Nome de fornecedor",
    "Jurídico",
    "palavra-chave",
    "fornecedor, prestador de serviço, prestador de servico, supplier, vendor, "
    "third-party contract",
    "baixo",
)
crud.criar(
    "Número de contrato",
    "Jurídico",
    "palavra-chave",
    "número do contrato, numero do contrato, contrato nº, contrato n°, "
    "contract number, agreement number",
    "medio",
)
crud.criar(
    "Valor de contrato",
    "Jurídico",
    "palavra-chave",
    "valor do contrato, valor contratual, contract value, contract amount, "
    "total contract value",
    "alto",
)
crud.criar(
    "Cláusulas contratuais",
    "Jurídico",
    "palavra-chave",
    "cláusula, clausula, cláusulas contratuais, clausulas contratuais, "
    "contract clause, nda terms, indemnity clause",
    "alto",
)
crud.criar(
    "Processo judicial",
    "Jurídico",
    "palavra-chave",
    "processo judicial, ação judicial, acao judicial, litigation, lawsuit, "
    "settlement, legal claim",
    "alto",
)

# Projetos e Estratégias
crud.criar(
    "Nome de projeto interno",
    "Projetos e Estratégias",
    "palavra-chave",
    "projeto interno, codinome do projeto, nome do projeto, project code name, "
    "internal project, confidential project",
    "medio",
)
crud.criar(
    "Cronograma de projeto",
    "Projetos e Estratégias",
    "palavra-chave",
    "cronograma, roadmap, marcos do projeto, project timeline, launch schedule, "
    "milestones",
    "medio",
)
crud.criar(
    "Produto não lançado",
    "Projetos e Estratégias",
    "palavra-chave",
    "produto não lançado, produto nao lancado, lançamento confidencial, "
    "lancamento confidencial, unreleased product, unannounced product, "
    "stealth launch",
    "alto",
)
crud.criar(
    "Estratégia de negócio",
    "Projetos e Estratégias",
    "palavra-chave",
    "estratégia, estrategia, plano estratégico, plano estrategico, fusão, fusao, "
    "aquisição, aquisicao, business strategy, strategic plan, merger, acquisition, "
    "go-to-market",
    "alto",
)
crud.criar(
    "Precificação ou proposta",
    "Projetos e Estratégias",
    "palavra-chave",
    "precificação, precificacao, tabela de preços, tabela de precos, "
    "proposta comercial, pricing, price list, quote, commercial proposal",
    "alto",
)
