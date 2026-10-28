/**
 * Sentinela — service worker (Manifest V3).
 *
 * Centraliza TODAS as chamadas de rede, evitando CORS/mixed content nas
 * páginas das IAs. Funciona igual no Chrome e no Microsoft Edge.
 *
 * Quando o servidor está na própria máquina (127.0.0.1), o alerta é enviado
 * direto, sem código. Quando está publicado na nuvem, cada pedido leva o
 * código de instalação (X-API-Token) configurado nas Opções.
 * Sem fila e sem alarmes de reenvio: o cache de regras existe só para o aviso
 * continuar funcionando quando o servidor estiver fora do ar.
 */
"use strict";

const CINCO_MINUTOS = 5 * 60 * 1000;
const LIMITE_TEXTO_ANEXO = 60000;
const TIMEOUT_MS = 6000;
const TENTATIVAS = 2;

// Endereço do servidor da empresa. Fica fixo aqui para que uma instalação nova
// já nasça apontada para a nuvem, sem ninguém precisar digitar o endereço.
// Para testar na própria máquina, basta trocar por http://localhost:5000 nas
// Opções da extensão.
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
  ],
};

const CHAVES = {
  configuracao: "configuracao",
  cache: "cacheConfig",
  status: "statusConexao",
  filaAntiga: "filaAlertas",
  migracaoServidor: "migracaoServidorNuvem",
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

async function requisitar(caminho, opcoes) {
  const configuracao = await obterConfiguracao();
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const cabecalhos = { ...(opcoes && opcoes.headers ? opcoes.headers : {}) };
    // Servidor na nuvem: identificação da empresa em cada pedido.
    if (configuracao.apiToken) cabecalhos["X-API-Token"] = configuracao.apiToken;

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

    const resposta = await requisitar("/api/config", { method: "GET" });
    if (!resposta || !Array.isArray(resposta.regras) || !resposta.mensagens) {
      throw new Error("Resposta de configuração inválida.");
    }

    const novoCache = {
      regras: resposta.regras,
      mensagens: resposta.mensagens,
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
// Alertas (envio direto ao servidor local)
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
        const [configuracao, status, cache] = await Promise.all([
          obterConfiguracao(),
          lerArmazenado(CHAVES.status, null),
          lerArmazenado(CHAVES.cache, null),
        ]);
        responder({
          ok: true,
          configuracao: configuracao,
          status: status,
          cache: cache
            ? {
                totalRegras: cache.regras ? cache.regras.length : 0,
                atualizadoEm: cache.atualizadoEm,
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
 * Quem já tinha a extensão salva com o padrão antigo (localhost) é movido uma
 * única vez para o servidor da empresa, para não continuar enviando alertas
 * para a própria máquina. A marca fica gravada: se a pessoa voltar a usar
 * http://localhost:5000 de propósito, o valor dela é respeitado.
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
  await sincronizarConfig(true);
});

chrome.storage.onChanged.addListener(function (mudancas, area) {
  if (area !== "local" || !mudancas[CHAVES.configuracao]) return;
  void sincronizarConfig(true);
});
