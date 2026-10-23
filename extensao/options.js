/** Sentinela — página de opções. */
"use strict";

const SITES_DISPONIVEIS = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "claude.ai",
  "copilot.microsoft.com",
];

const PADROES = {
  serverUrl: "http://localhost:5000",
  apiToken: "dev-token-sentinela",
  departamento: "",
  colaborador: "",
  monitoramentoAtivo: true,
  sitesAtivos: SITES_DISPONIVEIS.slice(),
};

const el = {};

function enviar(mensagem) {
  return new Promise(function (resolver) {
    try {
      chrome.runtime.sendMessage(mensagem, function (resposta) {
        if (chrome.runtime.lastError) {
          resolver({ ok: false, erro: chrome.runtime.lastError.message });
          return;
        }
        resolver(resposta || { ok: false, erro: "Sem resposta do service worker." });
      });
    } catch (erro) {
      resolver({ ok: false, erro: erro.message });
    }
  });
}

function avisar(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = "resultado " + (tipo || "");
}

function quando(ms) {
  if (!ms) return "nunca";
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function montarSites(ativos) {
  el.sites.replaceChildren();
  SITES_DISPONIVEIS.forEach(function (site) {
    const rotulo = document.createElement("label");
    rotulo.className = "site";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = site;
    checkbox.checked = ativos.indexOf(site) >= 0;
    const texto = document.createElement("span");
    texto.textContent = site;
    rotulo.appendChild(checkbox);
    rotulo.appendChild(texto);
    el.sites.appendChild(rotulo);
  });
}

function sitesSelecionados() {
  return Array.from(el.sites.querySelectorAll("input[type=checkbox]:checked")).map(
    function (checkbox) {
      return checkbox.value;
    },
  );
}

function atualizarResumo(estado) {
  el.regras.textContent = estado.cache ? estado.cache.totalRegras : 0;
  el.sincronizacao.textContent = estado.cache ? quando(estado.cache.atualizadoEm) : "nunca";
  el.fila.textContent = estado.fila || 0;

  const status = estado.status;
  el.statusPonto.className =
    "ponto-status " + (status && status.conectado ? "on" : "off");
  if (status && status.mensagem) {
    el.sincronizacao.title = status.mensagem;
  }
}

async function carregar() {
  const estado = await enviar({ tipo: "OBTER_ESTADO" });
  if (!estado.ok) {
    avisar(el.resultadoConexao, estado.erro || "Falha ao carregar o estado.", "erro");
    return;
  }

  const configuracao = Object.assign({}, PADROES, estado.configuracao || {});
  el.servidor.value = configuracao.serverUrl || "";
  el.token.value = configuracao.apiToken || "";
  el.departamento.value = configuracao.departamento || "";
  el.colaborador.value = configuracao.colaborador || "";
  el.ativo.checked = Boolean(configuracao.monitoramentoAtivo);
  montarSites(Array.isArray(configuracao.sitesAtivos) ? configuracao.sitesAtivos : SITES_DISPONIVEIS);
  atualizarResumo(estado);
}

async function salvar(silencioso) {
  const servidor = el.servidor.value.trim();
  const token = el.token.value.trim();
  const departamento = el.departamento.value.trim();

  if (!/^https?:\/\//i.test(servidor)) {
    avisar(el.resultadoSalvar, "A URL deve começar com http:// ou https://.", "erro");
    return false;
  }
  if (!token) {
    avisar(el.resultadoSalvar, "Informe o token de API definido no servidor.", "erro");
    return false;
  }

  const configuracao = {
    serverUrl: servidor.replace(/\/+$/, ""),
    apiToken: token,
    departamento: departamento,
    colaborador: el.colaborador.value.trim(),
    monitoramentoAtivo: el.ativo.checked,
    sitesAtivos: sitesSelecionados(),
  };

  await chrome.storage.local.set({ configuracao: configuracao });
  if (!silencioso) {
    avisar(el.resultadoSalvar, "Configurações salvas.", "ok");
    setTimeout(function () {
      el.resultadoSalvar.textContent = "";
    }, 2500);
  }
  return true;
}

async function testar() {
  const salvo = await salvar(true);
  if (!salvo) return;
  el.testar.disabled = true;
  el.testar.textContent = "Testando…";
  const resposta = await enviar({ tipo: "TESTAR_CONEXAO" });
  el.testar.disabled = false;
  el.testar.textContent = "Testar conexão";

  if (resposta.ok) {
    avisar(
      el.resultadoConexao,
      "Conectado em " + (resposta.latenciaMs || 0) + " ms. " + (resposta.mensagem || ""),
      "ok",
    );
  } else {
    avisar(
      el.resultadoConexao,
      "Falha: " + (resposta.mensagem || resposta.erro || "servidor indisponível"),
      "erro",
    );
  }
  atualizarResumo(await enviar({ tipo: "OBTER_ESTADO" }));
}

async function sincronizar() {
  const salvo = await salvar(true);
  if (!salvo) return;
  el.sincronizar.disabled = true;
  el.sincronizar.textContent = "Sincronizando…";
  const resposta = await enviar({ tipo: "SINCRONIZAR_AGORA" });
  el.sincronizar.disabled = false;
  el.sincronizar.textContent = "Sincronizar regras agora";

  if (resposta.ok && resposta.cache) {
    avisar(
      el.resultadoConexao,
      resposta.cache.regras.length + " regra(s) sincronizada(s).",
      "ok",
    );
  } else {
    avisar(el.resultadoConexao, "Não foi possível sincronizar agora. O cache anterior foi mantido.", "erro");
  }
  atualizarResumo(await enviar({ tipo: "OBTER_ESTADO" }));
}

async function reenviarFila() {
  const resposta = await enviar({ tipo: "REABRIR_FILA" });
  avisar(
    el.resultadoFila,
    resposta.ok
      ? (resposta.enviados || 0) + " enviado(s), " + (resposta.restantes || 0) + " na fila."
      : resposta.erro || "Falha ao reenviar.",
    resposta.ok ? "ok" : "erro",
  );
  atualizarResumo(await enviar({ tipo: "OBTER_ESTADO" }));
}

async function limparFila() {
  if (!window.confirm("Descartar todos os alertas que estão na fila local?")) return;
  await enviar({ tipo: "LIMPAR_FILA" });
  avisar(el.resultadoFila, "Fila local esvaziada.", "ok");
  atualizarResumo(await enviar({ tipo: "OBTER_ESTADO" }));
}

document.addEventListener("DOMContentLoaded", function () {
  el.servidor = document.getElementById("servidor");
  el.token = document.getElementById("token");
  el.departamento = document.getElementById("departamento");
  el.colaborador = document.getElementById("colaborador");
  el.ativo = document.getElementById("ativo");
  el.sites = document.getElementById("sites");
  el.regras = document.getElementById("regras");
  el.sincronizacao = document.getElementById("sincronizacao");
  el.fila = document.getElementById("fila");
  el.statusPonto = document.getElementById("status-ponto");
  el.resultadoConexao = document.getElementById("resultado-conexao");
  el.resultadoSalvar = document.getElementById("resultado-salvar");
  el.resultadoFila = document.getElementById("resultado-fila");
  el.testar = document.getElementById("testar");
  el.sincronizar = document.getElementById("sincronizar");
  el.reenviar = document.getElementById("reenviar");
  el.limparFila = document.getElementById("limpar-fila");
  el.salvar = document.getElementById("salvar");

  el.testar.addEventListener("click", testar);
  el.sincronizar.addEventListener("click", sincronizar);
  el.reenviar.addEventListener("click", reenviarFila);
  el.limparFila.addEventListener("click", limparFila);
  el.salvar.addEventListener("click", function () {
    void salvar(false);
  });

  void carregar();
});
