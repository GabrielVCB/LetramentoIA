/** Sentinela — página de opções. */
"use strict";

const SITES_DISPONIVEIS = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "claude.ai",
  "copilot.cloud.microsoft",
  "copilot.microsoft.com",
  "copilot.com",
];

// Endereço padrão: o servidor da empresa na nuvem.
const PADROES = {
  serverUrl: "https://sentinela-r7ge.onrender.com",
  apiToken: "",
  departamento: "",
  colaborador: "",
  monitoramentoAtivo: true,
  sitesAtivos: SITES_DISPONIVEIS.slice(),
};

const el = {};
let avisoPermissao = "";

/**
 * Servidor na internet exige permissão do navegador para ser acessado.
 * A permissão é pedida na hora de salvar, com o endereço exato informado.
 */
async function garantirPermissao(url) {
  if (!/^https?:\/\//i.test(url)) return { ok: true };
  let origem = "";
  try {
    origem = new URL(url).origin + "/*";
  } catch (erro) {
    return { ok: false, mensagem: "URL inválida." };
  }

  try {
    if (await chrome.permissions.contains({ origins: [origem] })) return { ok: true };
    const concedido = await chrome.permissions.request({ origins: [origem] });
    return concedido
      ? { ok: true }
      : {
          ok: false,
          mensagem:
            "O navegador não autorizou o acesso a " +
            origem.replace(/\/\*$/, "") +
            ". Clique em Salvar novamente e escolha Permitir.",
        };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : "Falha ao pedir permissão." };
  }
}

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

/**
 * Departamentos vêm das áreas cadastradas no painel, para ninguém digitar um
 * nome que não existe. A primeira opção é sempre “Não informado”.
 */
function montarDepartamentos(areas, atual) {
  const lista = Array.isArray(areas) ? areas.slice() : [];
  const escolhido = String(atual || "");
  // Um valor antigo, gravado antes da lista existir, continua aparecendo.
  if (escolhido && lista.indexOf(escolhido) < 0) lista.unshift(escolhido);

  el.departamento.replaceChildren();
  const vazia = document.createElement("option");
  vazia.value = "";
  vazia.textContent = "Não informado";
  el.departamento.appendChild(vazia);

  lista.forEach(function (nome) {
    const opcao = document.createElement("option");
    opcao.value = nome;
    opcao.textContent = nome;
    el.departamento.appendChild(opcao);
  });

  el.departamento.value = escolhido;
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
  montarDepartamentos(estado.cache ? estado.cache.areas : [], configuracao.departamento);
  el.colaborador.value = configuracao.colaborador || "";
  el.ativo.checked = Boolean(configuracao.monitoramentoAtivo);
  montarSites(Array.isArray(configuracao.sitesAtivos) ? configuracao.sitesAtivos : SITES_DISPONIVEIS);
  atualizarResumo(estado);
}

async function salvar(silencioso) {
  const servidor = el.servidor.value.trim();
  const departamento = el.departamento.value.trim();

  if (!/^https?:\/\//i.test(servidor)) {
    avisar(el.resultadoSalvar, "A URL deve começar com http:// ou https://.", "erro");
    return false;
  }

  const codigo = el.token.value.trim();
  if (!codigo) {
    avisar(
      el.resultadoSalvar,
      "Cole o código de instalação que aparece no painel, em 06 · Instalação.",
      "erro",
    );
    return false;
  }

  const permissao = await garantirPermissao(servidor);
  avisoPermissao = permissao.ok ? "" : permissao.mensagem || "";

  const configuracao = {
    serverUrl: servidor.replace(/\/+$/, ""),
    apiToken: codigo,
    departamento: departamento,
    colaborador: el.colaborador.value.trim(),
    monitoramentoAtivo: el.ativo.checked,
    sitesAtivos: sitesSelecionados(),
  };

  await chrome.storage.local.set({ configuracao: configuracao });

  if (!silencioso) {
    // Sincroniza na hora: confirma o código e já carrega a lista de departamentos.
    const sincronizado = await enviar({ tipo: "SINCRONIZAR_AGORA" });
    if (avisoPermissao) {
      avisar(el.resultadoSalvar, "Configurações salvas. " + avisoPermissao, "erro");
    } else if (!sincronizado.ok) {
      avisar(
        el.resultadoSalvar,
        "Configurações salvas, mas o servidor recusou o código. Copie o valor de 06 · Instalação e salve de novo.",
        "erro",
      );
    } else {
      avisar(el.resultadoSalvar, "Configurações salvas e código aceito.", "ok");
      setTimeout(function () {
        el.resultadoSalvar.textContent = "";
      }, 3000);
    }
    await carregar();
  }
  return true;
}

async function testar() {
  const salvo = await salvar(true);
  if (!salvo) return;
  if (avisoPermissao) {
    avisar(el.resultadoConexao, avisoPermissao, "erro");
    return;
  }
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

document.addEventListener("DOMContentLoaded", function () {
  el.servidor = document.getElementById("servidor");
  el.token = document.getElementById("token");
  el.departamento = document.getElementById("departamento");
  el.colaborador = document.getElementById("colaborador");
  el.ativo = document.getElementById("ativo");
  el.sites = document.getElementById("sites");
  el.regras = document.getElementById("regras");
  el.sincronizacao = document.getElementById("sincronizacao");
  el.statusPonto = document.getElementById("status-ponto");
  el.resultadoConexao = document.getElementById("resultado-conexao");
  el.resultadoSalvar = document.getElementById("resultado-salvar");
  el.testar = document.getElementById("testar");
  el.sincronizar = document.getElementById("sincronizar");
  el.salvar = document.getElementById("salvar");

  el.testar.addEventListener("click", testar);
  el.sincronizar.addEventListener("click", sincronizar);
  el.salvar.addEventListener("click", function () {
    void salvar(false);
  });

  void carregar();
});
