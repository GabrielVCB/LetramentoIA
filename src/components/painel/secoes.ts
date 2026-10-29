export type SecaoId =
  | "visao"
  | "regras"
  | "areas"
  | "mensagens"
  | "alertas"
  | "laboratorio";

export interface Secao {
  id: SecaoId;
  numero: string;
  rotulo: string;
  descricao: string;
}

export const SECOES: Secao[] = [
  {
    id: "visao",
    numero: "01",
    rotulo: "Visão geral",
    descricao: "Indicadores, evolução e departamentos críticos.",
  },
  {
    id: "regras",
    numero: "02",
    rotulo: "Regras",
    descricao: "Detectores editáveis por área e nível de risco.",
  },
  {
    id: "areas",
    numero: "03",
    rotulo: "Áreas",
    descricao: "Estrutura da matriz de risco da empresa.",
  },
  {
    id: "mensagens",
    numero: "04",
    rotulo: "Mensagens",
    descricao: "Texto educativo exibido pela extensão.",
  },
  {
    id: "alertas",
    numero: "05",
    rotulo: "Alertas",
    descricao: "Auditoria, filtros, retenção e exportação.",
  },
  {
    id: "laboratorio",
    numero: "06",
    rotulo: "Laboratório",
    descricao: "Simule o aviso e o registro de um envio.",
  },
];

export function ehSecaoValida(valor: string | null): valor is SecaoId {
  return SECOES.some((secao) => secao.id === valor);
}
