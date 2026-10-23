/**
 * Semeadura idempotente do banco: matriz de risco, mensagens educativas,
 * configurações padrão e uma amostra de alertas para o painel não nascer vazio.
 * Pode ser chamada a cada carregamento — só escreve quando falta algo.
 */
import { mutation, type MutationCtx } from "./_generated/server";
import { AREAS_SEED, MENSAGENS_PADRAO, type Risco } from "../lib/dados";

const COLABORADORES = [
  "ana.silva",
  "bruno.costa",
  "carla.mendes",
  "diego.rocha",
  "elisa.prado",
  "felipe.araujo",
  undefined,
  undefined,
];

const SITES_DEMO = [
  "chatgpt.com",
  "gemini.google.com",
  "claude.ai",
  "copilot.microsoft.com",
];

/** Tipos plausíveis por departamento, usados apenas na amostra. */
const TIPOS_POR_DEPARTAMENTO: Record<string, Array<{ tipo: string; risco: Risco }>> = {
  RH: [
    { tipo: "CPF", risco: "alto" },
    { tipo: "Salário", risco: "alto" },
    { tipo: "Dados bancários", risco: "alto" },
    { tipo: "Nome do funcionário", risco: "baixo" },
    { tipo: "Cargo ou função", risco: "baixo" },
  ],
  Financeiro: [
    { tipo: "Faturamento", risco: "alto" },
    { tipo: "Dados bancários", risco: "alto" },
    { tipo: "Orçamento interno", risco: "medio" },
    { tipo: "Valor de despesa", risco: "medio" },
    { tipo: "Nome de conta ou setor", risco: "baixo" },
  ],
  TI: [
    { tipo: "Token ou chave de API", risco: "alto" },
    { tipo: "Código-fonte interno", risco: "alto" },
    { tipo: "IP ou servidor interno", risco: "alto" },
    { tipo: "Senha ou credencial", risco: "alto" },
    { tipo: "Mensagem de erro genérica", risco: "baixo" },
  ],
  Jurídico: [
    { tipo: "Cláusulas contratuais", risco: "alto" },
    { tipo: "Valor de contrato", risco: "alto" },
    { tipo: "Número de contrato", risco: "medio" },
    { tipo: "Nome de fornecedor", risco: "baixo" },
  ],
  "Projetos e Estratégias": [
    { tipo: "Estratégia de negócio", risco: "alto" },
    { tipo: "Produto não lançado", risco: "alto" },
    { tipo: "Cronograma de projeto", risco: "medio" },
    { tipo: "Nome de projeto interno", risco: "medio" },
  ],
};

/** Gerador pseudoaleatório determinístico (mesma amostra em todo ambiente). */
function criarSorteio(semente: number) {
  let estado = semente;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
}

function nivelDosItens(itens: Array<{ risco: Risco }>): Risco {
  if (itens.some((item) => item.risco === "alto")) return "alto";
  if (itens.some((item) => item.risco === "medio")) return "medio";
  return "baixo";
}

/** Cria a amostra de alertas (marcada com demo: true). */
async function semearAmostra(ctx: MutationCtx) {
  const agora = Date.now();
  const sorteio = criarSorteio(20261018);
  const departamentos = Object.keys(TIPOS_POR_DEPARTAMENTO);

  for (let i = 0; i < 64; i++) {
    const diasAtras = Math.floor(sorteio() * 14);
    const hora = 8 + Math.floor(sorteio() * 10);
    const minuto = Math.floor(sorteio() * 60);
    const data = new Date(agora - diasAtras * 86_400_000);
    data.setHours(hora, minuto, 0, 0);

    const departamento = departamentos[Math.floor(sorteio() * departamentos.length)];
    const catalogo = TIPOS_POR_DEPARTAMENTO[departamento]!;
    const quantidade = 1 + Math.floor(sorteio() * 3);
    const escolhidos: Array<{ tipo: string; risco: Risco }> = [];
    for (let j = 0; j < quantidade; j++) {
      const item = catalogo[Math.floor(sorteio() * catalogo.length)]!;
      if (!escolhidos.some((existente) => existente.tipo === item.tipo)) {
        escolhidos.push(item);
      }
    }

    const nivelRisco = nivelDosItens(escolhidos);
    // Quanto maior o risco, maior a chance de o colaborador cancelar.
    const chanceCancelar = nivelRisco === "alto" ? 0.44 : nivelRisco === "medio" ? 0.3 : 0.18;
    const acao = sorteio() < chanceCancelar ? "cancelou" : "enviou";

    const alertaId = await ctx.db.insert("alertas", {
      dataHora: data.getTime(),
      site: SITES_DEMO[Math.floor(sorteio() * SITES_DEMO.length)]!,
      departamento,
      colaborador: COLABORADORES[Math.floor(sorteio() * COLABORADORES.length)],
      nivelRisco,
      acao,
      demo: true,
    });

    for (const item of escolhidos) {
      await ctx.db.insert("alertaItens", {
        alertaId,
        tipoDetectado: item.tipo,
        risco: item.risco,
        area: departamento,
      });
    }
  }
}

/**
 * Garante a configuração inicial. Idempotente: pode rodar em toda visita.
 * Não exige autenticação porque a landing também exibe a configuração pública.
 */
export const garantirSeed = mutation({
  args: {},
  handler: async (ctx) => {
    // Sincroniza a matriz expandida mesmo em bancos já semeados. Na primeira
    // execução da versão 2, atualiza as regras semeadas (padrão bilíngue);
    // depois disso, só cria o que falta, preservando edições feitas no painel.
    const controleVersao = await ctx.db
      .query("configuracoes")
      .withIndex("por_chave", (q) => q.eq("chave", "matrizVersao"))
      .first();
    const atualizarMatriz = !controleVersao || controleVersao.valor !== "2";

    for (const area of AREAS_SEED) {
      const areaExistente = await ctx.db
        .query("areas")
        .withIndex("por_nome", (q) => q.eq("nome", area.nome))
        .first();

      const areaId =
        areaExistente?._id ??
        (await ctx.db.insert("areas", {
          nome: area.nome,
          descricao: area.descricao,
        }));

      const existentes = await ctx.db
        .query("regras")
        .withIndex("por_area", (q) => q.eq("areaId", areaId))
        .collect();

      for (const regra of area.regras) {
        const existente = existentes.find((item) => item.nome === regra.nome);
        if (existente) {
          if (atualizarMatriz) {
            await ctx.db.patch(existente._id, {
              tipo: regra.tipo,
              padrao: regra.padrao,
              risco: regra.risco,
            });
          }
          continue;
        }
        await ctx.db.insert("regras", {
          areaId,
          nome: regra.nome,
          tipo: regra.tipo,
          padrao: regra.padrao,
          risco: regra.risco,
          ativo: true,
        });
      }
    }

    if (atualizarMatriz) {
      if (controleVersao) {
        await ctx.db.patch(controleVersao._id, { valor: "2" });
      } else {
        await ctx.db.insert("configuracoes", { chave: "matrizVersao", valor: "2" });
      }
    }

    const mensagens = await ctx.db.query("mensagens").collect();
    for (const nivel of ["baixo", "medio", "alto"] as const) {
      if (!mensagens.some((mensagem) => mensagem.nivel === nivel)) {
        await ctx.db.insert("mensagens", { nivel, texto: MENSAGENS_PADRAO[nivel] });
      }
    }

    const configuracaoLimiar = await ctx.db
      .query("configuracoes")
      .withIndex("por_chave", (q) => q.eq("chave", "limiarGargalo"))
      .first();
    if (!configuracaoLimiar) {
      await ctx.db.insert("configuracoes", { chave: "limiarGargalo", valor: "30" });
    }

    const controleDemo = await ctx.db
      .query("configuracoes")
      .withIndex("por_chave", (q) => q.eq("chave", "amostraCriada"))
      .first();
    if (!controleDemo) {
      await semearAmostra(ctx);
      await ctx.db.insert("configuracoes", { chave: "amostraCriada", valor: "sim" });
    }

    return { ok: true };
  },
});
