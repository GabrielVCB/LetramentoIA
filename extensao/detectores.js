/**
 * Sentinela — motor de detecção local (JavaScript puro, sem dependências).
 *
 * Executado dentro do content script. Recebe o texto digitado e devolve apenas
 * metadados (tipo, área, risco e contagem). O texto nunca é transmitido.
 *
 * Expõe globalThis.PainelDetectores e também module.exports quando rodando em
 * Node (usado pelos testes automatizados).
 */
(function () {
  "use strict";

  /** Normaliza texto para comparação de palavras-chave. */
  function normalizar(texto) {
    return String(texto)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function escaparRegex(texto) {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function apenasDigitos(texto) {
    return String(texto).replace(/\D+/g, "");
  }

  /** CPF: valida os dois dígitos verificadores. */
  function validarCPF(valor) {
    var digitos = apenasDigitos(valor);
    if (digitos.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(digitos)) return false;

    function calcularDigito(base, pesoInicial) {
      var soma = 0;
      for (var i = 0; i < base.length; i++) {
        soma += Number(base[i]) * (pesoInicial - i);
      }
      var resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    }

    var primeiro = calcularDigito(digitos.slice(0, 9), 10);
    var segundo = calcularDigito(digitos.slice(0, 10), 11);
    return primeiro === Number(digitos[9]) && segundo === Number(digitos[10]);
  }

  /** CNPJ: valida os dois dígitos verificadores. */
  function validarCNPJ(valor) {
    var digitos = apenasDigitos(valor);
    if (digitos.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(digitos)) return false;

    function calcular(base, pesos) {
      var soma = 0;
      for (var i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
      var resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    }

    var primeiro = calcular(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    var segundo = calcular(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return primeiro === Number(digitos[12]) && segundo === Number(digitos[13]);
  }

  /** Cartões: algoritmo de Luhn. */
  function validarLuhn(valor) {
    var digitos = apenasDigitos(valor);
    if (digitos.length < 13 || digitos.length > 19) return false;
    if (/^(\d)\1+$/.test(digitos)) return false;

    var soma = 0;
    var dobrar = false;
    for (var i = digitos.length - 1; i >= 0; i--) {
      var digito = Number(digitos[i]);
      if (dobrar) {
        digito *= 2;
        if (digito > 9) digito -= 9;
      }
      soma += digito;
      dobrar = !dobrar;
    }
    return soma % 10 === 0;
  }

  function pareceSegredoAltaEntropia(valor) {
    if (valor.length < 16) return false;
    var temLetra = /[a-z]/i.test(valor);
    var temNumero = /\d/.test(valor);
    var simbolos = new Set(valor).size;
    return temLetra && temNumero && simbolos >= 10;
  }

  function contarOcorrencias(texto, regex) {
    var total = 0;
    var flags = regex.flags.indexOf("g") >= 0 ? regex.flags : regex.flags + "g";
    var seguro = new RegExp(regex.source, flags);
    var achado;
    while ((achado = seguro.exec(texto)) !== null && total < 50) {
      total += 1;
      if (achado.index === seguro.lastIndex) seguro.lastIndex += 1;
    }
    return total;
  }

  function pareceCodigoFonte(texto) {
    var sinais = 0;
    if (/(^|\n)\s*(def|class|function|import|from|const|let|var|return|public|private|async|SELECT)\b/m.test(texto)) {
      sinais += 1;
    }
    if (/\bSELECT\b[\s\S]{0,120}\bFROM\b/i.test(texto)) sinais += 2;
    if (/=>/.test(texto)) sinais += 1;
    if (/(?:console\.log|print\(|System\.out|document\.querySelector)/.test(texto)) sinais += 1;
    if (/\{\s*\n[\s\S]{0,200}\n\s*\}/.test(texto)) sinais += 1;
    if ((texto.match(/[{}]/g) || []).length >= 4) sinais += 1;
    if (/;\s*$/m.test(texto)) sinais += 1;
    return sinais >= 2;
  }

  /** Detectores técnicos embutidos (não dependem do servidor). */
  function detectoresEmbutidos(texto) {
    var deteccoes = [];

    var cpfs = texto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || [];
    var cpfsValidos = cpfs.filter(validarCPF).length;
    if (cpfsValidos > 0) {
      deteccoes.push({ tipo: "CPF", area: "RH", risco: "alto", ocorrencias: cpfsValidos });
    }

    var cnpjs = texto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || [];
    var cnpjsValidos = cnpjs.filter(validarCNPJ).length;
    if (cnpjsValidos > 0) {
      deteccoes.push({ tipo: "CNPJ", area: "Jurídico", risco: "alto", ocorrencias: cnpjsValidos });
    }

    var ips = texto.match(
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    ) || [];
    if (ips.length > 0) {
      deteccoes.push({
        tipo: "IP ou servidor interno",
        area: "TI",
        risco: "alto",
        ocorrencias: ips.length,
      });
    }

    var hostnames = texto.match(/\b[a-z0-9][a-z0-9-]*\.(?:local|internal|corp)\b/gi) || [];
    if (hostnames.length > 0) {
      deteccoes.push({
        tipo: "Hostname interno",
        area: "TI",
        risco: "alto",
        ocorrencias: hostnames.length,
      });
    }

    var tokensConhecidos = texto.match(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})\b/g,
    ) || [];
    var jwts =
      texto.match(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g) || [];
    var segredosRotulados =
      texto.match(/(?:api[_-]?key|token|secret|chave)\s*[:=]\s*["']?([A-Za-z0-9_\-.]{16,})/gi) || [];
    var segredosValidos = segredosRotulados.filter(function (trecho) {
      var valor = trecho
        .split(/[:=]/)
        .slice(1)
        .join("=")
        .replace(/["'\s]/g, "");
      return pareceSegredoAltaEntropia(valor);
    });
    var totalTokens = tokensConhecidos.length + jwts.length + segredosValidos.length;
    if (totalTokens > 0) {
      deteccoes.push({
        tipo: "Token ou chave de API",
        area: "TI",
        risco: "alto",
        ocorrencias: totalTokens,
      });
    }

    // Senha escrita de várias formas: "senha:123", "minha senha é 123",
    // "a senha do banco é X", "password is hunter2" e também "senha 123".
    // O primeiro padrão aceita até quatro palavras entre a palavra e o sinal
    // de que vem um valor (é, =, :, is...), o que cobre a forma falada.
    var PADROES_SENHA = [
      /(?:senha|password|passwd|pwd|credencial|credenciais)(?:\s+[\w\u00C0-\u017F-]+){0,4}(?:\s*[:=]|\s+(?:é|eh|e|são|sao|será|sera|fica|está|esta|is|are))\s*["']?[^\s"',.;]{2,}/gi,
      /(?:senha|password|passwd|pwd)\s*[:=]?\s*[A-Za-z0-9!@#$%&*._-]{1,}\d[A-Za-z0-9!@#$%&*._-]*/gi,
    ];
    var posicoesSenha = new Set();
    for (var s = 0; s < PADROES_SENHA.length; s++) {
      var seguroSenha = new RegExp(PADROES_SENHA[s].source, "gi");
      var achadoSenha;
      while ((achadoSenha = seguroSenha.exec(texto)) !== null) {
        posicoesSenha.add(achadoSenha.index);
        if (achadoSenha.index === seguroSenha.lastIndex) seguroSenha.lastIndex += 1;
      }
    }
    var totalSenhas = posicoesSenha.size;
    if (totalSenhas > 0) {
      deteccoes.push({
        tipo: "Senha ou credencial",
        area: "TI",
        risco: "alto",
        ocorrencias: totalSenhas,
      });
    }

    var dadosBancarios =
      texto.match(
        /\b(?:ag[êe]ncia|conta corrente|iban|chave pix|dados banc[áa]rios)\b(?:\s*[:=]?\s*[\w.\-/]{2,})?/gi,
      ) || [];
    if (dadosBancarios.length > 0) {
      deteccoes.push({
        tipo: "Dados bancários",
        area: "Financeiro",
        risco: "alto",
        ocorrencias: dadosBancarios.length,
      });
    }

    var cartoes = texto.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
    var cartoesValidos = cartoes.filter(validarLuhn).length;
    if (cartoesValidos > 0) {
      deteccoes.push({
        tipo: "Número de cartão",
        area: "Financeiro",
        risco: "alto",
        ocorrencias: cartoesValidos,
      });
    }

    if (pareceCodigoFonte(texto)) {
      deteccoes.push({
        tipo: "Código-fonte interno",
        area: "TI",
        risco: "alto",
        ocorrencias: 1,
      });
    }

    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(texto)) {
      deteccoes.push({
        tipo: "Chave privada",
        area: "TI",
        risco: "alto",
        ocorrencias: 1,
      });
    }

    var conexoes =
      texto.match(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s"']+/gi) || [];
    if (conexoes.length > 0) {
      deteccoes.push({
        tipo: "String de conexão",
        area: "TI",
        risco: "alto",
        ocorrencias: conexoes.length,
      });
    }

    var urlsAssinadas =
      texto.match(
        /https?:\/\/[^\s'"<>]*[?&](?:token|access_token|signature|X-Amz-Signature|sig|key)=[^\s&]+/gi,
      ) || [];
    if (urlsAssinadas.length > 0) {
      deteccoes.push({
        tipo: "URL com token de sessão",
        area: "TI",
        risco: "alto",
        ocorrencias: urlsAssinadas.length,
      });
    }

    var credenciaisUrl =
      texto.match(/\b[a-z0-9._%-]+:[^\s@/]{4,}@[a-z0-9.-]+\.[a-z]{2,}\b/gi) || [];
    if (credenciaisUrl.length > 0) {
      deteccoes.push({
        tipo: "Credencial em URL",
        area: "Segurança da Informação",
        risco: "alto",
        ocorrencias: credenciaisUrl.length,
      });
    }

    var linhasEnv = texto.split("\n").filter(function (linha) {
      var limpa = linha.trim();
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

    var emails = texto.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
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
  var LIMITE_COLAGEM = 1200;

  /**
   * Classifica uma colagem de bloco inteiro: trechos grandes de texto, código
   * ou listas colados de uma só vez escapam da revisão linha a linha.
   */
  function avaliarColagem(texto) {
    var limpo = String(texto || "").trim();
    if (limpo.length < LIMITE_COLAGEM) return null;
    var linhas = limpo.split("\n").length;
    var risco =
      pareceCodigoFonte(limpo) || limpo.length >= 6000 || linhas >= 80 ? "alto" : "medio";
    return {
      tipo: "Colagem de bloco extenso",
      area: "Segurança da Informação",
      risco: risco,
      ocorrencias: 1,
    };
  }

  /** Aplica uma regra editável (regex ou palavra-chave). */
  function aplicarRegra(regra, texto) {
    if (!regra || !regra.ativo || !regra.padrao || !regra.padrao.trim() || !texto.trim()) {
      return null;
    }

    if (regra.tipo === "regex") {
      if (regra.padrao.length > 500) return null;
      var regex;
      try {
        regex = new RegExp(regra.padrao, "gi");
      } catch (erro) {
        return null; // padrão inválido é ignorado em tempo de execução
      }
      var ocorrenciasRegex = contarOcorrencias(texto, regex);
      return ocorrenciasRegex > 0
        ? { tipo: regra.nome, area: regra.area, risco: regra.risco, ocorrencias: ocorrenciasRegex }
        : null;
    }

    var alvo = normalizar(texto);
    var ocorrencias = 0;
    var termos = String(regra.padrao).split(",");
    for (var i = 0; i < termos.length; i++) {
      var limpo = termos[i].trim();
      if (limpo.length < 2) continue;
      var padrao = new RegExp(
        "(^|[^a-z0-9])" + escaparRegex(normalizar(limpo)) + "($|[^a-z0-9])",
        "g",
      );
      ocorrencias += contarOcorrencias(alvo, padrao);
    }
    return ocorrencias > 0
      ? { tipo: regra.nome, area: regra.area, risco: regra.risco, ocorrencias: ocorrencias }
      : null;
  }

  /** Consolida detecções do mesmo tipo mantendo o maior risco. */
  function consolidar(deteccoes) {
    var pesos = { baixo: 1, medio: 2, alto: 3 };
    var mapa = new Map();
    for (var i = 0; i < deteccoes.length; i++) {
      var deteccao = deteccoes[i];
      var chave = normalizar(deteccao.tipo);
      var atual = mapa.get(chave);
      if (!atual) {
        mapa.set(chave, {
          tipo: deteccao.tipo,
          area: deteccao.area,
          risco: deteccao.risco,
          ocorrencias: deteccao.ocorrencias,
        });
        continue;
      }
      mapa.set(chave, {
        tipo: atual.tipo,
        area: atual.area,
        risco: pesos[deteccao.risco] > pesos[atual.risco] ? deteccao.risco : atual.risco,
        ocorrencias: Math.max(atual.ocorrencias, deteccao.ocorrencias),
      });
    }
    return Array.from(mapa.values()).sort(function (a, b) {
      return pesos[b.risco] - pesos[a.risco] || a.tipo.localeCompare(b.tipo);
    });
  }

  /** Mescla detecções de texto, colagem, imagem e PDF em uma só análise. */
  function mesclarDeteccoes(deteccoes) {
    var consolidadas = consolidar(deteccoes || []);
    var total = 0;
    for (var i = 0; i < consolidadas.length; i++) total += consolidadas[i].ocorrencias;
    return { nivel: classificar(consolidadas), deteccoes: consolidadas, totalOcorrencias: total };
  }

  /** Regra de classificação geral: Alto > Médio > Baixo. */
  function classificar(deteccoes) {
    for (var i = 0; i < deteccoes.length; i++) {
      if (deteccoes[i].risco === "alto") return "alto";
    }
    for (var j = 0; j < deteccoes.length; j++) {
      if (deteccoes[j].risco === "medio") return "medio";
    }
    return "baixo";
  }

  /** Analisa o texto com detectores embutidos + regras baixadas do servidor. */
  function analisarTexto(texto, regras) {
    var limpo = typeof texto === "string" ? texto : "";
    if (!limpo.trim()) {
      return { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
    }

    var encontrados = detectoresEmbutidos(limpo);
    var lista = Array.isArray(regras) ? regras : [];
    for (var i = 0; i < lista.length; i++) {
      var deteccao = aplicarRegra(lista[i], limpo);
      if (deteccao) encontrados.push(deteccao);
    }

    var deteccoes = consolidar(encontrados);
    var total = 0;
    for (var j = 0; j < deteccoes.length; j++) total += deteccoes[j].ocorrencias;

    return { nivel: classificar(deteccoes), deteccoes: deteccoes, totalOcorrencias: total };
  }

  var API = {
    normalizar: normalizar,
    validarCPF: validarCPF,
    validarCNPJ: validarCNPJ,
    validarLuhn: validarLuhn,
    pareceSegredoAltaEntropia: pareceSegredoAltaEntropia,
    pareceCodigoFonte: pareceCodigoFonte,
    avaliarColagem: avaliarColagem,
    LIMITE_COLAGEM: LIMITE_COLAGEM,
    aplicarRegra: aplicarRegra,
    classificar: classificar,
    consolidar: consolidar,
    mesclarDeteccoes: mesclarDeteccoes,
    analisarTexto: analisarTexto,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  globalThis.PainelDetectores = API;
})();
