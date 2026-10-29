/**
 * Sentinela — painel administrativo (JavaScript puro).
 *
 * Toda saída dinâmica é inserida com textContent/createElement, nunca com
 * innerHTML, para impedir XSS vindo de dados do banco.
 */
"use strict";

const $ = function (id) {
  return document.getElementById(id);
};

const estado = {
  areas: [],
  regras: [],
  filtros: { de: "", ate: "", departamento: "todos", nivel: "todos" },
  pagina: 1,
  totalPaginas: 1,
  alertaAtual: null,
  secao: "visao",
};

const SECAO_INFO = {
  visao: "Indicadores, evolução e departamentos críticos.",
  regras: "Detectores editáveis por área e nível de risco.",
  areas: "Estrutura da matriz de risco da empresa.",
  mensagens: "Texto educativo exibido pela extensão.",
  alertas: "Auditoria, filtros, retenção e exportação.",
  instalacao: "Código de instalação das extensões e contas de administrador.",
};

const ROTULO_NIVEL = { baixo: "Baixo", medio: "Médio", alto: "Alto" };
const ROTULO_ORIGEM = {
  texto: "Texto digitado",
  colagem: "Colagem em massa",
  imagem: "Print ou imagem",
  pdf: "Arquivo PDF",
  anexo: "Imagem e PDF",
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function api(caminho, opcoes) {
  const configuracao = opcoes || {};
  const resposta = await fetch(caminho, {
    credentials: "same-origin",
    method: configuracao.method || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, configuracao.headers || {}),
    body: configuracao.body,
  });

  if (resposta.status === 401) {
    window.location.href = "/login";
    throw new Error("Sessão expirada.");
  }

  let corpo = null;
  try {
    corpo = await resposta.json();
  } catch (erro) {
    corpo = null;
  }

  if (!resposta.ok) {
    throw new Error((corpo && corpo.erro) || "Erro " + resposta.status + " ao chamar " + caminho);
  }
  return corpo;
}

function criar(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined && texto !== null) elemento.textContent = String(texto);
  return elemento;
}

function limpar(elemento) {
  elemento.replaceChildren();
}

/**
 * O servidor manda o horário em UTC, com "Z" no fim. O navegador converte para
 * o relógio da própria máquina, então quem abre o painel no horário de Brasília
 * vê 14:00 quando o alerta foi registrado às 14:00 (e não 17:00).
 */
function quando(iso) {
  if (!iso) return "—";
  const texto = String(iso).replace(" ", "T");
  const comFuso = /(Z|[+-]\d{2}:?\d{2})$/i.test(texto) ? texto : texto + "Z";
  const momento = new Date(comFuso);
  if (Number.isNaN(momento.getTime())) {
    const partes = texto.split("T");
    const data = (partes[0] || "").split("-");
    if (data.length !== 3) return iso;
    return (
      data[2] + "/" + data[1] + "/" + data[0] + (partes[1] ? " " + partes[1].slice(0, 5) : "")
    );
  }
  return momento.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diaCurto(iso) {
  const partes = String(iso).split("-");
  return partes.length === 3 ? partes[2] + "/" + partes[1] : iso;
}

function numero(valor) {
  return new Intl.NumberFormat("pt-BR").format(Number(valor) || 0);
}

function normalizar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function badge(nivel) {
  const elemento = criar("span", "badge risco-" + nivel, ROTULO_NIVEL[nivel] || nivel);
  return elemento;
}

let timerToast = null;
function avisar(texto, tipo) {
  const toast = $("toast");
  toast.textContent = texto;
  toast.className = "toast " + (tipo || "");
  toast.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(function () {
    toast.hidden = true;
  }, 3800);
}

function tratarErro(erro) {
  console.error(erro);
  avisar(erro instanceof Error ? erro.message : "Erro inesperado.", "erro");
}

// Confirmação reutilizável (dialog nativo)
let acaoConfirmada = null;
function confirmar(titulo, texto, rotulo, aoConfirmar) {
  $("confirmar-titulo").textContent = titulo;
  $("confirmar-texto").textContent = texto;
  $("confirmar-ok").textContent = rotulo || "Excluir";
  acaoConfirmada = aoConfirmar;
  $("dialogo-confirmar").showModal();
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

function irPara(secao) {
  estado.secao = secao;
  document.querySelectorAll("[data-painel]").forEach(function (bloco) {
    bloco.classList.toggle("ativa", bloco.dataset.painel === secao);
  });
  document.querySelectorAll(".menu-nav [data-ir]").forEach(function (botao) {
    botao.classList.toggle("ativo", botao.dataset.ir === secao);
  });
  $("secao-descricao").textContent = SECAO_INFO[secao] || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  carregarSecao(secao);
}

function carregarSecao(secao) {
  if (secao === "visao") {
    carregarResumo();
  } else if (secao === "regras") {
    Promise.all([carregarAreas(), carregarRegras()]).catch(tratarErro);
  } else if (secao === "areas") {
    carregarAreas().catch(tratarErro);
  } else if (secao === "mensagens") {
    carregarMensagens().catch(tratarErro);
  } else if (secao === "alertas") {
    carregarAreas()
      .then(popularFiltroDepartamento)
      .then(function () {
        return carregarAlertas(1);
      })
      .catch(tratarErro);
  } else if (secao === "instalacao") {
    Promise.all([carregarInstalacao(), carregarAdmins()]).catch(tratarErro);
  }
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

async function carregarResumo() {
  const limiar = Number($("limiar").value) || 30;
  const dados = await api("/api/admin/resumo?limiar=" + encodeURIComponent(limiar));

  $("kpi-total").textContent = numero(dados.total);
  $("kpi-total-detalhe").textContent =
    numero(dados.departamentos_ativos) + " departamentos monitorados";
  $("kpi-alto").textContent = numero(dados.total_alto);
  $("kpi-alto-detalhe").textContent = dados.taxa_alto + "% do total de alertas";
  $("kpi-envio").textContent = dados.taxa_envio + "%";
  $("kpi-envio-detalhe").textContent =
    numero(dados.total_enviou) + " envios · " + numero(dados.total_cancelou) + " cancelamentos";
  $("kpi-tipos").textContent = numero(dados.tipos_distintos);
  $("nota-limiar").textContent =
    "Crítico = departamento com no mínimo 3 alertas e ao menos " +
    dados.limiar +
    "% deles em risco alto.";

  desenharGrafico(dados.evolucao);
  desenharBarras(dados.por_departamento);
  desenharTipos(dados.tipos);
  desenharLetramento(dados);
  desenharGargalos(dados.gargalos);
  desenharUltimos(dados.ultimos);
}

function desenharGrafico(evolucao) {
  const container = $("grafico-evolucao");
  limpar(container);

  const largura = 640;
  const altura = 150;
  const topo = 10;
  const maximo = Math.max.apply(
    null,
    [1].concat(evolucao.map(function (dia) { return dia.total; })),
  );
  const passo = largura / Math.max(evolucao.length, 1);
  const larguraBarra = Math.min(22, passo * 0.46);
  const ns = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 " + largura + " " + (altura + 28));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Alertas por dia nos últimos 14 dias");

  [0, 0.5, 1].forEach(function (fracao) {
    const linha = document.createElementNS(ns, "line");
    const y = topo + altura * (1 - fracao);
    linha.setAttribute("x1", 0);
    linha.setAttribute("x2", largura);
    linha.setAttribute("y1", y);
    linha.setAttribute("y2", y);
    linha.setAttribute("stroke", "#e0ded8");
    if (fracao !== 0) linha.setAttribute("stroke-dasharray", "2 4");
    svg.appendChild(linha);
  });

  evolucao.forEach(function (dia, indice) {
    const centro = passo * indice + passo / 2;
    const alturaTotal = (dia.total / maximo) * altura;
    const alturaAlto = (dia.alto / maximo) * altura;

    const grupo = document.createElementNS(ns, "g");

    const barra = document.createElementNS(ns, "rect");
    barra.setAttribute("x", centro - larguraBarra / 2);
    barra.setAttribute("y", topo + altura - alturaTotal);
    barra.setAttribute("width", larguraBarra);
    barra.setAttribute("height", Math.max(alturaTotal, dia.total > 0 ? 2 : 0));
    barra.setAttribute("fill", "#d8d6cf");
    grupo.appendChild(barra);

    if (dia.alto > 0) {
      const barraAlto = document.createElementNS(ns, "rect");
      barraAlto.setAttribute("x", centro - larguraBarra / 2);
      barraAlto.setAttribute("y", topo + altura - alturaAlto);
      barraAlto.setAttribute("width", larguraBarra);
      barraAlto.setAttribute("height", Math.max(alturaAlto, 2));
      barraAlto.setAttribute("fill", "#1b1b1a");
      grupo.appendChild(barraAlto);
    }

    const rotulo = document.createElementNS(ns, "text");
    rotulo.setAttribute("x", centro);
    rotulo.setAttribute("y", topo + altura + 18);
    rotulo.setAttribute("text-anchor", "middle");
    rotulo.setAttribute("font-size", "9");
    rotulo.setAttribute("fill", "#8a8a84");
    rotulo.setAttribute("font-family", "Consolas, monospace");
    rotulo.textContent = diaCurto(dia.data);
    grupo.appendChild(rotulo);

    const titulo = document.createElementNS(ns, "title");
    titulo.textContent =
      diaCurto(dia.data) + ": " + dia.total + " alerta(s), " + dia.alto + " de risco alto";
    grupo.appendChild(titulo);
    svg.appendChild(grupo);
  });

  container.appendChild(svg);

  const legenda = criar("div", "legenda-grafico");
  const itemAlto = criar("span");
  itemAlto.appendChild(criar("i"));
  itemAlto.appendChild(document.createTextNode("Risco alto"));
  const itemDemais = criar("span");
  itemDemais.appendChild(criar("i", "claro"));
  itemDemais.appendChild(document.createTextNode("Demais alertas"));
  legenda.appendChild(itemAlto);
  legenda.appendChild(itemDemais);
  container.appendChild(legenda);
}

function desenharBarras(porDepartamento) {
  const container = $("barras-departamento");
  limpar(container);

  if (!porDepartamento.length) {
    container.appendChild(criar("p", "micro", "Nenhum alerta registrado ainda."));
    return;
  }

  const maximo = Math.max.apply(
    null,
    [1].concat(porDepartamento.map(function (item) { return item.alto; })),
  );

  porDepartamento.forEach(function (item) {
    const linha = criar("div", "barra-item");
    linha.appendChild(criar("span", "nome", item.departamento));

    const trilho = criar("span", "barra-trilho");
    const preenchimento = criar("span", "barra-preenchimento");
    preenchimento.style.width = Math.max((item.alto / maximo) * 100, item.alto > 0 ? 2 : 0) + "%";
    trilho.appendChild(preenchimento);
    linha.appendChild(trilho);

    linha.appendChild(criar("span", "barra-valor", item.alto + "/" + item.total));
    container.appendChild(linha);
  });
}

function desenharTipos(tipos) {
  const lista = $("lista-tipos");
  limpar(lista);

  if (!tipos.length) {
    const vazio = criar("li");
    vazio.appendChild(criar("span", "micro", "Nenhuma detecção registrada."));
    lista.appendChild(vazio);
    return;
  }

  tipos.forEach(function (tipo, indice) {
    const item = criar("li");
    item.appendChild(criar("span", "indice", String(indice + 1).padStart(2, "0")));

    const bloco = criar("span");
    bloco.appendChild(criar("span", "tipo", tipo.tipo));
    bloco.appendChild(criar("span", "area", tipo.area));
    item.appendChild(bloco);

    item.appendChild(badge(tipo.risco));
    item.appendChild(criar("span", "total", tipo.total));
    lista.appendChild(item);
  });
}

function desenharLetramento(dados) {
  const corpo = $("tabela-letramento");
  limpar(corpo);

  if (!dados.por_departamento.length) {
    const linha = criar("tr");
    const celula = criar("td", "", "Nenhum alerta registrado.");
    celula.colSpan = 5;
    linha.appendChild(celula);
    corpo.appendChild(linha);
    return;
  }

  const gargalos = dados.gargalos.map(function (item) { return item.departamento; });

  dados.por_departamento.forEach(function (item) {
    const linha = criar("tr");

    const nome = criar("td");
    nome.appendChild(criar("span", "", item.departamento));
    linha.appendChild(nome);

    linha.appendChild(criar("td", "direita", item.total));

    const alto = criar("td", "direita", item.alto + " · " + item.taxa_alto + "%");
    linha.appendChild(alto);

    const envio = criar("td");
    const barra = criar("div", "barra-envio");
    const trilho = criar("span", "trilho");
    const enviado = criar("span", "enviado");
    enviado.style.width = item.taxa_envio + "%";
    const cancelado = criar("span", "cancelado");
    cancelado.style.width = Math.max(0, 100 - item.taxa_envio) + "%";
    trilho.appendChild(enviado);
    trilho.appendChild(cancelado);
    barra.appendChild(trilho);
    barra.appendChild(criar("span", "percentual", item.taxa_envio + "%"));
    envio.appendChild(barra);
    linha.appendChild(envio);

    const situacao = criar("td");
    if (gargalos.indexOf(item.departamento) >= 0) {
      situacao.appendChild(criar("span", "status-gargalo", "Crítico"));
    } else {
      situacao.appendChild(criar("span", "status-ok", "Acompanhar"));
    }
    linha.appendChild(situacao);

    corpo.appendChild(linha);
  });
}

function desenharGargalos(gargalos) {
  const container = $("gargalos");
  limpar(container);

  if (!gargalos.length) {
    container.appendChild(
      criar("p", "nota", "Nenhum departamento ultrapassa a tolerância de risco configurada."),
    );
    return;
  }

  const bloco = criar("div", "gargalo-bloco");
  bloco.appendChild(criar("p", "rotulo", "Departamentos críticos"));
  const lista = criar("ul");
  gargalos.forEach(function (item) {
    lista.appendChild(
      criar(
        "li",
        "",
        item.departamento +
          " — " +
          item.alto +
          " de " +
          item.total +
          " alertas em risco alto (" +
          item.taxa_alto +
          "%)",
      ),
    );
  });
  bloco.appendChild(lista);
  container.appendChild(bloco);
}

function desenharUltimos(ultimos) {
  const lista = $("ultimos");
  limpar(lista);

  if (!ultimos.length) {
    lista.appendChild(criar("li", "micro", "Nada registrado ainda."));
    return;
  }

  ultimos.forEach(function (alerta) {
    const item = criar("li");
    item.appendChild(criar("span", "quando", quando(alerta.data_hora)));
    item.appendChild(
      criar("span", "", alerta.departamento + " · " + alerta.site),
    );
    item.appendChild(badge(alerta.nivel_risco));
    item.appendChild(
      criar(
        "span",
        "acao",
        alerta.acao === "enviou" ? "Enviou mesmo assim" : "Cancelou",
      ),
    );
    lista.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

async function carregarAreas() {
  estado.areas = await api("/api/admin/areas");
  renderizarAreas();
  preencherSelectAreas();
}

function preencherSelectAreas() {
  const select = $("regra-area");
  const valorAtual = select.value;
  limpar(select);
  estado.areas.forEach(function (area) {
    const opcao = criar("option", "", area.nome);
    opcao.value = String(area.id);
    select.appendChild(opcao);
  });
  if (valorAtual && estado.areas.some(function (area) { return String(area.id) === valorAtual; })) {
    select.value = valorAtual;
  }
}

function renderizarAreas() {
  const lista = $("lista-areas");
  limpar(lista);

  if (!estado.areas.length) {
    lista.appendChild(criar("li", "nota", "Nenhuma área cadastrada."));
    return;
  }

  estado.areas.forEach(function (area, indice) {
    const item = criar("li", "area-item");
    item.appendChild(criar("span", "indice", String(indice + 1).padStart(2, "0")));

    const bloco = criar("div");
    bloco.appendChild(criar("h3", "", area.nome));
    bloco.appendChild(criar("p", "", area.descricao || "Sem descrição cadastrada."));
    bloco.appendChild(
      criar(
        "p",
        "rotulo contagem",
        area.total_regras + " regra(s) · " + area.total_ativas + " ativa(s)",
      ),
    );
    item.appendChild(bloco);

    const acoes = criar("div", "area-acoes");
    const editar = criar("button", "botao pequeno", "Editar");
    editar.type = "button";
    editar.addEventListener("click", function () { abrirArea(area); });

    const excluir = criar("button", "botao pequeno perigo", "Excluir");
    excluir.type = "button";
    excluir.addEventListener("click", function () {
      confirmar(
        "Excluir área?",
        'A área "' + area.nome + '" e suas ' + area.total_regras + " regra(s) serão removidas. Os alertas históricos permanecem.",
        "Excluir área",
        async function () {
          try {
            const resposta = await api("/api/admin/areas/" + area.id, { method: "DELETE" });
            avisar("Área removida. " + resposta.regras_removidas + " regra(s) excluída(s).");
            await carregarAreas();
            await carregarRegras();
          } catch (erro) {
            tratarErro(erro);
          }
        },
      );
    });

    acoes.appendChild(editar);
    acoes.appendChild(excluir);
    item.appendChild(acoes);
    lista.appendChild(item);
  });
}

async function carregarRegras() {
  estado.regras = await api("/api/admin/regras");
  renderizarRegras();
}

function rotuloTipo(tipo) {
  return tipo === "regex" ? "Regex" : "Palavra-chave";
}

function renderizarRegras() {
  const corpo = $("tabela-regras");
  limpar(corpo);

  const termo = normalizar($("busca-regras").value.trim());
  const filtradas = estado.regras.filter(function (regra) {
    if (!termo) return true;
    return normalizar(
      [regra.nome, regra.area, regra.padrao, rotuloTipo(regra.tipo), ROTULO_NIVEL[regra.risco]].join(" "),
    ).indexOf(termo) >= 0;
  });

  $("contador-regras").textContent =
    filtradas.length + " de " + estado.regras.length + " regras · " +
    estado.regras.filter(function (regra) { return regra.ativo; }).length + " ativas";

  if (!filtradas.length) {
    const linha = criar("tr");
    const celula = criar("td", "nota", "Nenhuma regra encontrada.");
    celula.colSpan = 6;
    linha.appendChild(celula);
    corpo.appendChild(linha);
    return;
  }

  filtradas.forEach(function (regra) {
    const linha = criar("tr");

    const nome = criar("td");
    nome.appendChild(criar("span", "", regra.nome));
    nome.appendChild(criar("code", "", regra.padrao));
    linha.appendChild(nome);

    linha.appendChild(criar("td", "", regra.area));
    linha.appendChild(criar("td", "", rotuloTipo(regra.tipo)));

    const risco = criar("td");
    risco.appendChild(badge(regra.risco));
    linha.appendChild(risco);

    const ativa = criar("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = regra.ativo;
    checkbox.setAttribute("aria-label", "Ativar regra " + regra.nome);
    checkbox.addEventListener("change", function () {
      atualizarAtivo(regra, checkbox.checked, checkbox);
    });
    ativa.appendChild(checkbox);
    linha.appendChild(ativa);

    const acoes = criar("td", "direita");
    const editar = criar("button", "botao pequeno", "Editar");
    editar.type = "button";
    editar.addEventListener("click", function () { abrirRegra(regra); });

    const excluir = criar("button", "botao pequeno perigo", "Excluir");
    excluir.type = "button";
    excluir.style.marginLeft = "6px";
    excluir.addEventListener("click", function () {
      confirmar(
        "Excluir regra?",
        'A regra "' + regra.nome + '" deixará de ser aplicada pela extensão. Esta ação não pode ser desfeita.',
        "Excluir regra",
        async function () {
          try {
            await api("/api/admin/regras/" + regra.id, { method: "DELETE" });
            avisar("Regra removida.");
            await carregarRegras();
            await carregarAreas();
          } catch (erro) {
            tratarErro(erro);
          }
        },
      );
    });

    acoes.appendChild(editar);
    acoes.appendChild(excluir);
    linha.appendChild(acoes);
    corpo.appendChild(linha);
  });
}

async function atualizarAtivo(regra, ativo, checkbox) {
  try {
    await api("/api/admin/regras/" + regra.id, {
      method: "PUT",
      body: JSON.stringify({
        area_id: regra.area_id,
        nome: regra.nome,
        tipo: regra.tipo,
        padrao: regra.padrao,
        risco: regra.risco,
        ativo: ativo,
      }),
    });
    regra.ativo = ativo;
    avisar(ativo ? "Regra ativada." : "Regra desativada.");
    await carregarRegras();
    await carregarAreas();
  } catch (erro) {
    checkbox.checked = !ativo;
    tratarErro(erro);
  }
}

function abrirRegra(regra) {
  $("titulo-regra").textContent = regra ? "Editar regra" : "Nova regra";
  $("regra-id").value = regra ? regra.id : "";
  $("regra-nome").value = regra ? regra.nome : "";
  $("regra-tipo").value = regra ? regra.tipo : "palavra-chave";
  $("regra-padrao").value = regra ? regra.padrao : "";
  $("regra-risco").value = regra ? regra.risco : "medio";
  $("regra-ativa").checked = regra ? regra.ativo : true;
  $("regra-teste").value = "";
  $("resultado-teste").textContent = "";
  $("resultado-teste").className = "resultado";

  if (regra) {
    $("regra-area").value = String(regra.area_id);
  } else if (estado.areas.length) {
    $("regra-area").value = String(estado.areas[0].id);
  }

  $("dialogo-regra").showModal();
}

function testarRegra() {
  const tipo = $("regra-tipo").value;
  const padrao = $("regra-padrao").value;
  const texto = $("regra-teste").value;
  const resultado = $("resultado-teste");

  if (!padrao.trim()) {
    resultado.textContent = "Informe um padrão antes de testar.";
    resultado.className = "resultado erro";
    return;
  }
  if (!texto.trim()) {
    resultado.textContent = "Digite um texto de exemplo.";
    resultado.className = "resultado erro";
    return;
  }

  if (tipo === "regex") {
    let regex;
    try {
      regex = new RegExp(padrao, "gi");
    } catch (erro) {
      resultado.textContent = "Expressão inválida: " + erro.message;
      resultado.className = "resultado erro";
      return;
    }
    const encontrados = texto.match(regex);
    const total = encontrados ? encontrados.length : 0;
    resultado.textContent =
      total > 0
        ? total + " correspondência(s) encontrada(s) no texto de exemplo."
        : "Nenhuma correspondência no texto de exemplo.";
    resultado.className = "resultado " + (total > 0 ? "ok" : "erro");
    return;
  }

  const alvo = normalizar(texto);
  let total = 0;
  padrao.split(",").forEach(function (termo) {
    const limpo = normalizar(termo.trim());
    if (limpo.length < 2) return;
    let posicao = alvo.indexOf(limpo);
    while (posicao >= 0) {
      total += 1;
      posicao = alvo.indexOf(limpo, posicao + limpo.length);
    }
  });

  resultado.textContent =
    total > 0
      ? total + " correspondência(s) encontrada(s) no texto de exemplo."
      : "Nenhuma correspondência no texto de exemplo.";
  resultado.className = "resultado " + (total > 0 ? "ok" : "erro");
}

async function salvarRegra(evento) {
  evento.preventDefault();
  const id = $("regra-id").value;
  const dados = {
    area_id: Number($("regra-area").value),
    nome: $("regra-nome").value,
    tipo: $("regra-tipo").value,
    padrao: $("regra-padrao").value,
    risco: $("regra-risco").value,
    ativo: $("regra-ativa").checked,
  };

  try {
    if (id) {
      await api("/api/admin/regras/" + id, { method: "PUT", body: JSON.stringify(dados) });
      avisar("Regra atualizada.");
    } else {
      await api("/api/admin/regras", { method: "POST", body: JSON.stringify(dados) });
      avisar("Regra criada.");
    }
    $("dialogo-regra").close();
    await carregarRegras();
    await carregarAreas();
  } catch (erro) {
    tratarErro(erro);
  }
}

// ---------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------

function abrirArea(area) {
  $("titulo-area").textContent = area ? "Editar área" : "Nova área";
  $("area-id").value = area ? area.id : "";
  $("area-nome").value = area ? area.nome : "";
  $("area-descricao").value = area ? area.descricao : "";
  $("dialogo-area").showModal();
}

async function salvarArea(evento) {
  evento.preventDefault();
  const id = $("area-id").value;
  const dados = {
    nome: $("area-nome").value,
    descricao: $("area-descricao").value,
  };

  try {
    if (id) {
      await api("/api/admin/areas/" + id, { method: "PUT", body: JSON.stringify(dados) });
      avisar("Área atualizada.");
    } else {
      await api("/api/admin/areas", { method: "POST", body: JSON.stringify(dados) });
      avisar("Área criada.");
    }
    $("dialogo-area").close();
    await carregarAreas();
    await carregarRegras();
  } catch (erro) {
    tratarErro(erro);
  }
}

// ---------------------------------------------------------------------------
// Mensagens educativas
// ---------------------------------------------------------------------------

async function carregarMensagens() {
  const mensagens = await api("/api/admin/mensagens");
  const container = $("mensagens");
  limpar(container);

  mensagens.forEach(function (mensagem) {
    const editor = criar("section", "mensagem-editor");

    const topo = criar("div", "topo-editor");
    topo.appendChild(badge(mensagem.nivel));
    topo.appendChild(criar("span", "rotulo", "mensagem educativa"));
    editor.appendChild(topo);

    const campo = document.createElement("textarea");
    campo.value = mensagem.texto;
    campo.maxLength = 600;
    campo.setAttribute("aria-label", "Mensagem educativa para risco " + mensagem.nivel);
    editor.appendChild(campo);

    const rodape = criar("div", "rodape-editor");
    const contador = criar("span", "rotulo", mensagem.texto.length + "/600");
    campo.addEventListener("input", function () {
      contador.textContent = campo.value.length + "/600";
    });

    const salvar = criar("button", "botao pequeno primario", "Salvar");
    salvar.type = "button";
    salvar.addEventListener("click", async function () {
      try {
        await api("/api/admin/mensagens/" + mensagem.nivel, {
          method: "PUT",
          body: JSON.stringify({ texto: campo.value }),
        });
        avisar("Mensagem de risco " + mensagem.nivel + " salva.");
      } catch (erro) {
        tratarErro(erro);
      }
    });

    rodape.appendChild(contador);
    rodape.appendChild(salvar);
    editor.appendChild(rodape);

    const preview = criar("div", "preview-aviso");
    const linhaPreview = criar("div", "linha-preview");
    linhaPreview.appendChild(
      criar("span", "rotulo", "Prévia · risco " + ROTULO_NIVEL[mensagem.nivel]),
    );
    linhaPreview.appendChild(criar("span", "micro", "tipos detectados"));
    preview.appendChild(linhaPreview);
    preview.appendChild(criar("p", "micro", mensagem.texto));
    editor.appendChild(preview);

    container.appendChild(editor);
  });
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

async function popularFiltroDepartamento() {
  const select = $("filtro-departamento");
  const atual = select.value;

  let emUso = [];
  try {
    emUso = await api("/api/admin/departamentos");
  } catch (erro) {
    emUso = [];
  }

  const nomes = [];
  estado.areas.forEach(function (area) {
    if (nomes.indexOf(area.nome) < 0) nomes.push(area.nome);
  });
  emUso.forEach(function (item) {
    if (item.departamento && nomes.indexOf(item.departamento) < 0) {
      nomes.push(item.departamento);
    }
  });
  // Alertas enviados sem departamento preenchido ficam como “Não informado”.
  if (nomes.indexOf("Não informado") < 0) nomes.push("Não informado");
  nomes.sort(function (a, b) {
    return a.localeCompare(b, "pt-BR");
  });

  limpar(select);
  const todas = criar("option", "", "Todos os departamentos");
  todas.value = "todos";
  select.appendChild(todas);

  nomes.forEach(function (nome) {
    const opcao = criar("option", "", nome);
    opcao.value = nome;
    select.appendChild(opcao);
  });

  select.value = atual && (atual === "todos" || nomes.indexOf(atual) >= 0) ? atual : "todos";
}

function lerFiltros() {
  estado.filtros = {
    de: $("filtro-de").value,
    ate: $("filtro-ate").value,
    departamento: $("filtro-departamento").value,
    nivel: $("filtro-nivel").value,
  };
}

function parametrosFiltros() {
  const parametros = new URLSearchParams();
  if (estado.filtros.de) parametros.set("de", estado.filtros.de);
  if (estado.filtros.ate) parametros.set("ate", estado.filtros.ate);
  if (estado.filtros.departamento && estado.filtros.departamento !== "todos") {
    parametros.set("departamento", estado.filtros.departamento);
  }
  if (estado.filtros.nivel && estado.filtros.nivel !== "todos") {
    parametros.set("nivel", estado.filtros.nivel);
  }
  return parametros;
}

async function carregarAlertas(pagina) {
  lerFiltros();
  const parametros = parametrosFiltros();
  parametros.set("pagina", String(pagina));
  parametros.set("por_pagina", "12");

  const dados = await api("/api/admin/alertas?" + parametros.toString());
  estado.pagina = dados.pagina;
  estado.totalPaginas = dados.total_paginas;

  const filtrosExportacao = parametrosFiltros().toString();
  $("exportar").href = "/api/admin/exportar.csv?" + filtrosExportacao;
  $("exportar-pdf").href = "/api/admin/exportar.pdf?" + filtrosExportacao;
  $("resumo-listagem").textContent =
    dados.total + " alerta(s) · página " + dados.pagina + " de " + dados.total_paginas;
  $("pagina-info").textContent = dados.pagina + " / " + dados.total_paginas;
  $("pagina-anterior").disabled = dados.pagina <= 1;
  $("pagina-proxima").disabled = dados.pagina >= dados.total_paginas;

  const corpo = $("tabela-alertas");
  limpar(corpo);

  if (!dados.registros.length) {
    const linha = criar("tr");
    const celula = criar("td", "nota", "Nenhum alerta com estes filtros.");
    celula.colSpan = 10;
    linha.appendChild(celula);
    corpo.appendChild(linha);
    return;
  }

  dados.registros.forEach(function (alerta) {
    const linha = criar("tr");

    linha.appendChild(criar("td", "", quando(alerta.data_hora)));
    linha.appendChild(criar("td", "", alerta.departamento));
    linha.appendChild(criar("td", "", alerta.colaborador || "Não informado"));
    linha.appendChild(criar("td", "ip", alerta.ip || "—"));
    linha.appendChild(criar("td", "", alerta.site));
    linha.appendChild(
      criar("td", "origem", ROTULO_ORIGEM[alerta.origem] || "Texto digitado"),
    );

    const nivel = criar("td");
    nivel.appendChild(badge(alerta.nivel_risco));
    linha.appendChild(nivel);

    const acao = criar("td", "", alerta.acao === "enviou" ? "Enviou mesmo assim" : "Cancelou");
    linha.appendChild(acao);

    const tipos = criar("td", "", alerta.itens.map(function (item) {
      return item.tipo_detectado;
    }).join(" · ") || "—");
    tipos.style.maxWidth = "220px";
    tipos.style.overflow = "hidden";
    tipos.style.textOverflow = "ellipsis";
    tipos.style.whiteSpace = "nowrap";
    linha.appendChild(tipos);

    const acoes = criar("td", "direita");
    const ver = criar("button", "botao pequeno", "Detalhe");
    ver.type = "button";
    ver.addEventListener("click", function () { abrirDetalhe(alerta.id); });

    const excluir = criar("button", "botao pequeno perigo", "Excluir");
    excluir.type = "button";
    excluir.style.marginLeft = "6px";
    excluir.addEventListener("click", function () {
      confirmar(
        "Excluir alerta?",
        "O registro e seus tipos detectados serão removidos da auditoria. Esta ação não pode ser desfeita.",
        "Excluir alerta",
        async function () {
          try {
            await api("/api/admin/alertas/" + alerta.id, { method: "DELETE" });
            avisar("Alerta removido.");
            await carregarAlertas(estado.pagina);
          } catch (erro) {
            tratarErro(erro);
          }
        },
      );
    });

    acoes.appendChild(ver);
    acoes.appendChild(excluir);
    linha.appendChild(acoes);
    corpo.appendChild(linha);
  });
}

async function abrirDetalhe(id) {
  try {
    const alerta = await api("/api/admin/alertas/" + id);
    estado.alertaAtual = alerta;

    $("detalhe-titulo").textContent = alerta.departamento + " · " + alerta.site;
    $("detalhe-sub").textContent = quando(alerta.data_hora);

    const campos = $("detalhe-campos");
    limpar(campos);
    const pares = [
      ["Nível de risco", ROTULO_NIVEL[alerta.nivel_risco]],
      ["Ação", alerta.acao === "enviou" ? "Enviou mesmo assim" : "Cancelou e revisou"],
      ["Colaborador", alerta.colaborador || "Não informado"],
      ["IP de origem", alerta.ip || "—"],
      ["Origem", ROTULO_ORIGEM[alerta.origem] || "Texto digitado"],
    ];
    pares.forEach(function (par) {
      const linha = criar("div");
      linha.appendChild(criar("dt", "", par[0]));
      linha.appendChild(criar("dd", "", par[1]));
      campos.appendChild(linha);
    });

    const lista = $("detalhe-itens");
    limpar(lista);
    if (!alerta.itens.length) {
      lista.appendChild(criar("li", "", "Nenhum tipo registrado."));
    } else {
      alerta.itens.forEach(function (item) {
        const linha = criar("li");
        const bloco = criar("span");
        bloco.appendChild(criar("span", "", item.tipo_detectado));
        bloco.appendChild(criar("p", "meta", item.area || "—"));
        linha.appendChild(bloco);
        linha.appendChild(badge(item.risco));
        lista.appendChild(linha);
      });
    }

    $("dialogo-alerta").showModal();
  } catch (erro) {
    tratarErro(erro);
  }
}

async function exportarFiltrosAtuais() {
  lerFiltros();
  window.location.href = "/api/admin/exportar.csv?" + parametrosFiltros().toString();
}

// ---------------------------------------------------------------------------
// Instalação (código da extensão e administradores)
// ---------------------------------------------------------------------------

async function carregarInstalacao() {
  const dados = await api("/api/admin/instalacao");
  $("instalacao-url").textContent = dados.url_base;
  $("instalacao-token").textContent = dados.token;
  $("instalacao-token").dataset.valor = dados.token;
  $("instalacao-origem").textContent = dados.endereco_visto || "—";
  $("instalacao-versao").textContent = "versão " + dados.versao;
  $("instalacao-banco").textContent =
    "Externo (Postgres) · os alertas ficam gravados na nuvem";

  const modo = $("instalacao-modo");
  modo.textContent = "Exige código";
  modo.className = "badge risco-alto";
  $("instalacao-exigencia").textContent =
    "Obrigatório: a extensão de cada computador precisa do código para registrar alertas.";
}

async function copiarToken() {
  const valor = $("instalacao-token").dataset.valor || $("instalacao-token").textContent;
  if (!valor) return;
  try {
    await navigator.clipboard.writeText(valor);
    avisar("Código copiado. Cole em Opções da extensão.");
  } catch (erro) {
    avisar("Não foi possível copiar. Selecione o código manualmente.", "erro");
  }
}

async function renovarToken() {
  try {
    const resposta = await api("/api/admin/instalacao/renovar-token", { method: "POST" });
    avisar(resposta.mensagem || "Código renovado.");
    await carregarInstalacao();
  } catch (erro) {
    tratarErro(erro);
  }
}

async function carregarAdmins() {
  const admins = await api("/api/admin/usuarios");
  const corpo = $("tabela-admins");
  limpar(corpo);

  admins.forEach(function (admin) {
    const linha = criar("tr");

    const usuario = criar("td");
    usuario.appendChild(document.createTextNode(admin.usuario));
    if (admin.atual) {
      const marca = criar("span", "micro", " · você");
      usuario.appendChild(marca);
    }
    linha.appendChild(usuario);

    linha.appendChild(criar("td", "", quando(admin.criado_em)));

    const acoes = criar("td", "direita");
    const senha = criar("button", "botao pequeno", "Trocar senha");
    senha.type = "button";
    senha.addEventListener("click", function () { abrirAdmin(admin); });
    acoes.appendChild(senha);

    if (!admin.atual) {
      const remover = criar("button", "botao pequeno perigo", "Remover");
      remover.type = "button";
      remover.style.marginLeft = "6px";
      remover.addEventListener("click", function () {
        confirmar(
          "Remover administrador?",
          "A conta de " + admin.usuario + " perde o acesso ao painel. Os alertas já registrados não são afetados.",
          "Remover acesso",
          async function () {
            try {
              await api("/api/admin/usuarios/" + admin.id, { method: "DELETE" });
              avisar("Administrador removido.");
              await carregarAdmins();
            } catch (erro) {
              tratarErro(erro);
            }
          },
        );
      });
      acoes.appendChild(remover);
    }

    linha.appendChild(acoes);
    corpo.appendChild(linha);
  });
}

function abrirAdmin(admin) {
  const editando = Boolean(admin);
  $("titulo-admin").textContent = editando ? "Trocar senha" : "Novo administrador";
  $("admin-id").value = editando ? String(admin.id) : "";
  $("admin-usuario").value = editando ? admin.usuario : "";
  $("admin-usuario").disabled = editando;
  $("admin-senha").value = "";
  $("admin-senha-atual").value = "";
  $("campo-senha-atual").hidden = !editando;
  $("admin-senha-atual").required = editando;
  $("admin-dica").textContent = editando
    ? "Confirme com a sua senha atual e defina a nova senha desta conta."
    : "A senha precisa de pelo menos 8 caracteres.";
  $("dialogo-admin").showModal();
  if (!editando) $("admin-usuario").focus();
}

async function salvarAdmin(evento) {
  evento.preventDefault();
  const id = $("admin-id").value;
  const senha = $("admin-senha").value;

  try {
    if (id) {
      await api("/api/admin/usuarios/" + id + "/senha", {
        method: "PUT",
        body: JSON.stringify({
          senha: senha,
          senha_atual: $("admin-senha-atual").value,
        }),
      });
      avisar("Senha atualizada.");
    } else {
      await api("/api/admin/usuarios", {
        method: "POST",
        body: JSON.stringify({ usuario: $("admin-usuario").value.trim(), senha: senha }),
      });
      avisar("Administrador criado.");
    }
    $("dialogo-admin").close();
    await carregarAdmins();
  } catch (erro) {
    tratarErro(erro);
  }
}

async function exportarPdfFiltrosAtuais() {
  lerFiltros();
  window.location.href = "/api/admin/exportar.pdf?" + parametrosFiltros().toString();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function ligarEventos() {
  document.querySelectorAll("[data-ir]").forEach(function (botao) {
    botao.addEventListener("click", function () { irPara(botao.dataset.ir); });
  });

  $("atualizar-resumo").addEventListener("click", function () {
    carregarResumo().catch(tratarErro);
  });

  $("form-limiar").addEventListener("submit", async function (evento) {
    evento.preventDefault();
    const limiar = Number($("limiar").value);
    try {
      await api("/api/admin/configuracoes", {
        method: "PUT",
        body: JSON.stringify({ limiar_gargalo: limiar }),
      });
      avisar("Tolerância de risco atualizada.");
      await carregarResumo();
    } catch (erro) {
      tratarErro(erro);
    }
  });

  $("nova-regra").addEventListener("click", function () { abrirRegra(null); });
  $("form-regra").addEventListener("submit", salvarRegra);
  $("testar-regra").addEventListener("click", testarRegra);
  $("busca-regras").addEventListener("input", renderizarRegras);

  $("nova-area").addEventListener("click", function () { abrirArea(null); });
  $("form-area").addEventListener("submit", salvarArea);

  $("form-filtros").addEventListener("submit", function (evento) {
    evento.preventDefault();
    carregarAlertas(1).catch(tratarErro);
  });

  $("limpar-filtros").addEventListener("click", function () {
    $("filtro-de").value = "";
    $("filtro-ate").value = "";
    $("filtro-departamento").value = "todos";
    $("filtro-nivel").value = "todos";
    carregarAlertas(1).catch(tratarErro);
  });

  $("pagina-anterior").addEventListener("click", function () {
    if (estado.pagina > 1) carregarAlertas(estado.pagina - 1).catch(tratarErro);
  });

  $("pagina-proxima").addEventListener("click", function () {
    if (estado.pagina < estado.totalPaginas) {
      carregarAlertas(estado.pagina + 1).catch(tratarErro);
    }
  });

  $("exportar").addEventListener("click", function (evento) {
    evento.preventDefault();
    exportarFiltrosAtuais();
  });

  $("exportar-pdf").addEventListener("click", function (evento) {
    evento.preventDefault();
    exportarPdfFiltrosAtuais();
  });

  $("copiar-token").addEventListener("click", function () {
    void copiarToken();
  });

  $("renovar-token").addEventListener("click", function () {
    confirmar(
      "Renovar o código de instalação?",
      "As extensões que já usam o código atual param de registrar alertas até receberem o novo valor.",
      "Renovar código",
      function () { void renovarToken(); },
    );
  });

  $("novo-admin").addEventListener("click", function () { abrirAdmin(null); });
  $("form-admin").addEventListener("submit", salvarAdmin);

  $("abrir-idade").addEventListener("click", function () {
    $("dialogo-idade").showModal();
  });

  $("form-idade").addEventListener("submit", async function (evento) {
    evento.preventDefault();
    const dias = Number($("idade-dias").value);
    try {
      const resposta = await api("/api/admin/alertas/limpar-idade", {
        method: "POST",
        body: JSON.stringify({ dias: dias }),
      });
      $("dialogo-idade").close();
      avisar(
        resposta.removidos === 0
          ? "Nenhum alerta mais antigo que o período informado."
          : resposta.removidos + " alerta(s) removido(s).",
      );
      await carregarAlertas(1);
    } catch (erro) {
      tratarErro(erro);
    }
  });

  $("limpar-tudo").addEventListener("click", function () {
    confirmar(
      "Limpar todos os alertas?",
      "Toda a base de auditoria será apagada, inclusive os itens detectados. Esta ação não pode ser desfeita.",
      "Limpar tudo",
      async function () {
        try {
          const resposta = await api("/api/admin/alertas", { method: "DELETE" });
          avisar(resposta.removidos + " alerta(s) removido(s) definitivamente.");
          await carregarAlertas(1);
        } catch (erro) {
          tratarErro(erro);
        }
      },
    );
  });

  $("confirmar-cancelar").addEventListener("click", function () {
    acaoConfirmada = null;
    $("dialogo-confirmar").close();
  });

  $("confirmar-ok").addEventListener("click", function () {
    const acao = acaoConfirmada;
    acaoConfirmada = null;
    $("dialogo-confirmar").close();
    if (acao) acao();
  });

  $("detalhe-excluir").addEventListener("click", function () {
    if (!estado.alertaAtual) return;
    const id = estado.alertaAtual.id;
    confirmar(
      "Excluir alerta?",
      "O registro e seus tipos detectados serão removidos da auditoria.",
      "Excluir alerta",
      async function () {
        try {
          await api("/api/admin/alertas/" + id, { method: "DELETE" });
          $("dialogo-alerta").close();
          estado.alertaAtual = null;
          avisar("Alerta removido.");
          await carregarAlertas(estado.pagina);
        } catch (erro) {
          tratarErro(erro);
        }
      },
    );
  });

  document.querySelectorAll("[data-fecha]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      const dialogo = $(botao.dataset.fecha);
      if (dialogo) dialogo.close();
    });
  });

  document.querySelectorAll(".dialogo").forEach(function (dialogo) {
    dialogo.addEventListener("click", function (evento) {
      if (evento.target === dialogo) dialogo.close();
    });
  });
}

/**
 * Atualização automática: um alerta registrado pela extensão aparece no painel
 * em poucos segundos, sem precisar recarregar a página. Fica parada quando a
 * aba está escondida e não mexe nas seções de cadastro.
 */
const INTERVALO_ATUALIZACAO = 15000;

function iniciarAtualizacaoAutomatica() {
  window.setInterval(function () {
    if (document.hidden) return;
    if (document.querySelector("dialog[open]")) return;
    if (estado.secao === "visao") {
      carregarResumo().catch(function () {
        /* erro já aparece no toast da próxima ação */
      });
    } else if (estado.secao === "alertas") {
      carregarAlertas(estado.pagina).catch(function () {
        /* mantém a lista atual se a rede falhar */
      });
    }
  }, INTERVALO_ATUALIZACAO);
}

document.addEventListener("DOMContentLoaded", function () {
  ligarEventos();
  irPara("visao");
  iniciarAtualizacaoAutomatica();
});
