/**
 * Sentinela — content script.
 *
 * Lê o campo de texto das IAs, analisa localmente com debounce de 400 ms,
 * injeta um aviso em Shadow DOM (imune ao CSS do site) e intercepta o envio
 * quando o risco é médio ou alto. O alerta enviado ao service worker contém
 * apenas metadados — nunca o texto digitado.
 */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Seletores centralizados por site (fáceis de manter quando o DOM muda).
  // -------------------------------------------------------------------------
  var SITES = {
    "chatgpt.com": {
      nome: "ChatGPT",
      campos: [
        "#prompt-textarea",
        'div[contenteditable="true"]#prompt-textarea',
        'textarea[data-testid="prompt-textarea"]',
        'form textarea',
        'div[contenteditable="true"]',
      ],
      enviar: [
        '[data-testid="send-button"]',
        "#composer-submit-button",
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]',
      ],
    },
    "chat.openai.com": {
      nome: "ChatGPT",
      campos: ["#prompt-textarea", "textarea", 'div[contenteditable="true"]'],
      enviar: [
        '[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]',
      ],
    },
    "gemini.google.com": {
      nome: "Gemini",
      campos: [
        'rich-textarea div[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"]',
        "textarea",
      ],
      enviar: [
        'button[aria-label*="Send message"]',
        'button[aria-label*="Enviar"]',
        'button.send-button',
        'button[aria-label*="Send"]',
      ],
    },
    "claude.ai": {
      nome: "Claude",
      campos: [
        'div[contenteditable="true"].ProseMirror',
        'div[contenteditable="true"]',
        "textarea",
      ],
      enviar: [
        'button[aria-label="Send Message"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]',
        'button[type="submit"]',
      ],
    },
    "copilot.microsoft.com": {
      nome: "Copilot",
      campos: [
        "textarea#userInput",
        'textarea[data-testid="composer-input"]',
        "textarea[placeholder]",
        'div[contenteditable="true"]',
      ],
      enviar: [
        'button[data-testid="submit-button"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Enviar"]',
        'button[title*="Send"]',
      ],
    },
  };

  // Espelho local das mensagens padrão (fallback quando o servidor nunca respondeu).
  var MENSAGENS_PADRAO = {
    baixo:
      "Não foram identificados os tipos de informações corporativas analisados pelo sistema. Ainda assim, revise o conteúdo antes de compartilhá-lo.",
    medio:
      "Esta informação contém dados internos que podem apresentar riscos à empresa. Evite compartilhar informações desnecessárias e verifique as regras de uso de IA da empresa antes do compartilhamento.",
    alto:
      "Esta informação contém dados confidenciais, pessoais, estratégicos ou relacionados à segurança da empresa. Não compartilhe com uma IA pública. Remova os dados sensíveis ou utilize uma ferramenta de IA corporativa autorizada.",
  };

  var CONFIGURACAO_PADRAO = {
    serverUrl: "http://localhost:5000",
    apiToken: "dev-token-sentinela",
    departamento: "",
    colaborador: "",
    monitoramentoAtivo: true,
    sitesAtivos: Object.keys(SITES),
  };

  var ROTULOS = { baixo: "Baixo", medio: "Médio", alto: "Alto" };
  var estado = {
    settings: CONFIGURACAO_PADRAO,
    config: { regras: [], mensagens: MENSAGENS_PADRAO },
    site: null,
    campo: null,
    analise: { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 },
    textoAnalisado: "",
    timer: null,
    host: null,
    shadow: null,
    raizBanner: null,
    raizModal: null,
    modalAberto: false,
    bannerOculto: false,
    permitirEnvio: false,
    ultimoBotao: null,
    ultimoRegistro: null,
    observador: null,
  };

  // -------------------------------------------------------------------------
  // Inicialização
  // -------------------------------------------------------------------------

  function detectarSite() {
    var host = location.hostname.replace(/^www\./, "");
    var chaves = Object.keys(SITES);
    for (var i = 0; i < chaves.length; i++) {
      if (host === chaves[i] || host.endsWith("." + chaves[i])) return SITES[chaves[i]];
    }
    return null;
  }

  function siteAutorizado() {
    var host = location.hostname.replace(/^www\./, "");
    var ativos = estado.settings.sitesAtivos || [];
    return ativos.some(function (item) {
      return host === item || host.endsWith("." + item);
    });
  }

  function monitoramentoAtivo() {
    return Boolean(estado.settings.monitoramentoAtivo) && siteAutorizado();
  }

  function iniciar() {
    estado.site = detectarSite();
    if (!estado.site) return;

    chrome.storage.local.get(["configuracao", "cacheConfig"], function (dados) {
      estado.settings = Object.assign({}, CONFIGURACAO_PADRAO, dados.configuracao || {});
      if (dados.cacheConfig && dados.cacheConfig.mensagens) {
        estado.config = dados.cacheConfig;
      }
      if (!monitoramentoAtivo()) return;

      criarInterface();
      observarCampo();
      registrarEventos();
      solicitarConfig();
    });
  }

  function solicitarConfig() {
    try {
      chrome.runtime.sendMessage({ tipo: "OBTER_CONFIG" }, function (resposta) {
        if (chrome.runtime.lastError) return;
        if (resposta && resposta.cache) aplicarConfig(resposta.cache);
      });
    } catch (erro) {
      /* extensão recarregada: a página será atualizada pelo usuário */
    }
  }

  function aplicarConfig(cache) {
    if (!cache) return;
    estado.config = {
      regras: Array.isArray(cache.regras) ? cache.regras : [],
      mensagens: Object.assign({}, MENSAGENS_PADRAO, cache.mensagens || {}),
    };
    if (estado.textoAnalisado) analisar();
  }

  // -------------------------------------------------------------------------
  // Campo de entrada e posicionamento
  // -------------------------------------------------------------------------

  function observarCampo() {
    localizarCampo();

    estado.observador = new MutationObserver(function () {
      localizarCampo();
    });
    estado.observador.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Alguns sites montam o editor apenas após interação do usuário.
    setInterval(localizarCampo, 1500);
    window.addEventListener("resize", posicionar, { passive: true });
    window.addEventListener("scroll", posicionar, { passive: true });
  }

  function localizarCampo() {
    if (!estado.site || !monitoramentoAtivo()) return;
    var seletor = estado.site.campos.join(",");
    var campo = null;
    try {
      campo = document.querySelector(seletor);
    } catch (erro) {
      campo = null;
    }

    if (!campo) {
      estado.campo = null;
      posicionar();
      return;
    }

    if (campo !== estado.campo) {
      estado.campo = campo;
      var texto = lerTexto();
      if (texto.trim()) {
        agendarAnalise();
      } else {
        estado.analise = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
        estado.textoAnalisado = "";
        estado.bannerOculto = false;
        renderizarBanner();
      }
    }
    posicionar();
  }

  function ehCampo(alvo) {
    if (!alvo || !estado.campo) return false;
    return alvo === estado.campo || estado.campo.contains(alvo);
  }

  function lerTexto() {
    if (!estado.campo) return "";
    if (
      estado.campo.tagName === "TEXTAREA" ||
      estado.campo.tagName === "INPUT"
    ) {
      return estado.campo.value || "";
    }
    return estado.campo.innerText || estado.campo.textContent || "";
  }

  // -------------------------------------------------------------------------
  // Análise local com debounce
  // -------------------------------------------------------------------------

  function agendarAnalise() {
    estado.bannerOculto = false;
    clearTimeout(estado.timer);
    estado.timer = setTimeout(analisar, 400);
  }

  function analisar() {
    if (!monitoramentoAtivo()) {
      esconderInterface();
      return;
    }
    var texto = lerTexto();
    estado.textoAnalisado = texto;

    if (!texto.trim()) {
      estado.analise = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
      renderizarBanner();
      posicionar();
      return;
    }

    var motor = globalThis.PainelDetectores;
    if (!motor) {
      console.warn("[Sentinela] motor de detecção indisponível.");
      return;
    }

    try {
      estado.analise = motor.analisarTexto(texto, estado.config.regras || []);
    } catch (erro) {
      console.warn("[Sentinela] falha ao analisar texto:", erro);
      estado.analise = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
    }

    renderizarBanner();
    posicionar();
  }

  function analisarAgora() {
    clearTimeout(estado.timer);
    analisar();
    return estado.analise;
  }

  // -------------------------------------------------------------------------
  // Interface em Shadow DOM
  // -------------------------------------------------------------------------

  var ESTILOS = [
    ":host{all:initial;position:fixed;z-index:2147483647;display:none;}",
    "*{box-sizing:border-box;font-family:Inter,-apple-system,'Segoe UI',Roboto,sans-serif;}",
    ".painel{position:relative;background:#fdfdfb;border:1px solid #dcdad4;color:#1b1b1a;",
    "box-shadow:0 10px 30px rgba(20,20,20,.08);overflow:hidden;}",
    ".painel::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#7a7a75;}",
    ".painel.risco-baixo::before{background:#3c7a5a;}",
    ".painel.risco-medio::before{background:#b07a1e;}",
    ".painel.risco-alto::before{background:#b4372b;}",
    ".conteudo{padding:12px 14px 11px 16px;display:flex;flex-direction:column;gap:8px;}",
    ".cabecalho{display:flex;align-items:center;justify-content:space-between;gap:10px;}",
    ".nivel{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;display:flex;align-items:center;gap:6px;}",
    ".risco-baixo .nivel{color:#3c7a5a;} .risco-medio .nivel{color:#9a6a15;} .risco-alto .nivel{color:#a83227;}",
    ".ponto{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;}",
    ".contagem{font-size:10px;color:#8a8a84;letter-spacing:.04em;}",
    ".tipos{display:flex;flex-wrap:wrap;gap:5px;list-style:none;margin:0;padding:0;}",
    ".tipos li{display:inline-flex;align-items:center;gap:5px;border:1px solid #e2e0da;",
    "padding:2px 6px;font-size:10px;line-height:16px;color:#2a2a28;background:#fff;}",
    ".tipos .area{color:#8a8a84;}",
    ".tipos .valor{width:5px;height:5px;border-radius:50%;background:#8a8a84;}",
    ".tipos .valor.medio{background:#b07a1e;} .tipos .valor.alto{background:#b4372b;}",
    ".mensagem{margin:0;font-size:11px;line-height:17px;color:#55554f;}",
    ".rodape{margin:0;padding-top:7px;border-top:1px solid #eceae4;font-size:9px;",
    "letter-spacing:.04em;color:#a09f98;display:flex;justify-content:space-between;gap:8px;}",
    ".fechar{position:absolute;top:6px;right:6px;border:0;background:transparent;color:#a09f98;",
    "font-size:14px;line-height:1;padding:4px;cursor:pointer;}",
    ".fechar:hover{color:#1b1b1a;}",
    ".overlay{position:fixed;inset:0;background:rgba(20,20,20,.42);display:flex;",
    "align-items:center;justify-content:center;padding:18px;z-index:2;}",
    ".overlay[hidden]{display:none;}",
    ".modal{width:420px;max-width:100%;max-height:84vh;overflow-y:auto;background:#fdfdfb;",
    "border:1px solid #d3d1ca;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.18);}",
    ".modal .rotulo{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#8a8a84;margin:0 0 8px;}",
    ".modal h2{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:25px;",
    "line-height:1.12;margin:0 0 8px;color:#141413;letter-spacing:-.01em;}",
    ".modal p{font-size:12px;line-height:19px;color:#55554f;margin:0 0 12px;}",
    ".modal ul{list-style:none;margin:0 0 12px;padding:0;border-top:1px solid #e6e4de;}",
    ".modal li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;",
    "border-bottom:1px solid #e6e4de;font-size:12px;color:#262624;}",
    ".modal li span{color:#8a8a84;font-size:10px;letter-spacing:.04em;}",
    ".acoes{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #e6e4de;padding-top:14px;}",
    "button.acao{appearance:none;border:1px solid #cfcdc6;background:#fff;color:#1b1b1a;",
    "font-size:11px;padding:8px 12px;cursor:pointer;letter-spacing:.02em;}",
    "button.acao:hover{border-color:#8f8d86;}",
    "button.acao.primario{background:#1b1b1a;border-color:#1b1b1a;color:#fdfdfb;}",
    "button.acao.primario:hover{background:#2c2c2a;}",
  ].join("");

  function criarInterface() {
    if (estado.host) return;

    var host = document.createElement("div");
    host.id = "sentinela-governanca-host";
    host.setAttribute("data-sentinela", "interface");
    var shadow = host.attachShadow({ mode: "open" });

    var estilo = document.createElement("style");
    estilo.textContent = ESTILOS;

    var raizBanner = document.createElement("div");
    raizBanner.className = "sentinela-banner";

    var raizModal = document.createElement("div");
    raizModal.className = "sentinela-modal";

    shadow.appendChild(estilo);
    shadow.appendChild(raizBanner);
    shadow.appendChild(raizModal);

    (document.body || document.documentElement).appendChild(host);

    estado.host = host;
    estado.shadow = shadow;
    estado.raizBanner = raizBanner;
    estado.raizModal = raizModal;
  }

  function esconderInterface() {
    if (estado.host) estado.host.style.display = "none";
  }

  function posicionar() {
    if (!estado.host) return;
    var visivel =
      (!estado.bannerOculto && estado.textoAnalisado.trim().length > 0) ||
      estado.modalAberto;

    if (!visivel || !estado.campo || !document.contains(estado.campo)) {
      estado.host.style.display = "none";
      return;
    }

    estado.host.style.display = "block";
    if (estado.modalAberto) return;

    var retangulo = estado.campo.getBoundingClientRect();
    var largura = Math.min(Math.max(retangulo.width, 300), 560);
    var alturaPainel = estado.raizBanner.firstElementChild
      ? estado.raizBanner.firstElementChild.getBoundingClientRect().height
      : 150;

    var esquerda = Math.min(
      Math.max(retangulo.left, 8),
      Math.max(window.innerWidth - largura - 8, 8),
    );
    var topo = retangulo.top - alturaPainel - 10;
    if (topo < 8) topo = retangulo.bottom + 10;
    if (topo + alturaPainel > window.innerHeight - 8) {
      topo = Math.max(8, window.innerHeight - alturaPainel - 8);
    }

    estado.host.style.width = largura + "px";
    estado.host.style.left = esquerda + "px";
    estado.host.style.top = topo + "px";
  }

  function mensagemDoNivel(nivel) {
    var mensagens = estado.config.mensagens || {};
    return mensagens[nivel] || MENSAGENS_PADRAO[nivel];
  }

  function renderizarBanner() {
    if (!estado.raizBanner) return;
    estado.raizBanner.replaceChildren();

    if (estado.bannerOculto || !estado.textoAnalisado.trim()) {
      if (estado.host) estado.host.style.display = "none";
      return;
    }

    var analise = estado.analise;
    var painel = document.createElement("section");
    painel.className = "painel risco-" + analise.nivel;
    painel.setAttribute("role", "status");
    painel.setAttribute("aria-live", "polite");

    var conteudo = document.createElement("div");
    conteudo.className = "conteudo";

    var cabecalho = document.createElement("div");
    cabecalho.className = "cabecalho";
    var nivel = document.createElement("span");
    nivel.className = "nivel";
    var ponto = document.createElement("span");
    ponto.className = "ponto";
    nivel.appendChild(ponto);
    nivel.appendChild(
      document.createTextNode("Risco " + ROTULOS[analise.nivel]),
    );

    var contagem = document.createElement("span");
    contagem.className = "contagem";
    contagem.textContent = analise.deteccoes.length + " tipo(s)";
    cabecalho.appendChild(nivel);
    cabecalho.appendChild(contagem);

    var fechar = document.createElement("button");
    fechar.className = "fechar";
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Ocultar aviso até a próxima edição");
    fechar.textContent = "×";
    fechar.addEventListener("click", function () {
      estado.bannerOculto = true;
      renderizarBanner();
      posicionar();
    });

    conteudo.appendChild(cabecalho);

    if (analise.deteccoes.length > 0) {
      var lista = document.createElement("ul");
      lista.className = "tipos";
      analise.deteccoes.forEach(function (deteccao) {
        var item = document.createElement("li");
        var valor = document.createElement("span");
        valor.className = "valor " + deteccao.risco;
        var tipo = document.createElement("b");
        tipo.textContent = deteccao.tipo;
        tipo.style.fontWeight = "600";
        var area = document.createElement("span");
        area.className = "area";
        area.textContent = deteccao.area;
        item.appendChild(valor);
        item.appendChild(tipo);
        item.appendChild(area);
        lista.appendChild(item);
      });
      conteudo.appendChild(lista);
    }

    var mensagem = document.createElement("p");
    mensagem.className = "mensagem";
    mensagem.textContent = mensagemDoNivel(analise.nivel);
    conteudo.appendChild(mensagem);

    var rodape = document.createElement("p");
    rodape.className = "rodape";
    var local = document.createElement("span");
    local.textContent = "Análise local · o texto não sai do navegador";
    var total = document.createElement("span");
    total.textContent = analise.totalOcorrencias + " ocorrência(s)";
    rodape.appendChild(local);
    rodape.appendChild(total);
    conteudo.appendChild(rodape);

    painel.appendChild(conteudo);
    painel.appendChild(fechar);
    estado.raizBanner.appendChild(painel);
  }

  // -------------------------------------------------------------------------
  // Modal de confirmação
  // -------------------------------------------------------------------------

  function abrirModal(botao) {
    var analise = estado.analise;
    if (analise.nivel !== "alto" && analise.nivel !== "medio") return;

    estado.ultimoBotao = botao || null;
    estado.modalAberto = true;
    renderizarModal();
    posicionar();

    var primeiro = estado.raizModal.querySelector("button.acao");
    if (primeiro) primeiro.focus();
  }

  function fecharModal() {
    estado.modalAberto = false;
    if (estado.raizModal) estado.raizModal.replaceChildren();
    posicionar();
  }

  function renderizarModal() {
    if (!estado.raizModal) return;
    estado.raizModal.replaceChildren();

    var analise = estado.analise;
    var overlay = document.createElement("div");
    overlay.className = "overlay";

    var modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    var rotulo = document.createElement("p");
    rotulo.className = "rotulo";
    rotulo.textContent = "Confirmação de envio";

    var titulo = document.createElement("h2");
    titulo.textContent = "Enviar mesmo assim?";

    var descricao = document.createElement("p");
    descricao.textContent =
      "Esta mensagem contém dados classificados como risco " +
      ROTULOS[analise.nivel].toLowerCase() +
      ". O alerta será registrado no painel, sem o texto da mensagem.";

    var lista = document.createElement("ul");
    analise.deteccoes.forEach(function (deteccao) {
      var item = document.createElement("li");
      item.appendChild(document.createTextNode(deteccao.tipo));
      var meta = document.createElement("span");
      meta.textContent = deteccao.area + " · " + ROTULOS[deteccao.risco];
      item.appendChild(meta);
      lista.appendChild(item);
    });

    var mensagem = document.createElement("p");
    mensagem.textContent = mensagemDoNivel(analise.nivel);

    var acoes = document.createElement("div");
    acoes.className = "acoes";

    var cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "acao";
    cancelar.textContent = "Cancelar e revisar";
    cancelar.addEventListener("click", function () {
      registrar("cancelou");
      fecharModal();
      if (estado.campo) estado.campo.focus();
    });

    var enviar = document.createElement("button");
    enviar.type = "button";
    enviar.className = "acao primario";
    enviar.textContent = "Enviar mesmo assim";
    enviar.addEventListener("click", function () {
      registrar("enviou");
      fecharModal();
      estado.permitirEnvio = true;
      reenviarAcaoOriginal();
      setTimeout(function () {
        estado.permitirEnvio = false;
        estado.bannerOculto = true;
        renderizarBanner();
        posicionar();
      }, 1200);
    });

    acoes.appendChild(cancelar);
    acoes.appendChild(enviar);

    modal.appendChild(rotulo);
    modal.appendChild(titulo);
    modal.appendChild(descricao);
    if (analise.deteccoes.length > 0) modal.appendChild(lista);
    modal.appendChild(mensagem);
    modal.appendChild(acoes);
    overlay.appendChild(modal);
    estado.raizModal.appendChild(overlay);

    overlay.addEventListener("click", function (evento) {
      if (evento.target === overlay) {
        /* fechar sem registrar: equivale a continuar revisando */
        fecharModal();
      }
    });
  }

  function reenviarAcaoOriginal() {
    try {
      if (estado.ultimoBotao && document.contains(estado.ultimoBotao)) {
        estado.ultimoBotao.click();
        return;
      }
      if (!estado.campo) return;
      estado.campo.focus();
      var evento = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      estado.campo.dispatchEvent(evento);
    } catch (erro) {
      console.warn("[Sentinela] não foi possível reenviar automaticamente:", erro);
    }
  }

  // -------------------------------------------------------------------------
  // Interceptação do envio
  // -------------------------------------------------------------------------

  function registrarEventos() {
    document.addEventListener("input", function (evento) {
      if (!ehCampo(evento.target)) return;
      estado.campo = evento.target;
      agendarAnalise();
    }, true);

    document.addEventListener("keydown", function (evento) {
      if (estado.permitirEnvio) return;
      if (estado.modalAberto) {
        if (evento.key === "Escape") {
          evento.preventDefault();
          fecharModal();
        }
        return;
      }
      if (evento.key !== "Enter" || evento.shiftKey || evento.ctrlKey || evento.metaKey || evento.altKey) {
        return;
      }
      if (!ehCampo(evento.target)) return;

      var analise = analisarAgora();
      if (analise.nivel === "alto" || analise.nivel === "medio") {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        abrirModal(null);
      } else if (analise.deteccoes.length > 0) {
        registrarAposEnvio();
      }
    }, true);

    document.addEventListener("click", function (evento) {
      if (estado.permitirEnvio || estado.modalAberto) return;
      if (!monitoramentoAtivo() || !estado.site) return;

      var botao = encontrarBotaoEnvio(evento.target);
      if (!botao) return;

      var analise = analisarAgora();
      if (analise.nivel === "alto" || analise.nivel === "medio") {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        abrirModal(botao);
      } else if (analise.deteccoes.length > 0) {
        registrarAposEnvio();
      }
    }, true);
  }

  function encontrarBotaoEnvio(alvo) {
    if (!alvo || !estado.site) return null;
    var seletores = estado.site.enviar;
    for (var i = 0; i < seletores.length; i++) {
      try {
        var encontrado = alvo.closest(seletores[i]);
        if (encontrado) return encontrado;
      } catch (erro) {
        /* seletor inválido em algum navegador: segue para o próximo */
      }
    }
    return null;
  }

  function registrarAposEnvio() {
    // Risco baixo com detecções: o envio não é bloqueado, mas fica auditado.
    setTimeout(function () {
      registrar("enviou");
    }, 600);
  }

  // -------------------------------------------------------------------------
  // Registro do alerta (somente metadados)
  // -------------------------------------------------------------------------

  function registrar(acao) {
    if (!monitoramentoAtivo()) return;

    var analise = estado.analise;
    var chave = estado.textoAnalisado + "|" + acao;
    if (
      estado.ultimoRegistro &&
      estado.ultimoRegistro.chave === chave &&
      Date.now() - estado.ultimoRegistro.em < 1500
    ) {
      return;
    }
    estado.ultimoRegistro = { chave: chave, em: Date.now() };

    var alerta = {
      data_hora: new Date().toISOString(),
      site: location.hostname.replace(/^www\./, ""),
      departamento: estado.settings.departamento || "Não informado",
      colaborador: estado.settings.colaborador || null,
      nivel_risco: analise.nivel,
      tipos_detectados: analise.deteccoes.map(function (deteccao) {
        return {
          tipo_detectado: deteccao.tipo,
          risco: deteccao.risco,
          area: deteccao.area,
        };
      }),
      acao: acao,
    };

    try {
      chrome.runtime.sendMessage({ tipo: "REGISTRAR_ALERTA", alerta: alerta }, function (resposta) {
        if (chrome.runtime.lastError) return;
        if (resposta && resposta.ok === false) {
          console.info("[Sentinela] servidor indisponível: alerta guardado na fila local.");
        }
      });
    } catch (erro) {
      console.warn("[Sentinela] não foi possível contatar o service worker.", erro);
    }
  }

  // -------------------------------------------------------------------------
  // Mudanças de configuração feitas nas opções/popup
  // -------------------------------------------------------------------------

  chrome.storage.onChanged.addListener(function (mudancas, area) {
    if (area !== "local") return;

    if (mudancas.configuracao) {
      estado.settings = Object.assign(
        {},
        CONFIGURACAO_PADRAO,
        mudancas.configuracao.newValue || {},
      );
      if (!monitoramentoAtivo()) {
        esconderInterface();
        return;
      }
      criarInterface();
      localizarCampo();
    }

    if (mudancas.cacheConfig && mudancas.cacheConfig.newValue) {
      aplicarConfig(mudancas.cacheConfig.newValue);
    }
  });

  iniciar();
})();
