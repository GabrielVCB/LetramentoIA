/**
 * Dados de referência do projeto: matriz de risco por área, mensagens
 * educativas padrão, sites monitorados e utilitários de apresentação.
 * A mesma matriz é usada no seed do banco e no painel.
 *
 * As regras de palavra-chave são bilíngues (português e inglês): o mesmo
 * conceito é reconhecido em "senha" e "password", por exemplo. A busca ignora
 * acentos e maiúsculas.
 */

export type Risco = "baixo" | "medio" | "alto";
export type TipoRegra = "regex" | "palavra-chave";

export interface RegraSeed {
  nome: string;
  tipo: TipoRegra;
  padrao: string;
  risco: Risco;
}

export interface AreaSeed {
  nome: string;
  descricao: string;
  regras: RegraSeed[];
}

export const RISCOS: Risco[] = ["baixo", "medio", "alto"];

export const ROTULO_RISCO: Record<Risco, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

export const PESO_RISCO: Record<Risco, number> = {
  baixo: 1,
  medio: 2,
  alto: 3,
};

export const AREAS_SEED: AreaSeed[] = [
  {
    nome: "RH",
    descricao:
      "Dados pessoais, documentos, remuneração e vínculos de colaboradores. Acesso restrito ao time de pessoas.",
    regras: [
      {
        nome: "CPF",
        tipo: "regex",
        padrao: "\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b",
        risco: "alto",
      },
      {
        nome: "Nome do funcionário",
        tipo: "palavra-chave",
        padrao:
          "nome do funcionário, nome do colaborador, ficha do colaborador, employee name, employee record, staff name",
        risco: "baixo",
      },
      {
        nome: "Cargo ou função",
        tipo: "palavra-chave",
        padrao:
          "cargo atual, função exercida, cargo de, job title, job role, position at the company",
        risco: "baixo",
      },
      {
        nome: "Salário",
        tipo: "palavra-chave",
        padrao:
          "salário, salario, remuneração, remuneracao, holerite, contracheque, salary, payroll, compensation, payslip, wage",
        risco: "alto",
      },
      {
        nome: "Dados bancários",
        tipo: "palavra-chave",
        padrao:
          "dados bancários, dados bancarios, agência, agencia, conta salário, conta salario, chave pix, bank account, account number, routing number, iban, sort code",
        risco: "alto",
      },
      {
        nome: "Documento de identidade",
        tipo: "palavra-chave",
        padrao:
          "carteira de identidade, documento de identidade, rg, cnh, passaporte, passport, driver's license, national id, social security",
        risco: "alto",
      },
      {
        nome: "Data de nascimento",
        tipo: "palavra-chave",
        padrao: "data de nascimento, nascimento, date of birth, birth date, dob",
        risco: "medio",
      },
      {
        nome: "Endereço residencial",
        tipo: "palavra-chave",
        padrao:
          "endereço residencial, endereco residencial, endereço completo, home address, street address, residential address",
        risco: "medio",
      },
      {
        nome: "Dados de saúde",
        tipo: "palavra-chave",
        padrao:
          "dados de saúde, dados de saude, diagnóstico, diagnostico, atestado médico, atestado medico, licença médica, licenca medica, biometria, health data, medical record, diagnosis, sick leave, biometric",
        risco: "alto",
      },
      {
        nome: "Avaliação de desempenho",
        tipo: "palavra-chave",
        padrao:
          "avaliação de desempenho, avaliacao de desempenho, feedback do gestor, performance review, employee evaluation",
        risco: "medio",
      },
    ],
  },
  {
    nome: "Financeiro",
    descricao:
      "Valores, orçamento e resultados da companhia. Publicação somente em canais aprovados.",
    regras: [
      {
        nome: "Nome de conta ou setor",
        tipo: "palavra-chave",
        padrao:
          "centro de custo, nome da conta, setor financeiro, cost center, account name, finance department",
        risco: "baixo",
      },
      {
        nome: "Valor de despesa",
        tipo: "regex",
        padrao: "(?:R\\$|US\\$)\\s?\\d[\\d.,]*|\\$\\s?\\d[\\d.,]{2,}",
        risco: "medio",
      },
      {
        nome: "Orçamento interno",
        tipo: "palavra-chave",
        padrao: "orçamento, orcamento, budget, budget plan, planejamento orçamentário",
        risco: "medio",
      },
      {
        nome: "Faturamento",
        tipo: "palavra-chave",
        padrao:
          "faturamento, receita bruta, receita anual, revenue, gross revenue, annual revenue, sales figures",
        risco: "alto",
      },
      {
        nome: "Dados bancários da empresa",
        tipo: "palavra-chave",
        padrao:
          "dados bancários da empresa, dados bancarios da empresa, conta da empresa, cnpj, company bank account, business account, swift code",
        risco: "alto",
      },
      {
        nome: "Nota fiscal ou pedido",
        tipo: "palavra-chave",
        padrao:
          "nota fiscal, pedido de compra, purchase order, invoice number, billing details",
        risco: "medio",
      },
      {
        nome: "Previsão de resultados",
        tipo: "palavra-chave",
        padrao:
          "previsão de resultados, previsao de resultados, projeção de receita, projecao de receita, guidance, earnings forecast, profit forecast",
        risco: "alto",
      },
    ],
  },
  {
    nome: "TI",
    descricao:
      "Infraestrutura, credenciais e código proprietário. Nunca deve ser colado em ferramentas externas.",
    regras: [
      {
        nome: "Nome de software",
        tipo: "palavra-chave",
        padrao: "versão do software, versao do software, licença do software, software version, software license",
        risco: "baixo",
      },
      {
        nome: "Mensagem de erro genérica",
        tipo: "palavra-chave",
        padrao:
          "mensagem de erro, erro 500, stack trace, error message, exception, error log, traceback",
        risco: "baixo",
      },
      {
        nome: "IP ou servidor interno",
        tipo: "regex",
        padrao:
          "\\b(?:10|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b|\\b172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}\\b",
        risco: "alto",
      },
      {
        nome: "Código-fonte interno",
        tipo: "palavra-chave",
        padrao:
          "código-fonte, codigo fonte, repositório interno, repositorio interno, branch privada, source code, private repository, proprietary code, internal repo",
        risco: "alto",
      },
      {
        nome: "Senha ou credencial",
        tipo: "regex",
        padrao: "(?:senha|password|passwd|pwd|credencial|credential)\\s*[:=]",
        risco: "alto",
      },
      {
        nome: "Token ou chave de API",
        tipo: "regex",
        padrao:
          "\\b(?:sk-[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})",
        risco: "alto",
      },
      {
        nome: "Chave privada",
        tipo: "regex",
        padrao: "-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
        risco: "alto",
      },
      {
        nome: "String de conexão",
        tipo: "regex",
        padrao:
          "(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis|amqp|mssql)://[^\\s\"']+",
        risco: "alto",
      },
      {
        nome: "URL com token de sessão",
        tipo: "regex",
        padrao:
          "https?://[^\\s'\"<>]*[?&](?:token|access_token|signature|X-Amz-Signature|sig|key)=[^\\s&]+",
        risco: "alto",
      },
      {
        nome: "Credencial em URL",
        tipo: "regex",
        padrao: "\\b[a-z0-9._%-]+:[^\\s@/]{4,}@[a-z0-9.-]+\\.[a-z]{2,}\\b",
        risco: "alto",
      },
    ],
  },
  {
    nome: "Segurança da Informação",
    descricao:
      "As causas mais comuns de incidentes: credenciais expostas, backups, dados de clientes e informação marcada como confidencial.",
    regras: [
      {
        nome: "Documento confidencial",
        tipo: "palavra-chave",
        padrao:
          "confidencial, uso interno, não divulgar, nao divulgar, nda, confidential, internal use only, do not distribute, restricted",
        risco: "medio",
      },
      {
        nome: "Código de verificação ou MFA",
        tipo: "palavra-chave",
        padrao:
          "código de verificação, codigo de verificacao, código de recuperação, codigo de recuperacao, one-time password, otp, 2fa code, mfa code, recovery code",
        risco: "alto",
      },
      {
        nome: "Dump ou backup de banco",
        tipo: "palavra-chave",
        padrao:
          "dump do banco, backup do banco, exportação do banco, exportacao do banco, database dump, database backup, sql dump, .sql, .bak",
        risco: "alto",
      },
      {
        nome: "Dados de clientes",
        tipo: "palavra-chave",
        padrao:
          "lista de clientes, base de clientes, dados de clientes, exportação do crm, exportacao do crm, leads, customer list, client list, customer database, prospect list",
        risco: "alto",
      },
      {
        nome: "Acesso remoto ou VPN",
        tipo: "palavra-chave",
        padrao:
          "credenciais de vpn, acesso vpn, acesso remoto, remote access, vpn credentials, rdp, ssh access",
        risco: "alto",
      },
      {
        nome: "Relatório de vulnerabilidade",
        tipo: "palavra-chave",
        padrao:
          "relatório de vulnerabilidade, relatorio de vulnerabilidade, cve-, exploit, penetration test, pentest, security audit",
        risco: "medio",
      },
      {
        nome: "Arquivo de ambiente",
        tipo: "palavra-chave",
        padrao:
          ".env, variáveis de ambiente, variaveis de ambiente, environment variables, dotenv, secrets manager",
        risco: "medio",
      },
    ],
  },
  {
    nome: "Jurídico",
    descricao:
      "Contratos, fornecedores e cláusulas. Compartilhamento exige revisão da área jurídica.",
    regras: [
      {
        nome: "Nome de fornecedor",
        tipo: "palavra-chave",
        padrao: "fornecedor, prestador de serviço, prestador de servico, supplier, vendor, third-party contract",
        risco: "baixo",
      },
      {
        nome: "Número de contrato",
        tipo: "palavra-chave",
        padrao:
          "número do contrato, numero do contrato, contrato nº, contrato n°, contract number, agreement number",
        risco: "medio",
      },
      {
        nome: "Valor de contrato",
        tipo: "palavra-chave",
        padrao:
          "valor do contrato, valor contratual, contract value, contract amount, total contract value",
        risco: "alto",
      },
      {
        nome: "Cláusulas contratuais",
        tipo: "palavra-chave",
        padrao:
          "cláusula, clausula, cláusulas contratuais, clausulas contratuais, contract clause, nda terms, indemnity clause",
        risco: "alto",
      },
      {
        nome: "Processo judicial",
        tipo: "palavra-chave",
        padrao:
          "processo judicial, ação judicial, acao judicial, litigation, lawsuit, settlement, legal claim",
        risco: "alto",
      },
    ],
  },
  {
    nome: "Projetos e Estratégias",
    descricao:
      "Roadmap, lançamentos e movimentos competitivos. Informação estratégica antes do anúncio oficial.",
    regras: [
      {
        nome: "Nome de projeto interno",
        tipo: "palavra-chave",
        padrao:
          "projeto interno, codinome do projeto, nome do projeto, project code name, internal project, confidential project",
        risco: "medio",
      },
      {
        nome: "Cronograma de projeto",
        tipo: "palavra-chave",
        padrao:
          "cronograma, roadmap, marcos do projeto, project timeline, launch schedule, milestones",
        risco: "medio",
      },
      {
        nome: "Produto não lançado",
        tipo: "palavra-chave",
        padrao:
          "produto não lançado, produto nao lancado, lançamento confidencial, lancamento confidencial, unreleased product, unannounced product, stealth launch",
        risco: "alto",
      },
      {
        nome: "Estratégia de negócio",
        tipo: "palavra-chave",
        padrao:
          "estratégia, estrategia, plano estratégico, plano estrategico, fusão, fusao, aquisição, aquisicao, business strategy, strategic plan, merger, acquisition, go-to-market",
        risco: "alto",
      },
      {
        nome: "Precificação ou proposta",
        tipo: "palavra-chave",
        padrao:
          "precificação, precificacao, tabela de preços, tabela de precos, proposta comercial, pricing, price list, quote, commercial proposal",
        risco: "alto",
      },
    ],
  },
];

export const MENSAGENS_PADRAO: Record<Risco, string> = {
  baixo:
    "Não foram identificados os tipos de informações corporativas analisados pelo sistema. Ainda assim, revise o conteúdo antes de compartilhá-lo.",
  medio:
    "Esta informação contém dados internos que podem apresentar riscos à empresa. Evite compartilhar informações desnecessárias e verifique as regras de uso de IA da empresa antes do compartilhamento.",
  alto:
    "Esta informação contém dados confidenciais, pessoais, estratégicos ou relacionados à segurança da empresa. Não compartilhe com uma IA pública. Remova os dados sensíveis ou utilize uma ferramenta de IA corporativa autorizada.",
};

export const SITES_MONITORADOS = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "claude.ai",
  "copilot.cloud.microsoft",
  "copilot.microsoft.com",
  "copilot.com",
] as const;

export const ACOES = ["enviou", "cancelou"] as const;
export type Acao = (typeof ACOES)[number];

/** De onde veio o conteúdo que gerou o alerta. */
export const ORIGENS = ["texto", "colagem", "imagem", "pdf", "anexo"] as const;
export type Origem = (typeof ORIGENS)[number];

export const ROTULO_ORIGEM: Record<Origem, string> = {
  texto: "Texto digitado",
  colagem: "Colagem em massa",
  imagem: "Print ou imagem",
  pdf: "Arquivo PDF",
  anexo: "Imagem e PDF",
};

/** Ordena riscos do mais grave para o mais leve. */
export function ordenarRisco(a: Risco, b: Risco) {
  return PESO_RISCO[b] - PESO_RISCO[a];
}

/** Rótulo curto de horário, em pt-BR. */
export function formatarDataHora(ms: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatarDataCurta(ms: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(ms));
}

export function formatarNumero(valor: number) {
  return new Intl.NumberFormat("pt-BR").format(valor);
}

/** Classe utilitária de cor por risco (texto, borda e fundo). */
export const CLASSES_RISCO: Record<
  Risco,
  { texto: string; borda: string; fundo: string; ponto: string }
> = {
  baixo: {
    texto: "text-risco-baixo",
    borda: "border-risco-baixo/35",
    fundo: "bg-risco-baixo-bg",
    ponto: "bg-risco-baixo",
  },
  medio: {
    texto: "text-risco-medio",
    borda: "border-risco-medio/35",
    fundo: "bg-risco-medio-bg",
    ponto: "bg-risco-medio",
  },
  alto: {
    texto: "text-risco-alto",
    borda: "border-risco-alto/35",
    fundo: "bg-risco-alto-bg",
    ponto: "bg-risco-alto",
  },
};
