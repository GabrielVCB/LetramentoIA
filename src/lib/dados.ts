/**
 * Dados de referência do projeto: matriz de risco por área, mensagens
 * educativas padrão, sites monitorados e utilitários de apresentação.
 * A mesma matriz é usada no seed do banco e no painel.
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
      "Dados pessoais, remuneração e vínculos de colaboradores. Uso restrito ao time de Gestão de Pessoas.",
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
        padrao: "nome do funcionário, nome do colaborador, ficha do colaborador",
        risco: "baixo",
      },
      {
        nome: "Cargo ou função",
        tipo: "palavra-chave",
        padrao: "cargo atual, função exercida, cargo de",
        risco: "baixo",
      },
      {
        nome: "Salário",
        tipo: "palavra-chave",
        padrao: "salário, salario, remuneração, holerite, contracheque",
        risco: "alto",
      },
      {
        nome: "Dados bancários",
        tipo: "palavra-chave",
        padrao: "dados bancários, agência, conta salário, chave pix",
        risco: "alto",
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
        padrao: "centro de custo, nome da conta, setor financeiro",
        risco: "baixo",
      },
      {
        nome: "Valor de despesa",
        tipo: "regex",
        padrao: "R\\$\\s?\\d[\\d.,]*",
        risco: "medio",
      },
      {
        nome: "Orçamento interno",
        tipo: "palavra-chave",
        padrao: "orçamento, orcamento, budget",
        risco: "medio",
      },
      {
        nome: "Faturamento",
        tipo: "palavra-chave",
        padrao: "faturamento, receita bruta, receita anual",
        risco: "alto",
      },
      {
        nome: "Dados bancários da empresa",
        tipo: "palavra-chave",
        padrao: "dados bancários da empresa, conta da empresa, cnpj",
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
        padrao: "versão do software, licença do software",
        risco: "baixo",
      },
      {
        nome: "Mensagem de erro genérica",
        tipo: "palavra-chave",
        padrao: "mensagem de erro, erro 500, stack trace",
        risco: "baixo",
      },
      {
        nome: "IP ou servidor interno",
        tipo: "regex",
        padrao: "\\b(?:10|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b",
        risco: "alto",
      },
      {
        nome: "Código-fonte interno",
        tipo: "palavra-chave",
        padrao: "código-fonte, codigo fonte, repositório interno, branch privada",
        risco: "alto",
      },
      {
        nome: "Senha ou credencial",
        tipo: "regex",
        padrao: "(?:senha|password|pwd|credencial)\\s*[:=]",
        risco: "alto",
      },
      {
        nome: "Token ou chave de API",
        tipo: "regex",
        padrao: "\\b(?:sk-[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,})",
        risco: "alto",
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
        padrao: "fornecedor, prestador de serviço",
        risco: "baixo",
      },
      {
        nome: "Número de contrato",
        tipo: "palavra-chave",
        padrao: "número do contrato, numero do contrato, contrato nº",
        risco: "medio",
      },
      {
        nome: "Valor de contrato",
        tipo: "palavra-chave",
        padrao: "valor do contrato, valor contratual, valor mensal do contrato",
        risco: "alto",
      },
      {
        nome: "Cláusulas contratuais",
        tipo: "palavra-chave",
        padrao: "cláusula, clausula, cláusulas contratuais",
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
        padrao: "projeto interno, codinome do projeto, nome do projeto",
        risco: "medio",
      },
      {
        nome: "Cronograma de projeto",
        tipo: "palavra-chave",
        padrao: "cronograma, roadmap, marcos do projeto",
        risco: "medio",
      },
      {
        nome: "Produto não lançado",
        tipo: "palavra-chave",
        padrao: "produto não lançado, produto nao lancado, lançamento confidencial",
        risco: "alto",
      },
      {
        nome: "Estratégia de negócio",
        tipo: "palavra-chave",
        padrao: "estratégia, estrategia, plano estratégico, fusão, aquisição",
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
  "copilot.microsoft.com",
] as const;

export const ACOES = ["enviou", "cancelou"] as const;
export type Acao = (typeof ACOES)[number];

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
