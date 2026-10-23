/**
 * Motor de detecção executado LOCALMENTE no navegador.
 *
 * Duas camadas:
 *  1. Detectores embutidos — CPF/CNPJ (com dígito verificador), IP privado,
 *     hostname interno, tokens, senhas, dados bancários, cartões (Luhn) e
 *     trechos de código. São técnicos e não dependem do servidor.
 *  2. Regras editáveis vindas do banco (palavra-chave ou regex), aplicadas
 *     sobre o texto normalizado (sem acentos e em minúsculas).
 *
 * O texto analisado nunca é enviado a lugar nenhum: a função recebe o texto e
 * devolve apenas tipos, áreas, risco e contagem de ocorrências.
 */
import type { Risco, TipoRegra } from "./dados";
import { PESO_RISCO } from "./dados";

export interface RegraEntrada {
  _id?: string;
  nome: string;
  area: string;
  tipo: TipoRegra;
  padrao: string;
  risco: Risco;
  ativo: boolean;
}

export interface Deteccao {
  /** Tipo de dado detectado, ex.: "CPF", "Token ou chave de API". */
  tipo: string;
  /** Área responsável pela informação. */
  area: string;
  risco: Risco;
  ocorrencias: number;
}

export interface Analise {
  nivel: Risco;
  deteccoes: Deteccao[];
  totalOcorrencias: number;
}

/** Normaliza texto para comparação de palavras-chave. */
export function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Escapa um texto para uso seguro dentro de uma RegExp. */
function escaparRegex(texto: string) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function apenasDigitos(texto: string) {
  return texto.replace(/\D+/g, "");
}

/** Valida CPF pelos dois dígitos verificadores. */
export function validarCPF(valor: string): boolean {
  const digitos = apenasDigitos(valor);
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const calcularDigito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (pesoInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const primeiro = calcularDigito(digitos.slice(0, 9), 10);
  const segundo = calcularDigito(digitos.slice(0, 10), 11);
  return primeiro === Number(digitos[9]) && segundo === Number(digitos[10]);
}

/** Valida CNPJ pelos dois dígitos verificadores. */
export function validarCNPJ(valor: string): boolean {
  const digitos = apenasDigitos(valor);
  if (digitos.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digitos)) return false;

  const calcular = (base: string, pesos: number[]) => {
    const soma = base
      .split("")
      .reduce((total, digito, indice) => total + Number(digito) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const primeiro = calcular(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcular(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return primeiro === Number(digitos[12]) && segundo === Number(digitos[13]);
}

/** Valida número de cartão pelo algoritmo de Luhn. */
export function validarLuhn(valor: string): boolean {
  const digitos = apenasDigitos(valor);
  if (digitos.length < 13 || digitos.length > 19) return false;
  if (/^(\d)\1+$/.test(digitos)) return false;

  let soma = 0;
  let dobrar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let digito = Number(digitos[i]);
    if (dobrar) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    soma += digito;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

/** Verifica se uma string parece um segredo de alta entropia. */
export function pareceSegredoAltaEntropia(valor: string) {
  if (valor.length < 16) return false;
  const temLetra = /[a-z]/i.test(valor);
  const temNumero = /\d/.test(valor);
  const simbolos = new Set(valor).size;
  return temLetra && temNumero && simbolos >= 10;
}

/** Conta ocorrências de uma RegExp global sem estourar em padrões vazios. */
function contarOcorrencias(texto: string, regex: RegExp) {
  let total = 0;
  let achado: RegExpExecArray | null;
  const seguro = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  while ((achado = seguro.exec(texto)) !== null && total < 50) {
    total += 1;
    if (achado.index === seguro.lastIndex) seguro.lastIndex += 1;
  }
  return total;
}

/** Detectores técnicos sempre ativos (não dependem do banco). */
function detectoresEmbutidos(texto: string): Deteccao[] {
  const deteccoes: Deteccao[] = [];

  // CPF com validação de dígitos verificadores.
  const cpfs = texto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) ?? [];
  const cpfsValidos = cpfs.filter(validarCPF).length;
  if (cpfsValidos > 0) {
    deteccoes.push({ tipo: "CPF", area: "RH", risco: "alto", ocorrencias: cpfsValidos });
  }

  // CNPJ com validação de dígitos verificadores.
  const cnpjs = texto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) ?? [];
  const cnpjsValidos = cnpjs.filter(validarCNPJ).length;
  if (cnpjsValidos > 0) {
    deteccoes.push({
      tipo: "CNPJ",
      area: "Jurídico",
      risco: "alto",
      ocorrencias: cnpjsValidos,
    });
  }

  // IPv4 de faixas privadas (10/8, 172.16/12, 192.168/16).
  const ips =
    texto.match(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g) ??
    [];
  if (ips.length > 0) {
    deteccoes.push({
      tipo: "IP ou servidor interno",
      area: "TI",
      risco: "alto",
      ocorrencias: ips.length,
    });
  }

  // Hostnames internos.
  const hostnames = texto.match(/\b[a-z0-9][a-z0-9-]*\.(?:local|internal|corp)\b/gi) ?? [];
  if (hostnames.length > 0) {
    deteccoes.push({
      tipo: "Hostname interno",
      area: "TI",
      risco: "alto",
      ocorrencias: hostnames.length,
    });
  }

  // Chaves e tokens conhecidos.
  const tokensConhecidos =
    texto.match(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})\b/g,
    ) ?? [];
  const jwts = texto.match(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g) ?? [];
  const segredosRotulados =
    texto.match(/(?:api[_-]?key|token|secret|chave)\s*[:=]\s*["']?([A-Za-z0-9_\-.]{16,})/gi) ?? [];
  const segredosValidos = segredosRotulados.filter((trecho) => {
    const valor = trecho.split(/[:=]/).slice(1).join("=").replace(/["'\s]/g, "");
    return pareceSegredoAltaEntropia(valor);
  });
  const totalTokens = tokensConhecidos.length + jwts.length + segredosValidos.length;
  if (totalTokens > 0) {
    deteccoes.push({
      tipo: "Token ou chave de API",
      area: "TI",
      risco: "alto",
      ocorrencias: totalTokens,
    });
  }

  // Senhas e credenciais.
  const senhas = texto.match(/(?:senha|password|passwd|pwd|credencial)\s*[:=]/gi) ?? [];
  if (senhas.length > 0) {
    deteccoes.push({
      tipo: "Senha ou credencial",
      area: "TI",
      risco: "alto",
      ocorrencias: senhas.length,
    });
  }

  // Dados bancários em texto livre.
  const dadosBancarios =
    texto.match(
      /\b(?:ag[êe]ncia|conta corrente|iban|chave pix|dados banc[áa]rios)\b(?:\s*[:=]?\s*[\w.\-/]{2,})?/gi,
    ) ?? [];
  if (dadosBancarios.length > 0) {
    deteccoes.push({
      tipo: "Dados bancários",
      area: "Financeiro",
      risco: "alto",
      ocorrencias: dadosBancarios.length,
    });
  }

  // Números de cartão com validação de Luhn.
  const cartoes = texto.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  const cartoesValidos = cartoes.filter(validarLuhn).length;
  if (cartoesValidos > 0) {
    deteccoes.push({
      tipo: "Número de cartão",
      area: "Financeiro",
      risco: "alto",
      ocorrencias: cartoesValidos,
    });
  }

  // Heurística simples de código-fonte.
  if (pareceCodigoFonte(texto)) {
    deteccoes.push({
      tipo: "Código-fonte interno",
      area: "TI",
      risco: "alto",
      ocorrencias: 1,
    });
  }

  // Chaves privadas em bloco PEM.
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(texto)) {
    deteccoes.push({
      tipo: "Chave privada",
      area: "TI",
      risco: "alto",
      ocorrencias: 1,
    });
  }

  // Strings de conexão com banco ou fila.
  const conexoes =
    texto.match(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s"']+/gi) ?? [];
  if (conexoes.length > 0) {
    deteccoes.push({
      tipo: "String de conexão",
      area: "TI",
      risco: "alto",
      ocorrencias: conexoes.length,
    });
  }

  // URLs assinadas ou com token de sessão.
  const urlsAssinadas =
    texto.match(
      /https?:\/\/[^\s'"<>]*[?&](?:token|access_token|signature|X-Amz-Signature|sig|key)=[^\s&]+/gi,
    ) ?? [];
  if (urlsAssinadas.length > 0) {
    deteccoes.push({
      tipo: "URL com token de sessão",
      area: "TI",
      risco: "alto",
      ocorrencias: urlsAssinadas.length,
    });
  }

  // Credencial embutida em URL (usuário:senha@host).
  const credenciaisUrl =
    texto.match(/\b[a-z0-9._%-]+:[^\s@/]{4,}@[a-z0-9.-]+\.[a-z]{2,}\b/gi) ?? [];
  if (credenciaisUrl.length > 0) {
    deteccoes.push({
      tipo: "Credencial em URL",
      area: "Segurança da Informação",
      risco: "alto",
      ocorrencias: credenciaisUrl.length,
    });
  }

  // Bloco de variáveis de ambiente com nomes sensíveis (.env).
  const linhasEnv = texto.split("\n").filter((linha) => {
    const limpa = linha.trim();
    return (
      /^[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/.test(limpa) &&
      /(KEY|TOKEN|SECRET|PASS|PWD|API|DATABASE|AWS|PRIVATE|CREDENTIAL)/.test(limpa)
    );
  });
  if (linhasEnv.length >= 2) {
    deteccoes.push({
      tipo: "Credenciais em arquivo de ambiente",
      area: "Segurança da Informação",
      risco: "alto",
      ocorrencias: linhasEnv.length,
    });
  }

  // E-mails: um contato isolado é risco baixo; uma lista já é vazamento.
  const emails = texto.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) ?? [];
  if (emails.length >= 5) {
    deteccoes.push({
      tipo: "Lista de contatos",
      area: "Segurança da Informação",
      risco: "alto",
      ocorrencias: emails.length,
    });
  } else if (emails.length > 0) {
    deteccoes.push({
      tipo: "E-mail",
      area: "RH",
      risco: "baixo",
      ocorrencias: emails.length,
    });
  }

  return deteccoes;
}

/** Tamanho mínimo, em caracteres, para tratar uma colagem como bloco. */
export const LIMITE_COLAGEM = 1200;

/**
 * Classifica uma colagem de bloco inteiro: trechos grandes de texto, código
 * ou listas colados de uma só vez escapam da revisão linha a linha.
 */
export function avaliarColagem(texto: string): Deteccao | null {
  const limpo = (texto || "").trim();
  if (limpo.length < LIMITE_COLAGEM) return null;
  const linhas = limpo.split("\n").length;
  const risco: Risco =
    pareceCodigoFonte(limpo) || limpo.length >= 6000 || linhas >= 80 ? "alto" : "medio";
  return {
    tipo: "Colagem de bloco extenso",
    area: "Segurança da Informação",
    risco,
    ocorrencias: 1,
  };
}

/** Pontuação heurística: 2 ou mais sinais indicam trecho de código. */
export function pareceCodigoFonte(texto: string) {
  let sinais = 0;
  if (/(^|\n)\s*(def|class|function|import|from|const|let|var|return|public|private|async|SELECT)\b/m.test(texto)) {
    sinais += 1;
  }
  if (/\bSELECT\b[\s\S]{0,120}\bFROM\b/i.test(texto)) sinais += 2;
  if (/=>/.test(texto)) sinais += 1;
  if (/(?:console\.log|print\(|System\.out|document\.querySelector)/.test(texto)) sinais += 1;
  if (/\{\s*\n[\s\S]{0,200}\n\s*\}/.test(texto)) sinais += 1;
  if ((texto.match(/[{}]/g) ?? []).length >= 4) sinais += 1;
  if (/;\s*$/m.test(texto)) sinais += 1;
  return sinais >= 2;
}

/** Aplica uma regra editável (regex ou palavra-chave) ao texto. */
export function aplicarRegra(regra: RegraEntrada, texto: string): Deteccao | null {
  if (!regra.ativo || !regra.padrao.trim() || !texto.trim()) return null;

  if (regra.tipo === "regex") {
    if (regra.padrao.length > 500) return null;
    let regex: RegExp;
    try {
      regex = new RegExp(regra.padrao, "gi");
    } catch {
      return null; // padrão inválido: ignorado em tempo de execução
    }
    const ocorrencias = contarOcorrencias(texto, regex);
    return ocorrencias > 0
      ? { tipo: regra.nome, area: regra.area, risco: regra.risco, ocorrencias }
      : null;
  }

  const alvo = normalizar(texto);
  let ocorrencias = 0;
  for (const termo of regra.padrao.split(",")) {
    const limpo = termo.trim();
    if (limpo.length < 2) continue;
    const padrao = new RegExp(
      `(^|[^a-z0-9])${escaparRegex(normalizar(limpo))}($|[^a-z0-9])`,
      "g",
    );
    ocorrencias += contarOcorrencias(alvo, padrao);
  }
  return ocorrencias > 0
    ? { tipo: regra.nome, area: regra.area, risco: regra.risco, ocorrencias }
    : null;
}

/** Remove duplicatas do mesmo tipo (regra do banco x detector), mantendo o maior risco. */
function consolidar(deteccoes: Deteccao[]): Deteccao[] {
  const mapa = new Map<string, Deteccao>();
  for (const deteccao of deteccoes) {
    const chave = normalizar(deteccao.tipo);
    const atual = mapa.get(chave);
    if (!atual) {
      mapa.set(chave, { ...deteccao });
      continue;
    }
    mapa.set(chave, {
      ...atual,
      risco: PESO_RISCO[deteccao.risco] > PESO_RISCO[atual.risco] ? deteccao.risco : atual.risco,
      ocorrencias: Math.max(atual.ocorrencias, deteccao.ocorrencias),
    });
  }
  return [...mapa.values()].sort(
    (a, b) => PESO_RISCO[b.risco] - PESO_RISCO[a.risco] || a.tipo.localeCompare(b.tipo),
  );
}

/** Regra de classificação geral: Alto > Médio > Baixo. */
export function classificar(deteccoes: Deteccao[]): Risco {
  if (deteccoes.some((item) => item.risco === "alto")) return "alto";
  if (deteccoes.some((item) => item.risco === "medio")) return "medio";
  return "baixo";
}

/**
 * Mescla detecções de fontes diferentes (texto, colagem, imagem, PDF) em uma
 * única análise consolidada. Usado pela extensão, que analisa anexos à parte.
 */
export function mesclarDeteccoes(deteccoes: Deteccao[]): Analise {
  const consolidadas = consolidar(deteccoes);
  return {
    nivel: classificar(consolidadas),
    deteccoes: consolidadas,
    totalOcorrencias: consolidadas.reduce((total, item) => total + item.ocorrencias, 0),
  };
}

/**
 * Analisa o texto com os detectores embutidos + regras editáveis do banco.
 * Retorna apenas metadados, nunca o conteúdo digitado.
 */
export function analisarTexto(texto: string, regras: RegraEntrada[] = []): Analise {
  if (!texto.trim()) {
    return { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
  }

  const encontrados = detectoresEmbutidos(texto);
  for (const regra of regras) {
    const deteccao = aplicarRegra(regra, texto);
    if (deteccao) encontrados.push(deteccao);
  }

  const deteccoes = consolidar(encontrados);
  return {
    nivel: classificar(deteccoes),
    deteccoes,
    totalOcorrencias: deteccoes.reduce((total, item) => total + item.ocorrencias, 0),
  };
}
