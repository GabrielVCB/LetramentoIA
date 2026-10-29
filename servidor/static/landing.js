/**
 * Sentinela — demonstração local da página inicial.
 *
 * Usa o mesmo motor de detecção da extensão (detectores.js) e as regras
 * públicas de /api/config. Nenhum texto sai do navegador.
 */
(function () {
  "use strict";

  var motor = globalThis.PainelDetectores;
  var campo = document.getElementById("demo-texto");
  var caixa = document.getElementById("demo-caixa");
  var nivel = document.getElementById("demo-nivel");
  var contagem = document.getElementById("demo-contagem");
  var tipos = document.getElementById("demo-tipos");
  var mensagem = document.getElementById("demo-mensagem");

  if (!motor || !campo || !caixa || !nivel || !contagem || !tipos || !mensagem) return;

  var ROTULOS = { baixo: "Baixo", medio: "Médio", alto: "Alto" };
  var MENSAGENS = {
    baixo:
      "Nenhum dado de risco médio ou alto foi identificado neste conteúdo. Revise antes de compartilhar: o envio fica registrado no painel de governança.",
    medio:
      "Esta informação contém dados internos que podem apresentar riscos à empresa. Evite compartilhar informações desnecessárias e verifique as regras de uso de IA da empresa antes do compartilhamento.",
    alto:
      "Esta informação contém dados confidenciais, pessoais, estratégicos ou relacionados à segurança da empresa. Não compartilhe com uma IA pública. Remova os dados sensíveis ou utilize uma ferramenta de IA corporativa autorizada.",
  };

  // Esta página é pública: a prévia usa os detectores embutidos, sem pedir ao
  // servidor a matriz da empresa (que agora exige o código de instalação).
  var regras = [];
  var ultimo = "";

  function renderizar(resultado) {
    var assinatura = resultado.nivel + "|" +
      resultado.deteccoes.map(function (item) {
        return item.tipo;
      }).join(",");

    caixa.className = "lp-demo-caixa demo-" + resultado.nivel;
    nivel.textContent = "Risco " + ROTULOS[resultado.nivel];
    contagem.textContent = resultado.deteccoes.length
      ? resultado.deteccoes.length + " tipo(s) · " + resultado.totalOcorrencias + " ocorrência(s)"
      : "sem detecções";

    tipos.replaceChildren();
    resultado.deteccoes.forEach(function (deteccao) {
      var item = document.createElement("li");
      var ponto = document.createElement("span");
      ponto.className = "lp-tipo-dot " + deteccao.risco;
      var nome = document.createElement("b");
      nome.textContent = deteccao.tipo;
      var area = document.createElement("span");
      area.className = "lp-tipo-area";
      area.textContent = deteccao.area;
      item.appendChild(ponto);
      item.appendChild(nome);
      item.appendChild(area);
      tipos.appendChild(item);
    });

    mensagem.textContent = (window.__mensagensSentinela || MENSAGENS)[resultado.nivel];

    // Reinicia a animação de entrada apenas quando o conteúdo muda.
    if (assinatura !== ultimo) {
      ultimo = assinatura;
      caixa.classList.remove("demo-atualizou");
      void caixa.offsetWidth;
      caixa.classList.add("demo-atualizou");
    }
  }

  function analisar() {
    renderizar(motor.analisarTexto(campo.value, regras));
  }

  campo.addEventListener("input", analisar);

  document.querySelectorAll("[data-texto]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      campo.value = botao.getAttribute("data-texto") || "";
      analisar();
      campo.focus();
    });
  });

  analisar();
})();
