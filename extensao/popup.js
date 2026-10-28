/** Sentinela — popup: status resumido e teste de conexão. */
"use strict";

const elementos = {};

function formatarQuando(ms) {
  if (!ms) return "—";
  var diferenca = Date.now() - ms;
  if (diferenca < 60 * 1000) return "agora";
  if (diferenca < 60 * 60 * 1000) return Math.floor(diferenca / 60000) + " min atrás";
  if (diferenca < 24 * 60 * 60 * 1000) return Math.floor(diferenca / 3600000) + " h atrás";
  return new Date(ms).toLocaleDateString("pt-BR");
}

async function enviar(mensagem) {
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

function pintarStatus(conectado, texto) {
  var ponto = elementos.statusPonto;
  ponto.className = "ponto-status " + (conectado ? "on" : "off");
  elementos.statusTexto.textContent = texto || (conectado ? "Servidor conectado" : "Servidor offline");
}

async function carregar() {
  const estado = await enviar({ tipo: "OBTER_ESTADO" });
  if (!estado.ok) {
    pintarStatus(false, "Não foi possível ler a configuração.");
    return;
  }

  const configuracao = estado.configuracao || {};
  elementos.monitoramento.checked = Boolean(configuracao.monitoramentoAtivo);
  elementos.departamento.textContent = configuracao.departamento || "não configurado";
  elementos.colaborador.textContent = configuracao.colaborador || "anônimo";
  elementos.servidor.textContent = configuracao.serverUrl || "—";
  elementos.regras.textContent = estado.cache ? estado.cache.totalRegras : 0;
  elementos.sincronizacao.textContent = estado.cache
    ? formatarQuando(estado.cache.atualizadoEm)
    : "nunca";

  if (!configuracao.departamento) {
    pintarStatus(false, "Configure o departamento nas opções.");
  } else if (estado.status && estado.status.conectado) {
    pintarStatus(true, estado.status.mensagem || "Servidor conectado");
  } else if (estado.status && estado.status.mensagem) {
    pintarStatus(false, estado.status.mensagem);
  } else {
    pintarStatus(false, "Nenhuma sincronização ainda.");
  }
}

async function alternarMonitoramento(evento) {
  const ativo = evento.target.checked;
  const estado = await enviar({ tipo: "OBTER_ESTADO" });
  const configuracao = Object.assign({}, estado.configuracao || {}, {
    monitoramentoAtivo: ativo,
  });
  await chrome.storage.local.set({ configuracao: configuracao });
  pintarStatus(
    Boolean(estado.status && estado.status.conectado),
    ativo ? "Monitoramento ativado." : "Monitoramento desativado.",
  );
}

async function testarConexao() {
  elementos.testar.disabled = true;
  elementos.testar.textContent = "Testando…";
  const resposta = await enviar({ tipo: "TESTAR_CONEXAO" });
  elementos.testar.disabled = false;
  elementos.testar.textContent = "Testar conexão";
  pintarStatus(
    Boolean(resposta.ok),
    resposta.ok
      ? "Online · " + (resposta.latenciaMs || 0) + " ms"
      : "Falha: " + (resposta.mensagem || resposta.erro || "servidor indisponível"),
  );
}

document.addEventListener("DOMContentLoaded", function () {
  elementos.statusPonto = document.getElementById("status-ponto");
  elementos.statusTexto = document.getElementById("status-texto");
  elementos.monitoramento = document.getElementById("monitoramento");
  elementos.departamento = document.getElementById("departamento");
  elementos.colaborador = document.getElementById("colaborador");
  elementos.servidor = document.getElementById("servidor");
  elementos.regras = document.getElementById("regras");
  elementos.sincronizacao = document.getElementById("sincronizacao");
  elementos.testar = document.getElementById("testar");
  elementos.opcoes = document.getElementById("opcoes");

  elementos.monitoramento.addEventListener("change", alternarMonitoramento);
  elementos.testar.addEventListener("click", testarConexao);
  elementos.opcoes.addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  void carregar();
});
