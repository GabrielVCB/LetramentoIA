import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BannerRisco, ModalRisco } from "./BannerRisco";
import { CabecalhoSecao, CampoResumo, EstadoVazio, RiscoBadge } from "./comum";
import { useAnaliseComDebounce } from "@/hooks/use-analise";
import {
  MENSAGENS_PADRAO,
  SITES_MONITORADOS,
  formatarDataHora,
  ROTULO_RISCO,
} from "@/lib/dados";
import type { RegraEntrada } from "@/lib/detectores";
import { cn } from "@/lib/utils";

const EXEMPLOS = [
  {
    rotulo: "RH · alto",
    texto:
      "O salário da Ana é R$ 8.500 e o CPF dela é 529.982.247-25. Preciso calcular a rescisão dela até sexta.",
  },
  {
    rotulo: "TI · token",
    texto:
      "Erro na integração do serviço: a api_key = sk-proj-8fJ2kLm9Qr4Tz7Xb1Nc6Vd3 e o servidor interno é 10.20.30.41.",
  },
  {
    rotulo: "Financeiro · médio",
    texto:
      "O orçamento interno aprovado foi R$ 240.000 para o trimestre; preciso revisar o cronograma com o time.",
  },
  {
    rotulo: "Jurídico · alto",
    texto:
      "A cláusula 7 do contrato do fornecedor permite reajuste anual. O valor do contrato é R$ 1.200.000.",
  },
  {
    rotulo: "Sem risco",
    texto: "Pode me ajudar a escrever um e-mail de boas-vindas para a equipe?",
  },
];

export function Laboratorio() {
  const config = useQuery(api.painel.config);
  const areas = useQuery(api.painel.listarAreas);
  const recentes = useQuery(api.painel.listarAlertas, { pagina: 1, porPagina: 5 });
  const criarAlerta = useMutation(api.painel.criarAlerta);

  const [texto, setTexto] = useState(EXEMPLOS[0]!.texto);
  const [site, setSite] = useState<string>(SITES_MONITORADOS[0]);
  const [departamento, setDepartamento] = useState("");
  const [colaborador, setColaborador] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [registrando, setRegistrando] = useState(false);

  const regras = useMemo<RegraEntrada[]>(() => config?.regras ?? [], [config]);
  const mensagens = config?.mensagens;
  const { analise, analisando, reanalisar } = useAnaliseComDebounce(texto, regras);

  const departamentoEfetivo = departamento || areas?.[0]?.nome || "";
  const mensagemAtual = mensagens?.[analise.nivel] ?? MENSAGENS_PADRAO[analise.nivel];

  async function registrar(
    acao: "enviou" | "cancelou",
    analiseParaRegistrar = analise,
  ) {
    if (!departamentoEfetivo) {
      toast.error("Cadastre uma área antes de simular um envio.");
      return;
    }
    setRegistrando(true);
    try {
      await criarAlerta({
        site,
        departamento: departamentoEfetivo,
        colaborador: colaborador.trim() || undefined,
        nivelRisco: analiseParaRegistrar.nivel,
        acao,
        dataHora: Date.now(),
        itens: analiseParaRegistrar.deteccoes.map((deteccao) => ({
          tipoDetectado: deteccao.tipo,
          risco: deteccao.risco,
          area: deteccao.area,
        })),
      });
      if (acao === "enviou") {
        toast.success("Alerta registrado como envio. O texto não foi armazenado.");
        setTexto("");
      } else {
        toast.success("Alerta registrado como cancelamento. Revise a mensagem à vontade.");
      }
      setModalAberto(false);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível registrar o alerta.");
    } finally {
      setRegistrando(false);
    }
  }

  function tentarEnviar() {
    if (!texto.trim()) {
      toast.error("Digite uma mensagem para simular o envio.");
      return;
    }
    const atual = reanalisar();
    if (atual.nivel === "alto" || atual.nivel === "medio") {
      setModalAberto(true);
      return;
    }
    if (atual.deteccoes.length > 0) {
      void registrar("enviou", atual);
      return;
    }
    toast("Nenhum dado sensível identificado. Nada foi registrado.", {
      description: "A extensão só cria alerta quando há detecção de risco.",
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoSecao
        numero="06 · Laboratório"
        titulo="Simulador de navegador"
        descricao="Digite como se estivesse em uma IA pública. A análise acontece no navegador, com as mesmas regras da extensão — inclusive as que você acabou de editar. O envio grava o alerta neste painel."
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Site monitorado</span>
              <Select value={site} onValueChange={setSite}>
                <SelectTrigger className="w-full rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITES_MONITORADOS.map((nome) => (
                    <SelectItem key={nome} value={nome}>
                      {nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Departamento</span>
              <Select value={departamentoEfetivo} onValueChange={setDepartamento}>
                <SelectTrigger className="w-full rounded-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(areas ?? []).map((area) => (
                    <SelectItem key={area._id} value={area.nome}>
                      {area.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Colaborador (opcional)</span>
              <Input
                value={colaborador}
                onChange={(evento) => setColaborador(evento.target.value)}
                placeholder="anonimo"
                className="rounded-sm"
                maxLength={80}
              />
            </label>
          </div>

          <div className="border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-risco-baixo" aria-hidden />
                {site}
              </span>
              <span className="rotulo">prévia do aviso · shadow dom</span>
            </div>

            <Textarea
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
                  evento.preventDefault();
                  tentarEnviar();
                }
              }}
              placeholder="Digite a mensagem que você enviaria para a IA…"
              className="min-h-40 resize-y rounded-none border-0 bg-transparent px-4 py-4 text-sm leading-6 shadow-none focus-visible:ring-0"
              aria-label="Mensagem para a IA"
            />

            <div className="border-t border-border p-3">
              <BannerRisco
                nivel={analise.nivel}
                deteccoes={analise.deteccoes}
                mensagem={mensagemAtual}
                analisando={analisando}
                className="border-0 bg-muted/40"
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                Enter envia · Shift+Enter quebra linha ·{" "}
                <span className="tabular">{texto.length}</span> caracteres
              </p>
              <Button className="rounded-sm" onClick={tentarEnviar} disabled={registrando}>
                {registrando ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Enviar mensagem
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="rotulo">Frases de teste</p>
            <div className="flex flex-wrap gap-2">
              {EXEMPLOS.map((exemplo) => (
                <button
                  key={exemplo.rotulo}
                  type="button"
                  onClick={() => setTexto(exemplo.texto)}
                  className={cn(
                    "border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors",
                    "hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {exemplo.rotulo}
                </button>
              ))}
            </div>
          </div>

          <p className="border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
            Nesta demonstração o alerta vai para o banco do painel. Na extensão, o service worker
            envia ao servidor Flask com o header <code className="font-mono">X-API-Token</code> e
            mantém uma fila local quando o servidor está indisponível.
          </p>
        </div>

        <div className="flex flex-col gap-8">
          <section className="border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <span className="rotulo">O que seria registrado</span>
              <RiscoBadge risco={analise.nivel} />
            </div>
            <div className="px-4 py-2">
              <CampoResumo rotulo="Data/hora">{formatarDataHora(Date.now())}</CampoResumo>
              <CampoResumo rotulo="Site">{site}</CampoResumo>
              <CampoResumo rotulo="Departamento">{departamentoEfetivo || "—"}</CampoResumo>
              <CampoResumo rotulo="Colaborador">
                {colaborador.trim() || "anônimo"}
              </CampoResumo>
              <CampoResumo rotulo="Nível">
                {ROTULO_RISCO[analise.nivel]} · {analise.deteccoes.length} tipo(s)
              </CampoResumo>
              <CampoResumo rotulo="Ação">definida no envio</CampoResumo>
            </div>
            <div className="border-t border-border px-4 py-3">
              <p className="rotulo mb-2">Tipos detectados</p>
              {analise.deteccoes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {analise.deteccoes.map((deteccao) => (
                    <li
                      key={`${deteccao.tipo}-${deteccao.area}`}
                      className="border border-border px-1.5 py-0.5 text-[11px]"
                    >
                      {deteccao.tipo}
                      <span className="text-muted-foreground"> · {deteccao.area}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="border-t border-border px-4 py-3 text-[11px] leading-5 text-muted-foreground">
              O texto da mensagem nunca entra neste objeto. É a garantia central do projeto.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-lg tracking-tight">Últimos registros</h2>
              <span className="rotulo">auditoria</span>
            </div>
            {!recentes ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : recentes.registros.length === 0 ? (
              <EstadoVazio
                titulo="Nada registrado"
                descricao="Envie a mensagem de exemplo para criar o primeiro alerta."
              />
            ) : (
              <ul>
                {recentes.registros.map((alerta) => (
                  <li
                    key={alerta._id}
                    className="flex flex-col gap-1 border-b border-border/60 py-2.5 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{alerta.departamento}</span>
                      <RiscoBadge risco={alerta.nivelRisco} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="tabular">{formatarDataHora(alerta.dataHora)}</span>
                      <span>{alerta.acao === "enviou" ? "enviou" : "cancelou"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ModalRisco
        aberto={modalAberto}
        nivel={analise.nivel}
        deteccoes={analise.deteccoes}
        mensagem={mensagemAtual}
        enviando={registrando}
        onOpenChange={setModalAberto}
        onCancelar={() => void registrar("cancelou")}
        onEnviar={() => void registrar("enviou")}
      />
    </div>
  );
}
