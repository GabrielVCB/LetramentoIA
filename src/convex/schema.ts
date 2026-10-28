import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/** Níveis de risco usados em regras, alertas e itens. */
export const riscoValidator = v.union(
  v.literal("baixo"),
  v.literal("medio"),
  v.literal("alto"),
);

/** Tipo de correspondência de uma regra editável. */
export const tipoRegraValidator = v.union(
  v.literal("regex"),
  v.literal("palavra-chave"),
);

/** Ação registrada quando o colaborador envia ou cancela a mensagem. */
export const acaoValidator = v.union(v.literal("enviou"), v.literal("cancelou"));

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    /** Áreas da empresa que classificam os dados (RH, Financeiro, TI...). */
    areas: defineTable({
      nome: v.string(),
      descricao: v.optional(v.string()),
    }).index("por_nome", ["nome"]),

    /** Regras editáveis baixadas pela extensão. */
    regras: defineTable({
      areaId: v.id("areas"),
      nome: v.string(),
      tipo: tipoRegraValidator,
      padrao: v.string(),
      risco: riscoValidator,
      ativo: v.boolean(),
    }).index("por_area", ["areaId"]),

    /** Mensagens educativas por nível de risco. */
    mensagens: defineTable({
      nivel: riscoValidator,
      texto: v.string(),
    }).index("por_nivel", ["nivel"]),

    /** Alerta registrado pela extensão. Nunca contém o texto digitado. */
    alertas: defineTable({
      dataHora: v.number(),
      site: v.string(),
      departamento: v.string(),
      colaborador: v.optional(v.string()),
      nivelRisco: riscoValidator,
      acao: acaoValidator,
      demo: v.optional(v.boolean()),
    })
      .index("por_data", ["dataHora"])
      .index("por_departamento", ["departamento"])
      .index("por_nivel", ["nivelRisco"]),

    /** Tipos detectados em cada alerta (metadados, nunca o conteúdo). */
    alertaItens: defineTable({
      alertaId: v.id("alertas"),
      tipoDetectado: v.string(),
      risco: riscoValidator,
      area: v.optional(v.string()),
    }).index("por_alerta", ["alertaId"]),

    /** Configurações do painel (limiar de gargalo, controle de seed). */
    configuracoes: defineTable({
      chave: v.string(),
      valor: v.string(),
    }).index("por_chave", ["chave"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
