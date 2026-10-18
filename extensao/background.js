/**
 * Sentinela — service worker (Manifest V3).
 *
 * Centraliza TODAS as chamadas de rede, evitando CORS/mixed content nas
 * páginas das IAs. Sincroniza regras e mensagens a cada 5 minutos via
 * chrome.alarms, mantém cache offline e reenvia alertas em fila.
 */
"use strict";

const ALARME_SINCRONIA = "sentinela-sincronizar";
const CINCO_MINUTOS = 5;
const LIMITE_FILA = 100;
const TIMEOUT_MS = 8000;

const CONFIGURACAO_PADRAO = {
  serverUrl: "http://localhost:5000",
  apiToken: "dev-token-sentinela",
  departamento: "",
  colaborador: "",
  monitoramentoAtivo: true,
  sitesAtivos: [
    "chatgpt.com",
    "chat.openai.com",
    "gemini.google.com",
    "claude.ai",
    "copilot.microsoft.com",
  ],
};

const CHAVES = {
  configuracao: "configuracao",
  cache: "cacheConfig",
  status: "statusConexao",
  fila: "filaAlertas",
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
    const resposta = await fetch(`${normalizarUrl(configuracao.serverUrl)}${caminho}`, {
      ...opcoes,
      headers: {
        "X-API-Token": configuracao.apiToken || "",
        ...(opcoes && opcoes.headers ? opcoes.headers : {}),
      },
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
      throw new Error(detalhe);
    }
    return await resposta.json();
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------
// Sincronização de configuração
// ---------------------------------------------------------------------------

async function sincronizarConfig(forcar) {
  const cache = await lerArmazenado(CHAVES.cache, null);

  if (!forcar && cache && Date.now() - cache.atualizadoEm < CINCO_MINUTOS * 60 * 1000) {
    return cache;
  }

  try {
    const configuracao = await obterConfiguracao();
    if (!configuracao.serverUrl || !configuracao.apiToken) {
      throw new Error("Configure a URL do servidor e o token de API nas opções.");
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
// Alertas e fila offline
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
  };
}

async function enviarAlerta(alerta) {
  const limpo = sanearAlerta(alerta);
  try {
    await requisitar("/api/alertas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(limpo),
    });
    await registrarStatus(true, "Alerta registrado.");
    return { ok: true };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao registrar.";
    const fila = await lerArmazenado(CHAVES.fila, []);
    fila.push({ alerta: limpo, criadoEm: Date.now() });
    await salvarArmazenado(CHAVES.fila, fila.slice(-LIMITE_FILA));
    await registrarStatus(false, `Alerta na fila: ${mensagem}`);
    return { ok: false, mensagem };
  }
}

async function reenviarFila() {
  const fila = await lerArmazenado(CHAVES.fila, []);
  if (fila.length === 0) return { enviados: 0, restantes: 0 };

  const restantes = [];
  let enviados = 0;

  for (const item of fila) {
    try {
      await requisitar("/api/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.alerta),
      });
      enviados += 1;
    } catch (erro) {
      restantes.push(item);
    }
  }

  await salvarArmazenado(CHAVES.fila, restantes);
  if (enviados > 0) {
    await registrarStatus(restantes.length === 0, `${enviados} alerta(s) reenviado(s).`);
  }
  return { enviados: enviados, restantes: restantes.length };
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

      if (mensagem.tipo === "TESTAR_CONEXAO") {
        try {
          const inicio = Date.now();
          const resposta = await requisitar("/api/ping", { method: "GET" });
          await registrarStatus(true, "Conexão estabelecida.");
          responder({
            ok: true,
            mensagem: resposta && resposta.mensagem ? resposta.mensagem : "Servidor online.",
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
        const [configuracao, status, cache, fila] = await Promise.all([
          obterConfiguracao(),
          lerArmazenado(CHAVES.status, null),
          lerArmazenado(CHAVES.cache, null),
          lerArmazenado(CHAVES.fila, []),
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
          fila: fila.length,
        });
        return;
      }

      if (mensagem.tipo === "REABRIR_FILA") {
        responder({ ok: true, ...(await reenviarFila()) });
        return;
      }

      if (mensagem.tipo === "LIMPAR_FILA") {
        await salvarArmazenado(CHAVES.fila, []);
        responder({ ok: true });
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

async function garantirAlarme() {
  const existente = await chrome.alarms.get(ALARME_SINCRONIA);
  if (!existente) {
    chrome.alarms.create(ALARME_SINCRONIA, { periodInMinutes: CINCO_MINUTOS });
  }
}

chrome.runtime.onInstalled.addListener(async function () {
  const salva = await lerArmazenado(CHAVES.configuracao, null);
  if (!salva) await salvarArmazenado(CHAVES.configuracao, CONFIGURACAO_PADRAO);
  await garantirAlarme();
  await sincronizarConfig(true);
  await reenviarFila();
});

chrome.runtime.onStartup.addListener(async function () {
  await garantirAlarme();
  await reenviarFila();
});

chrome.alarms.onAlarm.addListener(async function (alarme) {
  if (alarme.name !== ALARME_SINCRONIA) return;
  await sincronizarConfig(true);
  await reenviarFila();
});

chrome.storage.onChanged.addListener(function (mudancas, area) {
  if (area !== "local" || !mudancas[CHAVES.configuracao]) return;
  void sincronizarConfig(true);
});
