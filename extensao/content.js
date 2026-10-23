/**
 * Sentinela — content script.
 *
 * Lê o campo de texto das IAs, analisa localmente com debounce e injeta um
 * aviso translúcido em Shadow DOM (imune ao CSS do site). Intercepta o envio
 * quando o risco é médio ou alto e registra apenas metadados.
 *
 * Fontes analisadas, todas no navegador:
 *  - texto digitado;
 *  - colagens de blocos extensos (código, listas, textos);
 *  - imagens e prints colados (OCR local na página offscreen);
 *  - arquivos PDF anexados (extração local de texto).
 *
 * O texto nunca é enviado ao servidor. Depois de classificado, o conteúdo
 * extraído é descartado; o alerta carrega só tipos, áreas, risco e origem.
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
        "form textarea",
        'div[contenteditable="true"][role="textbox"]',
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
        'div[contenteditable="true"][role="textbox"]',
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
        'fieldset div[contenteditable="true"]',
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
  var ROTULOS_ANEXO = { imagem: "Imagem", pdf: "PDF" };
  var LIMITE_ARQUIVO = 6 * 1024 * 1024; // 6 MB em base64 é seguro para a mensagem
  var DEBOUNCE = 350;

  var estado = {
    settings: CONFIGURACAO_PADRAO,
    config: { regras: [], mensagens: MENSAGENS_PADRAO },
    site: null,
    campo: null,
    analise: { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 },
    textoAnalisado: "",
    analisando: false,
    timer: null,
    host: null,
    shadow: null,
    raizBanner: null,
    raizModal: null,
    modalAberto: false,
    bannerOculto: false,
    bannerVisivel: false,
    assinaturaBanner: "",
    permitirEnvio: false,
    ultimoBotao: null,
    ultimoRegistro: null,
    snapshotPendente: null,
    colagem: null,
    anexos: [],
    observador: null,
    localizarTimer: null,
    posicaoTimer: null,
  };

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  function criarId() {
    try {
      if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch (erro) {
      /* ambientes sem randomUUID */
    }
    return "evt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /** Impressão digital simples para deduplicar envios sem guardar o texto. */
  function impressao(texto) {
    var hash = 2166136261;
    for (var i = 0; i < texto.length; i++) {
      hash ^= texto.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36) + "-" + texto.length;
  }

  function hostNormalizado() {
    return location.hostname.replace(/^www\./, "");
  }

  function detectarSite() {
    var host = hostNormalizado();
    var chaves = Object.keys(SITES);
    for (var i = 0; i < chaves.length; i++) {
      if (host === chaves[i] || host.endsWith("." + chaves[i])) return SITES[chaves[i]];
    }
    return null;
  }

  function siteAutorizado() {
    var host = hostNormalizado();
    var ativos = estado.settings.sitesAtivos || [];
    return ativos.some(function (item) {
      return host === item || host.endsWith("." + item);
    });
  }

  function monitoramentoAtivo() {
    return Boolean(estado.settings.monitoramentoAtivo) && siteAutorizado();
  }

  function motor() {
    return globalThis.PainelDetectores || null;
  }

  function mensagemDoNivel(nivel) {
    var mensagens = estado.config.mensagens || {};
    return mensagens[nivel] || MENSAGENS_PADRAO[nivel];
  }

  // -------------------------------------------------------------------------
  // Inicialização
  // -------------------------------------------------------------------------

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
    if (estado.textoAnalisado || estado.anexos.length) analisar();
  }

  // -------------------------------------------------------------------------
  // Campo de entrada
  // -------------------------------------------------------------------------

  function observarCampo() {
    localizarCampo();

    estado.observador = new MutationObserver(agendarLocalizacao);
    estado.observador.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Alguns sites montam o editor apenas após interação do usuário.
    setInterval(localizarCampo, 1500);
    window.addEventListener("resize", agendarPosicao, { passive: true });
    window.addEventListener("scroll", agendarPosicao, { passive: true });
  }

  function agendarLocalizacao() {
    if (estado.localizarTimer) return;
    estado.localizarTimer = setTimeout(function () {
      estado.localizarTimer = null;
      localizarCampo();
    }, 120);
  }

  function elementoVisivel(elemento) {
    if (!elemento) return false;
    var retangulo = elemento.getBoundingClientRect();
    if (retangulo.width < 40 || retangulo.height < 12) return false;
    var estilo = window.getComputedStyle(elemento);
    if (estilo.display === "none" || estilo.visibility === "hidden") return false;
    if (Number(estilo.opacity) === 0) return false;
    if (elemento.disabled || elemento.getAttribute("aria-hidden") === "true") return false;
    return true;
  }

  function localizarCampo() {
    if (!estado.site || !monitoramentoAtivo()) return;

    var seletor = estado.site.campos.join(",");
    var candidatos;
    try {
      candidatos = document.querySelectorAll(seletor);
    } catch (erro) {
      return;
    }

    var escolhido = null;
    var menorTopo = -Infinity;
    for (var i = 0; i < candidatos.length; i++) {
      var elemento = candidatos[i];
      if (!elementoVisivel(elemento)) continue;
      // O compositor fica na parte de baixo da página: o candidato mais
      // próximo do rodapé é o campo que o usuário está usando.
      var topo = elemento.getBoundingClientRect().top;
      if (topo > menorTopo) {
        menorTopo = topo;
        escolhido = elemento;
      }
    }

    if (!escolhido) {
      estado.campo = null;
      agendarPosicao();
      return;
    }

    if (escolhido !== estado.campo) {
      var trocou = estado.campo !== null;
      estado.campo = escolhido;
      if (trocou) {
        estado.anexos = [];
        estado.colagem = null;
        estado.snapshotPendente = null;
        estado.bannerOculto = false;
      }
      var texto = lerTexto();
      if (texto.trim() || estado.anexos.length) {
        agendarAnalise(0);
      } else {
        estado.analise = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
        estado.textoAnalisado = "";
        estado.bannerOculto = false;
        renderizarBanner();
      }
    }
    agendarPosicao();
  }

  function ehCampo(alvo) {
    if (!alvo || !estado.campo) return false;
    return alvo === estado.campo || estado.campo.contains(alvo);
  }

  function ehRegiaoDoCampo(alvo) {
    if (ehCampo(alvo)) return true;
    if (!alvo || !estado.campo) return false;
    var pai = estado.campo.parentElement;
    return Boolean(pai && pai.contains(alvo));
  }

  function lerTexto() {
    if (!estado.campo) return "";
    if (estado.campo.tagName === "TEXTAREA" || estado.campo.tagName === "INPUT") {
      return estado.campo.value || "";
    }
    return estado.campo.innerText || estado.campo.textContent || "";
  }

  // -------------------------------------------------------------------------
  // Análise local
  // -------------------------------------------------------------------------

  function agendarAnalise(atraso) {
    estado.bannerOculto = false;
    estado.analisando = true;
    clearTimeout(estado.timer);
    estado.timer = setTimeout(analisar, typeof atraso === "number" ? atraso : DEBOUNCE);
  }

  function analisar() {
    clearTimeout(estado.timer);
    estado.analisando = false;

    if (!monitoramentoAtivo()) {
      esconderInterface();
      return;
    }

    var texto = lerTexto();
    estado.textoAnalisado = texto;

    // Depois de um envio a página limpa o campo: os anexos já cumpriram o
    // papel e não devem continuar no próximo alerta. Anexos colados depois do
    // envio (criadoEm maior) permanecem.
    if (!texto.trim() && estado.ultimoRegistro && Date.now() - estado.ultimoRegistro.em < 6000) {
      var enviadoEm = estado.ultimoRegistro.em;
      var anexoNovo = estado.anexos.some(function (anexo) {
        return anexo.criadoEm >= enviadoEm;
      });
      var colagemNova = estado.colagem && estado.colagem.em >= enviadoEm;
      if (!anexoNovo) estado.anexos = [];
      if (!colagemNova) estado.colagem = null;
    }

    if (!texto.trim() && estado.anexos.length === 0) {
      estado.analise = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
      estado.colagem = null;
      renderizarBanner();
      agendarPosicao();
      return;
    }

    if (estado.colagem && texto.indexOf(estado.colagem.preview) === -1) {
      estado.colagem = null;
    }

    var engine = motor();
    var base = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
    if (engine && texto.trim()) {
      try {
        base = engine.analisarTexto(texto, estado.config.regras || []);
      } catch (erro) {
        console.warn("[Sentinela] falha ao analisar texto:", erro);
      }
    }

    var extras = [];
    estado.anexos.forEach(function (anexo) {
      if (anexo.deteccoes && anexo.deteccoes.length) {
        extras = extras.concat(anexo.deteccoes);
      }
    });
    if (estado.colagem && estado.colagem.deteccao) {
      extras.push(estado.colagem.deteccao);
    }

    if (engine && extras.length) {
      estado.analise = engine.mesclarDeteccoes(base.deteccoes.concat(extras));
    } else if (engine) {
      estado.analise = base;
    } else {
      estado.analise = { nivel: "baixo", deteccoes: [], totalOcorrencias: 0 };
    }

    renderizarBanner();
    agendarPosicao();
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
    ":host{all:initial;position:fixed;z-index:2147483647;display:none;pointer-events:none;",
    "font-size:13px;line-height:1.5;color:#1b1b1a;text-align:left;}",
    "*,*::before,*::after{box-sizing:border-box;font-family:Inter,-apple-system,'Segoe UI',Roboto,sans-serif;}",
    ".painel{position:relative;pointer-events:auto;background:rgba(253,253,251,.82);",
    "backdrop-filter:blur(20px) saturate(1.35);-webkit-backdrop-filter:blur(20px) saturate(1.35);",
    "border:1px solid rgba(27,27,26,.14);border-radius:14px;color:#1b1b1a;",
    "box-shadow:0 18px 44px rgba(16,16,15,.16),0 2px 8px rgba(16,16,15,.06);",
    "overflow:hidden;animation:sentinela-entra .24s cubic-bezier(.22,1,.36,1);}",
    ".painel.saindo{animation:sentinela-sai .16s ease forwards;}",
    ".painel::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#8a8a84;}",
    ".painel.risco-baixo::before{background:#3c7a5a;}",
    ".painel.risco-medio::before{background:#b07a1e;}",
    ".painel.risco-alto::before{background:#b4372b;}",
    ".conteudo{padding:12px 15px 11px 17px;display:flex;flex-direction:column;gap:8px;}",
    ".cabecalho{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-right:14px;}",
    ".nivel{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;",
    "display:flex;align-items:center;gap:6px;}",
    ".risco-baixo .nivel{color:#3c7a5a;}.risco-medio .nivel{color:#96691a;}.risco-alto .nivel{color:#a83227;}",
    ".ponto{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;}",
    ".contagem{font-size:10px;color:#8a8a84;letter-spacing:.04em;}",
    ".tipos{display:flex;flex-wrap:wrap;gap:5px;list-style:none;margin:0;padding:0;}",
    ".tipos li{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(27,27,26,.12);",
    "border-radius:5px;padding:2px 6px;font-size:10px;line-height:16px;color:#2a2a28;",
    "background:rgba(255,255,255,.6);}",
    ".tipos .area{color:#8a8a84;}",
    ".tipos .valor{width:5px;height:5px;border-radius:50%;background:#8a8a84;}",
    ".tipos .valor.medio{background:#b07a1e;}.tipos .valor.alto{background:#b4372b;}",
    ".mensagem{margin:0;font-size:11px;line-height:17px;color:#55554f;}",
    ".anexos{display:flex;flex-wrap:wrap;gap:5px;list-style:none;margin:0;padding:0;}",
    ".anexo{display:inline-flex;align-items:center;gap:5px;border:1px dashed rgba(27,27,26,.2);",
    "border-radius:5px;padding:2px 5px 2px 6px;font-size:10px;line-height:16px;color:#55554f;",
    "background:rgba(255,255,255,.42);max-width:100%;}",
    ".anexo b{font-weight:600;color:#2a2a28;}.anexo .estado{color:#8a8a84;}",
    ".anexo.erro{border-color:rgba(168,50,39,.35);color:#a83227;}",
    ".anexo button{appearance:none;border:0;background:transparent;color:#a09f98;font-size:12px;",
    "line-height:1;padding:0 1px;cursor:pointer;}.anexo button:hover{color:#1b1b1a;}",
    ".rodape{margin:0;padding-top:7px;border-top:1px solid rgba(27,27,26,.09);font-size:9px;",
    "letter-spacing:.04em;color:#a09f98;display:flex;justify-content:space-between;gap:8px;}",
    ".fechar{position:absolute;top:6px;right:6px;border:0;background:transparent;color:#a09f98;",
    "font-size:14px;line-height:1;padding:5px;cursor:pointer;border-radius:6px;",
    "transition:background .15s ease,color .15s ease;}",
    ".fechar:hover{color:#1b1b1a;background:rgba(27,27,26,.06);}",
    ".overlay{position:fixed;inset:0;background:rgba(16,16,15,.3);",
    "backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);display:flex;",
    "align-items:center;justify-content:center;padding:20px;z-index:2;pointer-events:auto;",
    "animation:sentinela-overlay .2s ease;}",
    ".overlay[hidden]{display:none;}",
    ".modal{width:440px;max-width:100%;max-height:86vh;overflow-y:auto;",
    "background:rgba(253,253,251,.95);backdrop-filter:blur(24px);",
    "-webkit-backdrop-filter:blur(24px);border:1px solid rgba(27,27,26,.14);",
    "border-radius:16px;padding:24px;box-shadow:0 30px 80px rgba(10,10,10,.26);",
    "animation:sentinela-modal .28s cubic-bezier(.22,1,.36,1);}",
    ".modal .rotulo{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#8a8a84;margin:0 0 8px;}",
    ".modal h2{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:25px;",
    "line-height:1.12;margin:0 0 8px;color:#141413;letter-spacing:-.01em;}",
    ".modal p{font-size:12px;line-height:19px;color:#55554f;margin:0 0 12px;}",
    ".modal ul{list-style:none;margin:0 0 12px;padding:0;border-top:1px solid rgba(27,27,26,.1);}",
    ".modal li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;",
    "border-bottom:1px solid rgba(27,27,26,.1);font-size:12px;color:#262624;}",
    ".modal li span{color:#8a8a84;font-size:10px;letter-spacing:.04em;}",
    ".acoes{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(27,27,26,.1);",
    "padding-top:14px;}",
    "button.acao{appearance:none;border:1px solid rgba(27,27,26,.2);background:rgba(255,255,255,.8);",
    "color:#1b1b1a;font-size:11px;padding:8px 12px;border-radius:8px;cursor:pointer;",
    "letter-spacing:.02em;transition:border-color .15s ease,background .15s ease,transform .15s ease;}",
    "button.acao:hover{border-color:rgba(27,27,26,.45);background:#fff;}",
    "button.acao:active{transform:translateY(1px);}",
    "button.acao.primario{background:#1b1b1a;border-color:#1b1b1a;color:#fdfdfb;}",
    "button.acao.primario:hover{background:#2c2c2a;}",
    "@keyframes sentinela-entra{from{opacity:0;transform:translateY(8px) scale(.985);}",
    "to{opacity:1;transform:none;}}",
    "@keyframes sentinela-sai{from{opacity:1;transform:none;}",
    "to{opacity:0;transform:translateY(6px) scale(.99);}}",
    "@keyframes sentinela-overlay{from{opacity:0;}to{opacity:1;}}",
    "@keyframes sentinela-modal{from{opacity:0;transform:translateY(10px) scale(.975);}",
    "to{opacity:1;transform:none;}}",
    "@media (prefers-reduced-motion: reduce){.painel,.painel.saindo,.overlay,.modal{",
    "animation:none!important;}}",
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

  function deveMostrarBanner() {
    if (estado.bannerOculto) return false;
    if (!estado.campo || !document.contains(estado.campo)) return false;
    var temAnexo = estado.anexos.length > 0;
    // Risco baixo não interrompe a digitação: continua auditado no envio, mas
    // sem aviso. O painel só aparece quando há algo relevante ou um anexo.
    var temRelevante = estado.analise.deteccoes.some(function (item) {
      return item.risco !== "baixo";
    });
    if (!temAnexo && !temRelevante) return false;
    if (!temAnexo && !estado.textoAnalisado.trim()) return false;
    return true;
  }

  function ocultarHost(animar) {
    if (!estado.host) return;
    var painel = estado.raizBanner ? estado.raizBanner.firstElementChild : null;
    estado.bannerVisivel = false;
    estado.assinaturaBanner = "";
    if (!animar || !painel) {
      estado.host.style.display = "none";
      if (estado.raizBanner) estado.raizBanner.replaceChildren();
      return;
    }
    painel.classList.add("saindo");
    setTimeout(function () {
      if (!estado.bannerVisivel && estado.host) {
        estado.host.style.display = "none";
        if (estado.raizBanner) estado.raizBanner.replaceChildren();
      }
    }, 165);
  }

  function esconderInterface() {
    estado.bannerVisivel = false;
    estado.assinaturaBanner = "";
    if (estado.host) estado.host.style.display = "none";
    if (estado.raizBanner) estado.raizBanner.replaceChildren();
    if (estado.raizModal) estado.raizModal.replaceChildren();
    estado.modalAberto = false;
  }

  function assinaturaAtual() {
    var deteccoes = estado.analise.deteccoes
      .map(function (item) {
        return item.tipo + ":" + item.risco;
      })
      .join(",");
    var anexos = estado.anexos
      .map(function (item) {
        return (
          item.id +
          ":" +
          item.tipo +
          ":" +
          item.status +
          ":" +
          (item.deteccoes ? item.deteccoes.length : 0)
        );
      })
      .join(",");
    return estado.analise.nivel + "|" + deteccoes + "|" + anexos;
  }

  function renderizarBanner() {
    if (!estado.raizBanner) return;

    if (!deveMostrarBanner()) {
      ocultarHost(true);
      return;
    }

    var assinatura = assinaturaAtual();
    if (assinatura === estado.assinaturaBanner && estado.raizBanner.firstElementChild) {
      agendarPosicao();
      return;
    }
    estado.assinaturaBanner = assinatura;

    var jaVisivel = estado.bannerVisivel;
    estado.raizBanner.replaceChildren();

    var analise = estado.analise;
    var painel = document.createElement("section");
    painel.className = "painel risco-" + analise.nivel;
    if (jaVisivel) painel.style.animation = "none";
    painel.setAttribute("role", "status");
    painel.setAttribute("aria-live", "polite");
    painel.setAttribute("aria-label", "Aviso de risco " + ROTULOS[analise.nivel]);

    var conteudo = document.createElement("div");
    conteudo.className = "conteudo";

    var cabecalho = document.createElement("div");
    cabecalho.className = "cabecalho";
    var nivel = document.createElement("span");
    nivel.className = "nivel";
    var ponto = document.createElement("span");
    ponto.className = "ponto";
    nivel.appendChild(ponto);
    nivel.appendChild(document.createTextNode("Risco " + ROTULOS[analise.nivel]));

    var contagem = document.createElement("span");
    contagem.className = "contagem";
    contagem.textContent = analise.deteccoes.length
      ? analise.deteccoes.length + " tipo(s)"
      : "sem detecções";
    cabecalho.appendChild(nivel);
    cabecalho.appendChild(contagem);
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

    if (estado.anexos.length > 0) {
      var anexos = document.createElement("ul");
      anexos.className = "anexos";
      estado.anexos.forEach(function (anexo) {
        var item = document.createElement("li");
        item.className = "anexo" + (anexo.status === "erro" ? " erro" : "");
        var tipo = document.createElement("b");
        tipo.textContent = ROTULOS_ANEXO[anexo.tipo] || "Anexo";
        var nome = document.createElement("span");
        nome.textContent = anexo.nome.length > 22 ? anexo.nome.slice(0, 20) + "…" : anexo.nome;
        nome.style.maxWidth = "7rem";
        nome.style.overflow = "hidden";
        nome.style.textOverflow = "ellipsis";
        nome.style.whiteSpace = "nowrap";
        var situacao = document.createElement("span");
        situacao.className = "estado";
        situacao.textContent = textoDoAnexo(anexo);
        var remover = document.createElement("button");
        remover.type = "button";
        remover.textContent = "×";
        remover.setAttribute("aria-label", "Remover anexo " + anexo.nome);
        remover.addEventListener("click", function () {
          estado.anexos = estado.anexos.filter(function (atual) {
            return atual.id !== anexo.id;
          });
          analisar();
        });
        item.appendChild(tipo);
        item.appendChild(nome);
        item.appendChild(situacao);
        item.appendChild(remover);
        anexos.appendChild(item);
      });
      conteudo.appendChild(anexos);
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

    var fechar = document.createElement("button");
    fechar.className = "fechar";
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Ocultar aviso até a próxima edição");
    fechar.textContent = "×";
    fechar.addEventListener("click", function () {
      estado.bannerOculto = true;
      renderizarBanner();
    });

    painel.appendChild(conteudo);
    painel.appendChild(fechar);
    estado.raizBanner.appendChild(painel);
    estado.bannerVisivel = true;
    agendarPosicao();
  }

  function textoDoAnexo(anexo) {
    if (anexo.status === "lendo") return "lendo…";
    if (anexo.status === "analisando") return "analisando…";
    if (anexo.status === "erro") return anexo.erro || "falha";
    if (anexo.status === "vazio") return "sem texto legível";
    if (!anexo.deteccoes || anexo.deteccoes.length === 0) return "nada sensível";
    return anexo.deteccoes.length + " tipo(s)";
  }

  function agendarPosicao() {
    if (estado.posicaoTimer) return;
    estado.posicaoTimer = window.requestAnimationFrame(function () {
      estado.posicaoTimer = null;
      posicionar();
    });
  }

  function posicionar() {
    if (!estado.host) return;

    if (estado.modalAberto) {
      estado.host.style.display = "block";
      return;
    }

    if (!deveMostrarBanner()) {
      ocultarHost(true);
      return;
    }

    estado.host.style.display = "block";

    // Define a largura antes de medir: a altura depende da quebra de linha.
    var retangulo = estado.campo.getBoundingClientRect();
    var largura = Math.max(
      280,
      Math.min(Math.max(retangulo.width, 320), 560, window.innerWidth - 16),
    );
    var esquerda = Math.min(
      Math.max(retangulo.left, 8),
      Math.max(window.innerWidth - largura - 8, 8),
    );
    estado.host.style.width = largura + "px";
    estado.host.style.left = esquerda + "px";

    var painel = estado.raizBanner.firstElementChild;
    var alturaPainel = painel ? painel.getBoundingClientRect().height : 0;
    if (!alturaPainel) alturaPainel = 148;

    var topo = retangulo.top - alturaPainel - 10;
    if (topo < 8) topo = retangulo.bottom + 10;
    if (topo + alturaPainel > window.innerHeight - 8) {
      topo = Math.max(8, window.innerHeight - alturaPainel - 8);
    }
    estado.host.style.top = topo + "px";
  }

  // -------------------------------------------------------------------------
  // Modal de confirmação
  // -------------------------------------------------------------------------

  function abrirModal(botao) {
    var analise = estado.analise;
    if (analise.nivel !== "alto" && analise.nivel !== "medio") return;

    estado.ultimoBotao = botao || null;
    estado.snapshotPendente = criarSnapshot(analise);
    estado.modalAberto = true;
    renderizarModal();
    posicionar();

    var primeiro = estado.raizModal.querySelector("button.acao");
    if (primeiro) primeiro.focus();
  }

  function fecharModal() {
    estado.modalAberto = false;
    if (estado.raizModal) estado.raizModal.replaceChildren();
    agendarPosicao();
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
    modal.setAttribute("aria-label", "Confirmação de envio");

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

    if (estado.anexos.length > 0) {
      estado.anexos.forEach(function (anexo) {
        var item = document.createElement("li");
        item.appendChild(
          document.createTextNode(
            (ROTULOS_ANEXO[anexo.tipo] || "Anexo") + " · " + anexo.nome,
          ),
        );
        var meta = document.createElement("span");
        meta.textContent =
          anexo.deteccoes && anexo.deteccoes.length
            ? anexo.deteccoes.length + " tipo(s)"
            : "sem dados sensíveis";
        item.appendChild(meta);
        lista.appendChild(item);
      });
    }

    var mensagem = document.createElement("p");
    mensagem.textContent = mensagemDoNivel(analise.nivel);

    var acoes = document.createElement("div");
    acoes.className = "acoes";

    var cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "acao";
    cancelar.textContent = "Cancelar e revisar";
    cancelar.addEventListener("click", function () {
      registrar("cancelou", estado.snapshotPendente || criarSnapshot(estado.analise));
      fecharModal();
      estado.bannerOculto = false;
      renderizarBanner();
      if (estado.campo) estado.campo.focus();
    });

    var enviar = document.createElement("button");
    enviar.type = "button";
    enviar.className = "acao primario";
    enviar.textContent = "Enviar mesmo assim";
    enviar.addEventListener("click", function () {
      // Registra antes de liberar o envio: a página pode navegar em seguida.
      registrar("enviou", estado.snapshotPendente || criarSnapshot(estado.analise));
      estado.snapshotPendente = null;
      fecharModal();
      estado.permitirEnvio = true;
      agendarLimpezaPosEnvio();
      setTimeout(reenviarAcaoOriginal, 30);
      setTimeout(function () {
        estado.permitirEnvio = false;
        estado.bannerOculto = true;
        renderizarBanner();
      }, 1600);
    });

    acoes.appendChild(cancelar);
    acoes.appendChild(enviar);

    modal.appendChild(rotulo);
    modal.appendChild(titulo);
    modal.appendChild(descricao);
    if (analise.deteccoes.length > 0 || estado.anexos.length > 0) modal.appendChild(lista);
    modal.appendChild(mensagem);
    modal.appendChild(acoes);
    overlay.appendChild(modal);
    estado.raizModal.appendChild(overlay);

    overlay.addEventListener("click", function (evento) {
      if (evento.target === overlay) fecharModal();
    });
  }

  function reenviarAcaoOriginal() {
    if (!estado.permitirEnvio) return;
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

  /**
   * Depois de um envio, descarta os anexos e a colagem daquele conteúdo —
   * preservando o que tiver sido adicionado depois (novo anexo/colagem).
   */
  function agendarLimpezaPosEnvio() {
    var marcador = Date.now();
    setTimeout(function () {
      estado.anexos = estado.anexos.filter(function (anexo) {
        return anexo.criadoEm > marcador;
      });
      if (estado.colagem && estado.colagem.em < marcador) estado.colagem = null;
      analisar();
    }, 900);
  }

  /** Bloqueia o envio enquanto um print ou PDF ainda está sendo lido. */
  function bloquearPorAnexoPendente() {
    var pendente = estado.anexos.some(function (anexo) {
      return anexo.status === "lendo" || anexo.status === "analisando";
    });
    if (!pendente) return false;
    estado.bannerOculto = false;
    estado.assinaturaBanner = "";
    renderizarBanner();
    agendarPosicao();
    return true;
  }

  function tratarIntencaoDeEnvio(evento, botao) {
    if (estado.permitirEnvio) return;
    if (botao && (botao.disabled || botao.getAttribute("aria-disabled") === "true")) return;

    var analise = analisarAgora();

    if (bloquearPorAnexoPendente()) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      return;
    }

    if (analise.nivel === "alto" || analise.nivel === "medio") {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      abrirModal(botao);
      return;
    }

    // Risco baixo com tipos detectados: o envio não é bloqueado, mas fica
    // auditado imediatamente (antes de a página limpar o campo).
    if (analise.deteccoes.length > 0) {
      registrar("enviou", criarSnapshot(analise));
    }
    agendarLimpezaPosEnvio();
  }

  function registrarEventos() {
    // Captura na janela: roda antes dos handlers do site, inclusive quando o
    // editor registra o próprio listener de envio no documento.
    window.addEventListener(
      "input",
      function (evento) {
        if (!ehCampo(evento.target)) return;
        agendarAnalise();
      },
      true,
    );

    window.addEventListener(
      "keydown",
      function (evento) {
        if (estado.modalAberto) {
          if (evento.key === "Escape") {
            evento.preventDefault();
            fecharModal();
          }
          return;
        }
        if (evento.key === "Escape" && estado.bannerVisivel) {
          estado.bannerOculto = true;
          renderizarBanner();
          return;
        }
        if (evento.key !== "Enter" || evento.shiftKey || evento.ctrlKey || evento.metaKey || evento.altKey) {
          return;
        }
        if (!ehCampo(evento.target)) return;
        tratarIntencaoDeEnvio(evento, null);
      },
      true,
    );

    window.addEventListener(
      "click",
      function (evento) {
        if (estado.permitirEnvio || estado.modalAberto) return;
        if (!monitoramentoAtivo() || !estado.site || !estado.campo) return;
        var botao = encontrarBotaoEnvio(evento.target);
        if (!botao) return;
        tratarIntencaoDeEnvio(evento, botao);
      },
      true,
    );

    window.addEventListener("paste", aoColar, true);
    window.addEventListener("drop", aoSoltar, true);

    // Anexos escolhidos pelo clipe de papel também passam pela análise local.
    window.addEventListener(
      "change",
      function (evento) {
        var alvo = evento.target;
        if (!alvo || alvo.tagName !== "INPUT" || alvo.type !== "file") return;
        if (!estado.site || !monitoramentoAtivo()) return;
        var arquivos = Array.prototype.slice.call(alvo.files || []).slice(0, 3);
        arquivos.forEach(tratarArquivo);
      },
      true,
    );
  }

  // -------------------------------------------------------------------------
  // Colagem em massa e anexos (imagem, print, PDF)
  // -------------------------------------------------------------------------

  function aoColar(evento) {
    if (!estado.site || !monitoramentoAtivo() || !ehRegiaoDoCampo(evento.target)) return;
    var dados = evento.clipboardData;
    if (!dados) return;

    var arquivos = Array.prototype.slice.call(dados.files || []);
    if (arquivos.length === 0 && dados.items) {
      for (var i = 0; i < dados.items.length; i++) {
        if (dados.items[i].kind === "file") {
          var arquivo = dados.items[i].getAsFile();
          if (arquivo) arquivos.push(arquivo);
        }
      }
    }
    arquivos.forEach(tratarArquivo);

    var texto = "";
    try {
      texto = dados.getData("text/plain") || dados.getData("text") || "";
    } catch (erro) {
      texto = "";
    }

    var engine = motor();
    if (texto && engine && texto.length >= engine.LIMITE_COLAGEM) {
      estado.colagem = {
        deteccao: engine.avaliarColagem(texto),
        preview: texto.slice(0, 60),
        tamanho: texto.length,
        em: Date.now(),
      };
      estado.bannerOculto = false;
      // A página insere o conteúdo logo após o evento: analisa em seguida.
      setTimeout(analisarAgora, 80);
    }
  }

  function aoSoltar(evento) {
    if (!estado.site || !monitoramentoAtivo() || !ehRegiaoDoCampo(evento.target)) return;
    var dados = evento.dataTransfer;
    if (!dados || !dados.files || dados.files.length === 0) return;
    Array.prototype.slice.call(dados.files).forEach(tratarArquivo);
  }

  function classificarArquivo(arquivo) {
    if (!arquivo) return null;
    var tipo = String(arquivo.type || "");
    var nome = String(arquivo.name || "");
    if (tipo.indexOf("image/") === 0) return "imagem";
    if (tipo === "application/pdf" || /\.pdf$/i.test(nome)) return "pdf";
    return null;
  }

  function tratarArquivo(arquivo) {
    var tipo = classificarArquivo(arquivo);
    if (!tipo) return;
    if (estado.anexos.length >= 4) return;

    var nome = arquivo.name || (tipo === "imagem" ? "print.png" : "documento.pdf");
    var anexo = {
      id: criarId(),
      nome: nome,
      tipo: tipo,
      status: "lendo",
      deteccoes: [],
      erro: null,
      caracteres: 0,
      criadoEm: Date.now(),
    };
    estado.anexos.push(anexo);
    estado.bannerOculto = false;
    renderizarBanner();

    if (arquivo.size > LIMITE_ARQUIVO) {
      anexo.status = "erro";
      anexo.erro = "arquivo grande";
      analisar();
      return;
    }

    var leitor = new FileReader();
    leitor.onerror = function () {
      anexo.status = "erro";
      anexo.erro = "falha ao ler";
      analisar();
    };
    leitor.onload = function () {
      var resultado = String(leitor.result || "");
      var base64 = resultado.indexOf(",") >= 0 ? resultado.split(",")[1] : resultado;
      anexo.status = "analisando";
      renderizarBanner();

      var concluido = false;
      var prazo = setTimeout(function () {
        if (concluido) return;
        concluido = true;
        anexo.status = "erro";
        anexo.erro = "tempo esgotado";
        analisar();
      }, 25000);

      try {
        chrome.runtime.sendMessage(
          {
            tipo: "EXTRAIR_ANEXO",
            anexo: {
              nome: anexo.nome,
              tipo: tipo,
              mime: arquivo.type || "",
              dados: base64,
            },
          },
          function (resposta) {
            if (concluido) return;
            concluido = true;
            clearTimeout(prazo);
            if (chrome.runtime.lastError) {
              anexo.status = "erro";
              anexo.erro = "extensão indisponível";
              analisar();
              return;
            }
            if (!resposta || resposta.ok === false) {
              anexo.status = "erro";
              anexo.erro = (resposta && resposta.erro) || "falha ao ler";
              analisar();
              return;
            }

            var texto = String(resposta.texto || "");
            if (!texto.trim()) {
              anexo.status = "vazio";
              analisar();
              return;
            }

            var engine = motor();
            anexo.deteccoes = engine
              ? engine.analisarTexto(texto, estado.config.regras || []).deteccoes
              : [];
            anexo.caracteres = texto.length;
            anexo.status = "pronto";
            // O texto extraído é descartado aqui: só os metadados permanecem.
            analisar();
          },
        );
      } catch (erro) {
        anexo.status = "erro";
        anexo.erro = "extensão recarregada";
        analisar();
      }
    };
    leitor.readAsDataURL(arquivo);
  }

  // -------------------------------------------------------------------------
  // Registro do alerta (somente metadados)
  // -------------------------------------------------------------------------

  function calcularOrigem() {
    var temImagem = estado.anexos.some(function (anexo) {
      return anexo.tipo === "imagem";
    });
    var temPdf = estado.anexos.some(function (anexo) {
      return anexo.tipo === "pdf";
    });
    if (temImagem && temPdf) return "anexo";
    if (temImagem) return "imagem";
    if (temPdf) return "pdf";
    if (estado.colagem) return "colagem";
    return "texto";
  }

  function criarSnapshot(analise) {
    var origem = calcularOrigem();
    var deteccoes = (analise.deteccoes || []).map(function (deteccao) {
      return {
        tipo_detectado: deteccao.tipo,
        risco: deteccao.risco,
        area: deteccao.area,
      };
    });
    return {
      nivel: analise.nivel,
      deteccoes: deteccoes,
      origem: origem,
      assinatura:
        impressao(estado.textoAnalisado) +
        "|" +
        analise.nivel +
        "|" +
        origem +
        "|" +
        deteccoes
          .map(function (item) {
            return item.tipo_detectado;
          })
          .join(","),
    };
  }

  function registrar(acao, snapshot) {
    if (!monitoramentoAtivo()) return;

    var dados = snapshot || criarSnapshot(estado.analise);
    var chave = dados.assinatura + "|" + acao;
    if (
      estado.ultimoRegistro &&
      estado.ultimoRegistro.chave === chave &&
      Date.now() - estado.ultimoRegistro.em < 3500
    ) {
      return;
    }
    estado.ultimoRegistro = { chave: chave, em: Date.now() };

    var alerta = {
      evento_id: criarId(),
      origem: dados.origem,
      data_hora: new Date().toISOString(),
      site: hostNormalizado(),
      departamento: estado.settings.departamento || "Não informado",
      colaborador: estado.settings.colaborador || null,
      nivel_risco: dados.nivel,
      tipos_detectados: dados.deteccoes,
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
