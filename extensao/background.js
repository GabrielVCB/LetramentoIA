/**
 * Sentinela — service worker (Manifest V3).
 *
 * Centraliza TODAS as chamadas de rede, evitando CORS/mixed content nas
 * páginas das IAs. Funciona igual no Chrome e no Microsoft Edge.
 *
 * Cada pedido leva X-API-Token com o código de instalação copiado do painel
 * (06 · Instalação). Sem o código, o servidor recusa o envio — e o popup
 * mostra o aviso em vez de falhar em silêncio. Sem fila e sem alarmes de
 * reenvio: o cache de regras existe só para o aviso continuar funcionando
 * quando o servidor estiver fora do ar.
 */
"use strict";

const CINCO_MINUTOS = 5 * 60 * 1000;
const LIMITE_TEXTO_ANEXO = 60000;
const TIMEOUT_MS = 6000;
const TENTATIVAS = 2;

// Endereço do servidor da empresa. Fica fixo aqui para que uma instalação nova
// já nasça apontada para a nuvem, sem ninguém precisar digitar o endereço.
const SERVIDOR_PADRAO = "https://sentinela-r7ge.onrender.com";

const CONFIGURACAO_PADRAO = {
  serverUrl: SERVIDOR_PADRAO,
  apiToken: "",
  departamento: "",
  colaborador: "",
  monitoramentoAtivo: true,
  sitesAtivos: [
    "chatgpt.com",
    "chat.openai.com",
    "gemini.google.com",
    "claude.ai",
    "copilot.cloud.microsoft",
    "copilot.microsoft.com",
    "copilot.com",
  ],
};

const CHAVES = {
  configuracao: "configuracao",
  cache: "cacheConfig",
  status: "statusConexao",
  filaAntiga: "filaAlertas",
  migracaoServidor: "migracaoServidorNuvem",
  ultimoAlerta: "ultimoAlerta",
};

// ---------------------------------------------------------------------------
// Utilidades de armazenamento
// ---------------------------------------------------------------------------

async function lerArmazenado(chave, valorPadrao) {
  const resultado = await chrome.storage.local.get(chave);
  return resultado[chave] === undefined ? valorPadrao : resultado[chave];
}

async function salvarArmazenado(chave, valor) {
  await chrome.storage.local.set({ [chave]: valor });
}

async function obterConfiguracao() {
  const salva = await lerArmazenado(CHAVES.configuracao, {});
  return { ...CONFIGURACAO_PADRAO, ...salva };
}

function normalizarUrl(url) {
  return String(url || CONFIGURACAO_PADRAO.serverUrl)
    .trim()
    .replace(/\/+$/, "");
}

async function registrarStatus(conectado, mensagem) {
  await salvarArmazenado(CHAVES.status, {
    conectado: Boolean(conectado),
    mensagem: mensagem || "",
    verificadoEm: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

async function requisitar(caminho, opcoes, configuracaoExplicita) {
  const configuracao = configuracaoExplicita || (await obterConfiguracao());
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const cabecalhos = { ...(opcoes && opcoes.headers ? opcoes.headers : {}) };
    // Código de instalação copiado do painel, guardado nas Opções.
    const codigo = (configuracao.apiToken || "").trim();
    if (codigo) cabecalhos["X-API-Token"] = codigo;

    const resposta = await fetch(`${normalizarUrl(configuracao.serverUrl)}${caminho}`, {
      ...opcoes,
      headers: cabecalhos,
      signal: controlador.signal,
    });

    if (!resposta.ok) {
      let detalhe = `HTTP ${resposta.status}`;
      try {
        const corpo = await resposta.json();
        if (corpo && corpo.erro) detalhe = corpo.erro;
      } catch (erro) {
        /* resposta sem JSON */
      }
      if (resposta.status === 401) {
        detalhe = "Código de instalação inválido ou ausente nas Opções.";
      }
      throw new Error(detalhe);
    }
    return await resposta.json();
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------
// Extração local de texto de imagens e PDFs (página offscreen)
// ---------------------------------------------------------------------------

let promessaOffscreen = null;

async function garantirOffscreen() {
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
    if (await chrome.offscreen.hasDocument()) return;
  }
  if (promessaOffscreen) return promessaOffscreen;

  promessaOffscreen = chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS", "BLOBS"],
      justification:
        "Extração local de texto de imagens e PDFs colados nos chats, sem enviar conteúdo a servidores.",
    })
    .catch(async function (erro) {
      // Se a página já existe, o erro é inofensivo.
      try {
        if (await chrome.offscreen.hasDocument()) return;
      } catch (ignorado) {
        /* segue para o erro original */
      }
      throw erro;
    })
    .finally(function () {
      promessaOffscreen = null;
    });

  return promessaOffscreen;
}

function enviarParaOffscreen(mensagem) {
  return new Promise(function (resolver) {
    chrome.runtime.sendMessage(mensagem, function (resposta) {
      if (chrome.runtime.lastError) {
        resolver({ ok: false, erro: chrome.runtime.lastError.message });
        return;
      }
      resolver(resposta || { ok: false, erro: "Sem resposta da página de extração." });
    });
  });
}

async function extrairAnexo(anexo) {
  if (!anexo || !anexo.dados) {
    return { ok: false, erro: "Anexo vazio." };
  }
  if (anexo.tipo !== "imagem" && anexo.tipo !== "pdf") {
    return { ok: false, erro: "Tipo de anexo não suportado." };
  }

  try {
    await garantirOffscreen();
  } catch (erro) {
    return {
      ok: false,
      erro: "Não foi possível iniciar a extração local: " +
        (erro instanceof Error ? erro.message : "erro desconhecido"),
    };
  }

  const resposta = await enviarParaOffscreen({
    tipo: "OFFSCREEN_EXTRAIR",
    anexo: {
      nome: String(anexo.nome || "").slice(0, 120),
      tipo: anexo.tipo,
      mime: String(anexo.mime || ""),
      dados: anexo.dados,
    },
  });

  if (!resposta || resposta.ok === false) {
    return { ok: false, erro: (resposta && resposta.erro) || "Falha na extração local." };
  }

  return { ok: true, texto: String(resposta.texto || "").slice(0, LIMITE_TEXTO_ANEXO) };
}

// ---------------------------------------------------------------------------
// Sincronização de configuração (cache para quando o servidor estiver off)
// ---------------------------------------------------------------------------

/** Nomes de área citados pelas regras, sem repetir. */
function areasDasRegras(regras) {
  const vistos = [];
  (Array.isArray(regras) ? regras : []).forEach(function (regra) {
    const nome = regra && regra.area ? String(regra.area).trim() : "";
    if (nome && vistos.indexOf(nome) < 0) vistos.push(nome);
  });
  return vistos;
}

/**
 * A lista de departamentos vem de `areas` em /api/config. Versões anteriores
 * do servidor não mandavam esse campo, então a lista também é montada a partir
 * da área de cada regra — o seletor funciona com qualquer versão publicada.
 */
function areasDaConfiguracao(config) {
  if (!config) return [];
  if (Array.isArray(config.areas) && config.areas.length) return config.areas.slice();
  return areasDasRegras(config.regras);
}

async function sincronizarConfig(forcar) {
  const cache = await lerArmazenado(CHAVES.cache, null);

  if (!forcar && cache && Date.now() - cache.atualizadoEm < CINCO_MINUTOS) {
    return cache;
  }

  try {
    const configuracao = await obterConfiguracao();
    if (!configuracao.serverUrl) {
      throw new Error("Configure a URL do servidor nas opções.");
    }
    if (!(configuracao.apiToken || "").trim()) {
      throw new Error(
        "Código de instalação não configurado. Abra Opções e cole o código do painel (06 · Instalação).",
      );
    }

    const resposta = await requisitar("/api/config", { method: "GET" });
    if (!resposta || !Array.isArray(resposta.regras) || !resposta.mensagens) {
      throw new Error("Resposta de configuração inválida.");
    }

    const novoCache = {
      regras: resposta.regras,
      mensagens: resposta.mensagens,
      areas: areasDaConfiguracao(resposta),
      atualizadoEm: Date.now(),
    };
    await salvarArmazenado(CHAVES.cache, novoCache);
    await registrarStatus(true, "Configuração sincronizada.");
    return novoCache;
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha de conexão.";
    await registrarStatus(false, `Sem conexão: ${mensagem}`);
    return cache; // cache offline, quando existir
  }
}

// ---------------------------------------------------------------------------
// Alertas (envio direto ao servidor da empresa)
// ---------------------------------------------------------------------------

function sanearAlerta(alerta) {
  const niveis = ["baixo", "medio", "alto"];
  const tipos = Array.isArray(alerta.tipos_detectados) ? alerta.tipos_detectados : [];

  return {
    data_hora:
      typeof alerta.data_hora === "string" && alerta.data_hora
        ? alerta.data_hora
        : new Date().toISOString(),
    site: String(alerta.site || "").slice(0, 120),
    departamento: String(alerta.departamento || "Não informado").slice(0, 80),
    colaborador: alerta.colaborador ? String(alerta.colaborador).slice(0, 80) : null,
    nivel_risco: niveis.indexOf(alerta.nivel_risco) >= 0 ? alerta.nivel_risco : "baixo",
    tipos_detectados: tipos.slice(0, 20).map(function (item) {
      if (typeof item === "string") return { tipo_detectado: item.slice(0, 80), risco: "alto" };
      return {
        tipo_detectado: String(item.tipo_detectado || item.tipo || "").slice(0, 80),
        risco: niveis.indexOf(item.risco) >= 0 ? item.risco : "alto",
        area: item.area ? String(item.area).slice(0, 60) : null,
      };
    }),
    acao: alerta.acao === "cancelou" ? "cancelou" : "enviou",
    evento_id: alerta.evento_id ? String(alerta.evento_id).slice(0, 64) : undefined,
    origem: ["texto", "colagem", "imagem", "pdf", "anexo"].indexOf(alerta.origem) >= 0
      ? alerta.origem
      : "texto",
  };
}

async function enviarAlerta(alerta) {
  const limpo = sanearAlerta(alerta);

  // Sem o código, o servidor recusaria o envio. O aviso aparece no popup na
  // hora, em vez de o alerta sumir sem explicação.
  const configuracao = await obterConfiguracao();

  async function recusar(mensagem) {
    await registrarStatus(false, mensagem);
    await salvarArmazenado(CHAVES.ultimoAlerta, {
      ok: false,
      mensagem: mensagem,
      em: Date.now(),
    });
    return { ok: false, mensagem: mensagem };
  }

  if (!(configuracao.apiToken || "").trim()) {
    return recusar(
      "Código de instalação não configurado. Abra Opções e cole o código do painel (06 · Instalação).",
    );
  }

  // Sem departamento e sem colaborador não há auditoria: o alerta não é
  // anônimo. A extensão só registra com os dois campos preenchidos.
  if (!(configuracao.departamento || "").trim()) {
    return recusar("Departamento não configurado. Abra Opções e escolha o departamento.");
  }
  if (!(configuracao.colaborador || "").trim()) {
    return recusar(
      "Colaborador não configurado. Abra Opções e informe o identificador do colaborador.",
    );
  }

  limpo.departamento = String(configuracao.departamento).trim().slice(0, 80);
  limpo.colaborador = String(configuracao.colaborador).trim().slice(0, 80);

  let ultimaFalha = "Falha ao registrar.";

  // Uma repetição imediata cobre o intervalo em que o Flask está iniciando.
  // Não há fila: o alerta é gravado na hora ou o erro aparece no popup.
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resultado = await requisitar("/api/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limpo),
      });
      await registrarStatus(true, "Alerta registrado.");
      await salvarArmazenado(CHAVES.ultimoAlerta, {
        ok: true,
        mensagem: resultado && resultado.duplicado ? "Alerta já registrado." : "Alerta registrado.",
        em: Date.now(),
      });
      return {
        ok: true,
        id: resultado && resultado.id,
        duplicado: !!(resultado && resultado.duplicado),
      };
    } catch (erro) {
      ultimaFalha = erro instanceof Error ? erro.message : "Falha ao registrar.";
      if (tentativa === TENTATIVAS) break;
      await new Promise(function (resolver) {
        setTimeout(resolver, 400);
      });
    }
  }

  await registrarStatus(false, `Alerta não registrado: ${ultimaFalha}`);
  await salvarArmazenado(CHAVES.ultimoAlerta, {
    ok: false,
    mensagem: ultimaFalha,
    em: Date.now(),
  });
  return { ok: false, mensagem: ultimaFalha };
}

// ---------------------------------------------------------------------------
// Mensagens das páginas (content script, popup e opções)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (mensagem, remetente, responder) {
  if (!mensagem || !mensagem.tipo) return false;

  (async function () {
    try {
      if (mensagem.tipo === "OBTER_CONFIG") {
        const cache = await sincronizarConfig(false);
        responder({ ok: true, cache: cache });
        return;
      }

      if (mensagem.tipo === "OBTER_AREAS") {
        const configuracao = {
          serverUrl: normalizarUrl(mensagem.serverUrl || CONFIGURACAO_PADRAO.serverUrl),
          apiToken: String(mensagem.apiToken || "").trim(),
        };
        if (!configuracao.apiToken) {
          responder({ ok: false, erro: "Cole o código de instalação para carregar os departamentos." });
          return;
        }
        try {
          const resposta = await requisitar("/api/config", { method: "GET" }, configuracao);
          responder({
            ok: true,
            areas: areasDaConfiguracao(resposta),
          });
        } catch (erro) {
          responder({
            ok: false,
            erro: erro instanceof Error ? erro.message : "Servidor indisponível.",
          });
        }
        return;
      }

      if (mensagem.tipo === "SINCRONIZAR_AGORA") {
        const cache = await sincronizarConfig(true);
        responder({ ok: Boolean(cache), cache: cache });
        return;
      }

      if (mensagem.tipo === "REGISTRAR_ALERTA") {
        responder(await enviarAlerta(mensagem.alerta || {}));
        return;
      }

      if (mensagem.tipo === "EXTRAIR_ANEXO") {
        responder(await extrairAnexo(mensagem.anexo || {}));
        return;
      }

      if (mensagem.tipo === "TESTAR_CONEXAO") {
        try {
          const inicio = Date.now();
          // /api/config também confere o código de instalação: se o endereço
          // estiver certo mas o código errado, o erro aparece aqui.
          const resposta = await requisitar("/api/config", { method: "GET" });
          const totalRegras = resposta && Array.isArray(resposta.regras) ? resposta.regras.length : 0;
          await registrarStatus(true, "Conexão estabelecida.");
          responder({
            ok: true,
            mensagem: `Servidor online · ${totalRegras} regra(s).`,
            latenciaMs: Date.now() - inicio,
          });
        } catch (erro) {
          const texto = erro instanceof Error ? erro.message : "Servidor indisponível.";
          await registrarStatus(false, texto);
          responder({ ok: false, mensagem: texto });
        }
        return;
      }

      if (mensagem.tipo === "OBTER_ESTADO") {
        const [configuracao, status, cache, ultimoAlerta] = await Promise.all([
          obterConfiguracao(),
          lerArmazenado(CHAVES.status, null),
          lerArmazenado(CHAVES.cache, null),
          lerArmazenado(CHAVES.ultimoAlerta, null),
        ]);
        responder({
          ok: true,
          configuracao: configuracao,
          status: status,
          ultimoAlerta: ultimoAlerta,
          cache: cache
            ? {
                totalRegras: cache.regras ? cache.regras.length : 0,
                atualizadoEm: cache.atualizadoEm,
                areas:
                  Array.isArray(cache.areas) && cache.areas.length
                    ? cache.areas
                    : areasDasRegras(cache.regras),
              }
            : null,
        });
        return;
      }

      responder({ ok: false, erro: "Mensagem desconhecida." });
    } catch (erro) {
      responder({
        ok: false,
        erro: erro instanceof Error ? erro.message : "Erro inesperado no service worker.",
      });
    }
  })();

  return true; // resposta assíncrona
});

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/**
 * Quem já tinha a extensão salva com o endereço antigo de teste (localhost) é
 * movido uma única vez para o servidor da empresa, para não continuar enviando
 * alertas para a própria máquina. A marca fica gravada: se a pessoa voltar a
 * usar http://localhost:5000 de propósito, o valor dela é respeitado.
 */
async function migrarServidorPadrao() {
  if (await lerArmazenado(CHAVES.migracaoServidor, false)) return;
  const salva = await lerArmazenado(CHAVES.configuracao, null);
  const endereco = String((salva && salva.serverUrl) || "").trim();
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(endereco)) {
    await salvarArmazenado(CHAVES.configuracao, { ...salva, serverUrl: SERVIDOR_PADRAO });
  }
  await salvarArmazenado(CHAVES.migracaoServidor, true);
}

chrome.runtime.onInstalled.addListener(async function () {
  const salva = await lerArmazenado(CHAVES.configuracao, null);
  if (!salva) await salvarArmazenado(CHAVES.configuracao, CONFIGURACAO_PADRAO);
  await migrarServidorPadrao();
  // Versões antigas guardavam alertas numa fila; a 2.1 envia direto.
  await chrome.storage.local.remove(CHAVES.filaAntiga);

  // Primeira instalação (ou reinstalação, que apaga as Opções): abre a tela
  // para colar o código, em vez de ficar recusando alertas em silêncio.
  const configuracao = await obterConfiguracao();
  if (!(configuracao.apiToken || "").trim()) {
    await registrarStatus(false, "Código de instalação não configurado.");
    await chrome.runtime.openOptionsPage();
    return;
  }
  await sincronizarConfig(true);
});

chrome.storage.onChanged.addListener(function (mudancas, area) {
  if (area !== "local" || !mudancas[CHAVES.configuracao]) return;
  void sincronizarConfig(true);
});
