/**
 * API do painel de governança.
 *
 * - `config` é pública: a extensão (e a landing) baixam regras e mensagens.
 * - `criarAlerta` exige sessão: recebe apenas metadados, nunca o texto digitado.
 * - Todo o restante é área administrativa (RH/Gestor autenticado).
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { acaoValidator, riscoValidator, tipoRegraValidator } from "./schema";
import { MENSAGENS_PADRAO, type Risco } from "../lib/dados";

const LIMITE_ALERTAS = 4000;
const LIMITE_ITENS = 20000;

/** Garante uma sessão válida para operações administrativas. */
async function exigirSessao(ctx: QueryCtx | MutationCtx) {
  const usuarioId = await getAuthUserId(ctx);
  if (!usuarioId) {
    throw new ConvexError("Sessão expirada. Entre novamente para continuar.");
  }
  return usuarioId;
}

/** Limpa e valida texto curto vindo do formulário. */
function textoObrigatorio(valor: string, campo: string, maximo = 120) {
  const limpo = valor.trim();
  if (limpo.length < 1) throw new ConvexError(`${campo} é obrigatório.`);
  if (limpo.length > maximo) throw new ConvexError(`${campo} deve ter até ${maximo} caracteres.`);
  return limpo;
}

/** Valida uma expressão regular antes de gravar (evita regra quebrada). */
function validarRegex(padrao: string) {
  try {
    new RegExp(padrao, "gi");
  } catch (erro) {
    throw new ConvexError(
      `Expressão regular inválida: ${erro instanceof Error ? erro.message : "verifique a sintaxe"}`,
    );
  }
}

function validarRegra(dados: {
  nome: string;
  padrao: string;
  tipo: "regex" | "palavra-chave";
}) {
  const nome = textoObrigatorio(dados.nome, "Nome da regra", 80);
  const padrao = textoObrigatorio(dados.padrao, "Padrão", 500);
  if (dados.tipo === "regex") validarRegex(padrao);
  return { nome, padrao };
}

/** Percentual seguro (0 quando o denominador é zero). */
function percentual(parte: number, total: number) {
  if (total === 0) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Configuração pública (extensão + landing)
// ---------------------------------------------------------------------------

export const config = query({
  args: {},
  handler: async (ctx) => {
    const [areas, regras, mensagens] = await Promise.all([
      ctx.db.query("areas").collect(),
      ctx.db.query("regras").collect(),
      ctx.db.query("mensagens").collect(),
    ]);

    const nomeDaArea = new Map(areas.map((area) => [area._id, area.nome]));
    const mensagensPorNivel: Record<string, string> = { ...MENSAGENS_PADRAO };
    for (const mensagem of mensagens) {
      mensagensPorNivel[mensagem.nivel] = mensagem.texto;
    }

    return {
      regras: regras
        .filter((regra) => regra.ativo)
        .map((regra) => ({
          _id: regra._id,
          nome: regra.nome,
          area: nomeDaArea.get(regra.areaId) ?? "Geral",
          tipo: regra.tipo,
          padrao: regra.padrao,
          risco: regra.risco,
          ativo: regra.ativo,
        })),
      mensagens: {
        baixo: mensagensPorNivel.baixo ?? MENSAGENS_PADRAO.baixo,
        medio: mensagensPorNivel.medio ?? MENSAGENS_PADRAO.medio,
        alto: mensagensPorNivel.alto ?? MENSAGENS_PADRAO.alto,
      },
      atualizadoEm: Date.now(),
    };
  },
});

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export const criarAlerta = mutation({
  args: {
    site: v.string(),
    departamento: v.string(),
    colaborador: v.optional(v.string()),
    nivelRisco: riscoValidator,
    acao: acaoValidator,
    dataHora: v.optional(v.number()),
    itens: v.array(
      v.object({
        tipoDetectado: v.string(),
        risco: riscoValidator,
        area: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);

    const site = textoObrigatorio(args.site, "Site", 120);
    const departamento = textoObrigatorio(args.departamento, "Departamento", 80);
    const colaborador = args.colaborador?.trim().slice(0, 80) || undefined;
    if (args.itens.length > 20) {
      throw new ConvexError("Um alerta pode conter no máximo 20 tipos detectados.");
    }

    // Recalcula o nível no servidor: a maior gravidade detectada sempre vence.
    const nivelRisco = args.itens.some((item) => item.risco === "alto")
      ? "alto"
      : args.itens.some((item) => item.risco === "medio")
        ? "medio"
        : args.itens.length > 0
          ? "baixo"
          : args.nivelRisco;

    const alertaId = await ctx.db.insert("alertas", {
      dataHora: args.dataHora ?? Date.now(),
      site,
      departamento,
      colaborador,
      nivelRisco,
      acao: args.acao,
    });

    for (const item of args.itens) {
      await ctx.db.insert("alertaItens", {
        alertaId,
        tipoDetectado: textoObrigatorio(item.tipoDetectado, "Tipo detectado", 80),
        risco: item.risco,
        area: item.area?.trim().slice(0, 60) || undefined,
      });
    }

    return { alertaId };
  },
});

/** Consulta paginada com filtros de data, departamento e nível. */
export const listarAlertas = query({
  args: {
    de: v.optional(v.number()),
    ate: v.optional(v.number()),
    departamento: v.optional(v.string()),
    nivel: v.optional(riscoValidator),
    pagina: v.number(),
    porPagina: v.number(),
  },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);

    const alertas = await ctx.db
      .query("alertas")
      .withIndex("por_data")
      .order("desc")
      .take(LIMITE_ALERTAS);

    const filtrados = alertas.filter((alerta) => {
      if (args.de !== undefined && alerta.dataHora < args.de) return false;
      if (args.ate !== undefined && alerta.dataHora > args.ate) return false;
      if (args.departamento && alerta.departamento !== args.departamento) return false;
      if (args.nivel && alerta.nivelRisco !== args.nivel) return false;
      return true;
    });

    const porPagina = Math.min(Math.max(Math.trunc(args.porPagina), 5), 50);
    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
    const pagina = Math.min(Math.max(Math.trunc(args.pagina), 1), totalPaginas);
    const inicio = (pagina - 1) * porPagina;
    const paginaAtual = filtrados.slice(inicio, inicio + porPagina);

    const registros = await Promise.all(
      paginaAtual.map(async (alerta) => {
        const itens = await ctx.db
          .query("alertaItens")
          .withIndex("por_alerta", (q) => q.eq("alertaId", alerta._id))
          .collect();
        return {
          _id: alerta._id,
          dataHora: alerta.dataHora,
          site: alerta.site,
          departamento: alerta.departamento,
          colaborador: alerta.colaborador,
          nivelRisco: alerta.nivelRisco,
          acao: alerta.acao,
          demo: alerta.demo ?? false,
          itens: itens.map((item) => ({
            tipoDetectado: item.tipoDetectado,
            risco: item.risco,
            area: item.area,
          })),
        };
      }),
    );

    return { registros, total: filtrados.length, pagina, totalPaginas, porPagina };
  },
});

export const detalheAlerta = query({
  args: { alertaId: v.id("alertas") },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const alerta = await ctx.db.get(args.alertaId);
    if (!alerta) return null;
    const itens = await ctx.db
      .query("alertaItens")
      .withIndex("por_alerta", (q) => q.eq("alertaId", args.alertaId))
      .collect();
    return { ...alerta, itens };
  },
});

export const removerAlerta = mutation({
  args: { alertaId: v.id("alertas") },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const itens = await ctx.db
      .query("alertaItens")
      .withIndex("por_alerta", (q) => q.eq("alertaId", args.alertaId))
      .collect();
    for (const item of itens) await ctx.db.delete(item._id);
    await ctx.db.delete(args.alertaId);
    return { ok: true };
  },
});

export const limparPorIdade = mutation({
  args: { dias: v.number() },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const dias = Math.trunc(args.dias);
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) {
      throw new ConvexError("Informe um número de dias entre 1 e 3650.");
    }
    const limite = Date.now() - dias * 86_400_000;
    const antigos = await ctx.db
      .query("alertas")
      .withIndex("por_data", (q) => q.lt("dataHora", limite))
      .take(1000);

    for (const alerta of antigos) {
      const itens = await ctx.db
        .query("alertaItens")
        .withIndex("por_alerta", (q) => q.eq("alertaId", alerta._id))
        .collect();
      for (const item of itens) await ctx.db.delete(item._id);
      await ctx.db.delete(alerta._id);
    }
    return { removidos: antigos.length, limite };
  },
});

export const limparTudo = mutation({
  args: {},
  handler: async (ctx) => {
    await exigirSessao(ctx);
    let removidos = 0;
    const itens = await ctx.db.query("alertaItens").take(LIMITE_ITENS);
    for (const item of itens) await ctx.db.delete(item._id);
    const alertas = await ctx.db.query("alertas").take(LIMITE_ALERTAS);
    for (const alerta of alertas) {
      await ctx.db.delete(alerta._id);
      removidos += 1;
    }
    return { removidos };
  },
});

/** Exportação CSV: mesmos filtros, sem paginação (limite de segurança). */
export const alertasParaExportar = query({
  args: {
    de: v.optional(v.number()),
    ate: v.optional(v.number()),
    departamento: v.optional(v.string()),
    nivel: v.optional(riscoValidator),
  },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const alertas = await ctx.db
      .query("alertas")
      .withIndex("por_data")
      .order("desc")
      .take(2000);

    const filtrados = alertas.filter((alerta) => {
      if (args.de !== undefined && alerta.dataHora < args.de) return false;
      if (args.ate !== undefined && alerta.dataHora > args.ate) return false;
      if (args.departamento && alerta.departamento !== args.departamento) return false;
      if (args.nivel && alerta.nivelRisco !== args.nivel) return false;
      return true;
    });

    return await Promise.all(
      filtrados.map(async (alerta) => {
        const itens = await ctx.db
          .query("alertaItens")
          .withIndex("por_alerta", (q) => q.eq("alertaId", alerta._id))
          .collect();
        return {
          dataHora: alerta.dataHora,
          site: alerta.site,
          departamento: alerta.departamento,
          colaborador: alerta.colaborador ?? "",
          nivelRisco: alerta.nivelRisco,
          acao: alerta.acao,
          tipos: itens.map((item) => item.tipoDetectado).join(" | "),
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

export const painel = query({
  args: { limiar: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);

    const [alertas, itens, configuracao] = await Promise.all([
      ctx.db.query("alertas").withIndex("por_data").order("desc").take(LIMITE_ALERTAS),
      ctx.db.query("alertaItens").take(LIMITE_ITENS),
      ctx.db
        .query("configuracoes")
        .withIndex("por_chave", (q) => q.eq("chave", "limiarGargalo"))
        .first(),
    ]);

    const limiar =
      args.limiar ?? (configuracao ? Number(configuracao.valor) : 30) ?? 30;
    const limiarSeguro = Math.min(Math.max(Number.isFinite(limiar) ? limiar : 30, 0), 100);

    const idsVisiveis = new Set(alertas.map((alerta) => alerta._id));
    const itensVisiveis = itens.filter((item) => idsVisiveis.has(item.alertaId));
    const itensPorAlerta = new Map<string, typeof itensVisiveis>();
    for (const item of itensVisiveis) {
      const lista = itensPorAlerta.get(item.alertaId) ?? [];
      lista.push(item);
      itensPorAlerta.set(item.alertaId, lista);
    }

    const total = alertas.length;
    const totalAlto = alertas.filter((alerta) => alerta.nivelRisco === "alto").length;
    const totalEnviou = alertas.filter((alerta) => alerta.acao === "enviou").length;
    const totalCancelou = total - totalEnviou;

    const departamentos = new Map<
      string,
      { total: number; alto: number; enviou: number; cancelou: number }
    >();
    for (const alerta of alertas) {
      const atual = departamentos.get(alerta.departamento) ?? {
        total: 0,
        alto: 0,
        enviou: 0,
        cancelou: 0,
      };
      atual.total += 1;
      if (alerta.nivelRisco === "alto") atual.alto += 1;
      if (alerta.acao === "enviou") atual.enviou += 1;
      else atual.cancelou += 1;
      departamentos.set(alerta.departamento, atual);
    }

    const porDepartamento = [...departamentos.entries()]
      .map(([departamento, dados]) => ({
        departamento,
        ...dados,
        taxaAlto: percentual(dados.alto, dados.total),
        taxaEnvio: percentual(dados.enviou, dados.total),
      }))
      .sort((a, b) => b.total - a.total);

    const gargalos = porDepartamento.filter(
      (item) => item.total >= 3 && item.taxaAlto >= limiarSeguro,
    );

    const contagemTipos = new Map<
      string,
      { tipo: string; area: string; risco: Risco; total: number }
    >();
    for (const item of itensVisiveis) {
      const atual = contagemTipos.get(item.tipoDetectado) ?? {
        tipo: item.tipoDetectado,
        area: item.area ?? "Geral",
        risco: item.risco,
        total: 0,
      };
      atual.total += 1;
      contagemTipos.set(item.tipoDetectado, atual);
    }
    const tipos = [...contagemTipos.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 7);

    // Evolução dos últimos 14 dias (chave UTC para estabilidade).
    const dias: Array<{
      data: string;
      total: number;
      alto: number;
      medio: number;
      baixo: number;
      cancelou: number;
    }> = [];
    const hoje = new Date();
    for (let i = 13; i >= 0; i--) {
      const dia = new Date(hoje.getTime() - i * 86_400_000);
      dias.push({
        data: dia.toISOString().slice(0, 10),
        total: 0,
        alto: 0,
        medio: 0,
        baixo: 0,
        cancelou: 0,
      });
    }
    const indicePorDia = new Map(dias.map((dia, indice) => [dia.data, indice]));
    for (const alerta of alertas) {
      const chave = new Date(alerta.dataHora).toISOString().slice(0, 10);
      const indice = indicePorDia.get(chave);
      if (indice === undefined) continue;
      const dia = dias[indice]!;
      dia.total += 1;
      dia[alerta.nivelRisco] += 1;
      if (alerta.acao === "cancelou") dia.cancelou += 1;
    }

    const ultimos = alertas.slice(0, 5).map((alerta) => ({
      _id: alerta._id,
      dataHora: alerta.dataHora,
      site: alerta.site,
      departamento: alerta.departamento,
      colaborador: alerta.colaborador,
      nivelRisco: alerta.nivelRisco,
      acao: alerta.acao,
      itens: (itensPorAlerta.get(alerta._id) ?? []).map((item) => ({
        tipoDetectado: item.tipoDetectado,
        risco: item.risco,
      })),
    }));

    const areasAtivas = new Set(alertas.map((alerta) => alerta.departamento));

    return {
      total,
      totalAlto,
      totalEnviou,
      totalCancelou,
      taxaEnvio: percentual(totalEnviou, total),
      taxaAlto: percentual(totalAlto, total),
      tiposDistintos: contagemTipos.size,
      departamentosAtivos: areasAtivas.size,
      limiar: limiarSeguro,
      porDepartamento,
      gargalos,
      tipos,
      evolucao: dias,
      ultimos,
    };
  },
});

// ---------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------

export const listarAreas = query({
  args: {},
  handler: async (ctx) => {
    await exigirSessao(ctx);
    const [areas, regras] = await Promise.all([
      ctx.db.query("areas").collect(),
      ctx.db.query("regras").collect(),
    ]);
    return areas
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map((area) => ({
        _id: area._id,
        nome: area.nome,
        descricao: area.descricao ?? "",
        totalRegras: regras.filter((regra) => regra.areaId === area._id).length,
        totalAtivas: regras.filter((regra) => regra.areaId === area._id && regra.ativo).length,
      }));
  },
});

export const criarArea = mutation({
  args: { nome: v.string(), descricao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const nome = textoObrigatorio(args.nome, "Nome da área", 60);
    const existentes = await ctx.db.query("areas").collect();
    if (existentes.some((area) => area.nome.toLowerCase() === nome.toLowerCase())) {
      throw new ConvexError("Já existe uma área com esse nome.");
    }
    const id = await ctx.db.insert("areas", {
      nome,
      descricao: args.descricao?.trim().slice(0, 240) || undefined,
    });
    return { id };
  },
});

export const atualizarArea = mutation({
  args: { areaId: v.id("areas"), nome: v.string(), descricao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const area = await ctx.db.get(args.areaId);
    if (!area) throw new ConvexError("Área não encontrada.");
    const nome = textoObrigatorio(args.nome, "Nome da área", 60);
    const existentes = await ctx.db.query("areas").collect();
    if (
      existentes.some(
        (outra) => outra._id !== args.areaId && outra.nome.toLowerCase() === nome.toLowerCase(),
      )
    ) {
      throw new ConvexError("Já existe uma área com esse nome.");
    }
    await ctx.db.patch(args.areaId, {
      nome,
      descricao: args.descricao?.trim().slice(0, 240) || undefined,
    });
    return { ok: true };
  },
});

export const removerArea = mutation({
  args: { areaId: v.id("areas") },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const regras = await ctx.db
      .query("regras")
      .withIndex("por_area", (q) => q.eq("areaId", args.areaId))
      .collect();
    for (const regra of regras) await ctx.db.delete(regra._id);
    await ctx.db.delete(args.areaId);
    return { regrasRemovidas: regras.length };
  },
});

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

export const listarRegras = query({
  args: {},
  handler: async (ctx) => {
    await exigirSessao(ctx);
    const [areas, regras] = await Promise.all([
      ctx.db.query("areas").collect(),
      ctx.db.query("regras").collect(),
    ]);
    const nomeDaArea = new Map(areas.map((area) => [area._id, area.nome]));
    return regras
      .map((regra) => ({
        _id: regra._id,
        areaId: regra.areaId,
        area: nomeDaArea.get(regra.areaId) ?? "Geral",
        nome: regra.nome,
        tipo: regra.tipo,
        padrao: regra.padrao,
        risco: regra.risco,
        ativo: regra.ativo,
      }))
      .sort(
        (a, b) =>
          a.area.localeCompare(b.area, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"),
      );
  },
});

export const criarRegra = mutation({
  args: {
    areaId: v.id("areas"),
    nome: v.string(),
    tipo: tipoRegraValidator,
    padrao: v.string(),
    risco: riscoValidator,
    ativo: v.boolean(),
  },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const area = await ctx.db.get(args.areaId);
    if (!area) throw new ConvexError("Selecione uma área válida.");
    const { nome, padrao } = validarRegra(args);
    const id = await ctx.db.insert("regras", {
      areaId: args.areaId,
      nome,
      tipo: args.tipo,
      padrao,
      risco: args.risco,
      ativo: args.ativo,
    });
    return { id };
  },
});

export const atualizarRegra = mutation({
  args: {
    regraId: v.id("regras"),
    areaId: v.id("areas"),
    nome: v.string(),
    tipo: tipoRegraValidator,
    padrao: v.string(),
    risco: riscoValidator,
    ativo: v.boolean(),
  },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const regra = await ctx.db.get(args.regraId);
    if (!regra) throw new ConvexError("Regra não encontrada.");
    const area = await ctx.db.get(args.areaId);
    if (!area) throw new ConvexError("Selecione uma área válida.");
    const { nome, padrao } = validarRegra(args);
    await ctx.db.patch(args.regraId, {
      areaId: args.areaId,
      nome,
      tipo: args.tipo,
      padrao,
      risco: args.risco,
      ativo: args.ativo,
    });
    return { ok: true };
  },
});

export const alternarRegra = mutation({
  args: { regraId: v.id("regras"), ativo: v.boolean() },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    await ctx.db.patch(args.regraId, { ativo: args.ativo });
    return { ok: true };
  },
});

export const removerRegra = mutation({
  args: { regraId: v.id("regras") },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    await ctx.db.delete(args.regraId);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Mensagens educativas
// ---------------------------------------------------------------------------

export const listarMensagens = query({
  args: {},
  handler: async (ctx) => {
    const mensagens = await ctx.db.query("mensagens").collect();
    return (["baixo", "medio", "alto"] as const).map((nivel) => {
      const encontrada = mensagens.find((mensagem) => mensagem.nivel === nivel);
      return {
        nivel,
        texto: encontrada?.texto ?? MENSAGENS_PADRAO[nivel],
      };
    });
  },
});

export const atualizarMensagem = mutation({
  args: { nivel: riscoValidator, texto: v.string() },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const texto = textoObrigatorio(args.texto, "Mensagem", 600);
    const existente = await ctx.db
      .query("mensagens")
      .withIndex("por_nivel", (q) => q.eq("nivel", args.nivel))
      .first();
    if (existente) {
      await ctx.db.patch(existente._id, { texto });
    } else {
      await ctx.db.insert("mensagens", { nivel: args.nivel, texto });
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------

export const obterConfiguracoes = query({
  args: {},
  handler: async (ctx) => {
    await exigirSessao(ctx);
    const registros = await ctx.db.query("configuracoes").collect();
    const limiar = registros.find((registro) => registro.chave === "limiarGargalo");
    return {
      limiarGargalo: limiar ? Number(limiar.valor) : 30,
    };
  },
});

export const salvarConfiguracoes = mutation({
  args: { limiarGargalo: v.number() },
  handler: async (ctx, args) => {
    await exigirSessao(ctx);
    const limiar = Math.trunc(args.limiarGargalo);
    if (!Number.isFinite(limiar) || limiar < 0 || limiar > 100) {
      throw new ConvexError("O limiar deve ficar entre 0 e 100%.");
    }
    const existente = await ctx.db
      .query("configuracoes")
      .withIndex("por_chave", (q) => q.eq("chave", "limiarGargalo"))
      .first();
    if (existente) {
      await ctx.db.patch(existente._id, { valor: String(limiar) });
    } else {
      await ctx.db.insert("configuracoes", { chave: "limiarGargalo", valor: String(limiar) });
    }
    return { limiarGargalo: limiar };
  },
});

/** Últimos alertas brutos — usado pela landing como prova social discreta. */
export const amostraPublica = query({
  args: {},
  handler: async (ctx) => {
    const alertas = await ctx.db
      .query("alertas")
      .withIndex("por_data")
      .order("desc")
      .take(3);
    return alertas.map((alerta) => ({
      departamento: alerta.departamento,
      nivelRisco: alerta.nivelRisco,
      acao: alerta.acao,
    }));
  },
});

/** Nomes de departamentos usados nos filtros (derivados das áreas). */
export const departamentos = query({
  args: {},
  handler: async (ctx) => {
    const areas = await ctx.db.query("areas").collect();
    return areas.map((area) => area.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));
  },
});

// Mantém os tipos importados em uso explícito para evitar avisos de lint.
export type AlertaDoc = Doc<"alertas">;
export type AreaId = Id<"areas">;
