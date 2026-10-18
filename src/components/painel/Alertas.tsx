import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Download, Eye, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CabecalhoSecao,
  CampoResumo,
  ConfirmarAcao,
  EstadoVazio,
  RiscoBadge,
} from "./comum";
import {
  CLASSES_RISCO,
  RISCOS,
  ROTULO_RISCO,
  formatarDataHora,
  type Risco,
} from "@/lib/dados";
import { cn } from "@/lib/utils";

const POR_PAGINA = 12;

function inicioDoDia(valor: string) {
  const [ano, mes, dia] = valor.split("-").map(Number);
  return new Date(ano, mes - 1, dia, 0, 0, 0, 0).getTime();
}

function fimDoDia(valor: string) {
  const [ano, mes, dia] = valor.split("-").map(Number);
  return new Date(ano, mes - 1, dia, 23, 59, 59, 999).getTime();
}

export function Alertas() {
  const departamentos = useQuery(api.painel.departamentos);
  const removerAlerta = useMutation(api.painel.removerAlerta);
  const limparPorIdade = useMutation(api.painel.limparPorIdade);
  const limparTudo = useMutation(api.painel.limparTudo);

  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [departamento, setDepartamento] = useState("todos");
  const [nivel, setNivel] = useState("todos");
  const [pagina, setPagina] = useState(1);
  const [detalheId, setDetalheId] = useState<Id<"alertas"> | null>(null);
  const [limpezaAberta, setLimpezaAberta] = useState(false);
  const [dias, setDias] = useState(30);
  const [processando, setProcessando] = useState(false);

  const filtros = useMemo(
    () => ({
      de: de ? inicioDoDia(de) : undefined,
      ate: ate ? fimDoDia(ate) : undefined,
      departamento: departamento !== "todos" ? departamento : undefined,
      nivel: nivel !== "todos" ? (nivel as Risco) : undefined,
    }),
    [de, ate, departamento, nivel],
  );

  const listagem = useQuery(api.painel.listarAlertas, {
    ...filtros,
    pagina,
    porPagina: POR_PAGINA,
  });
  const paraExportar = useQuery(api.painel.alertasParaExportar, filtros);
  const detalhe = useQuery(
    api.painel.detalheAlerta,
    detalheId ? { alertaId: detalheId } : "skip",
  );

  function alterarFiltro(acao: () => void) {
    acao();
    setPagina(1);
  }

  function limparFiltros() {
    setDe("");
    setAte("");
    setDepartamento("todos");
    setNivel("todos");
    setPagina(1);
  }

  function exportarCsv() {
    if (!paraExportar || paraExportar.length === 0) {
      toast.error("Não há alertas para exportar com estes filtros.");
      return;
    }
    const cabecalho = ["Data/hora", "Site", "Departamento", "Colaborador", "Nível", "Ação", "Tipos"];
    const linhas = paraExportar.map((alerta) => [
      new Date(alerta.dataHora).toLocaleString("pt-BR"),
      alerta.site,
      alerta.departamento,
      alerta.colaborador || "anônimo",
      ROTULO_RISCO[alerta.nivelRisco],
      alerta.acao === "enviou" ? "Enviou mesmo assim" : "Cancelou",
      alerta.tipos,
    ]);
    const csv = [cabecalho, ...linhas]
      .map((linha) =>
        linha
          .map((campo) => `"${String(campo).replace(/"/g, '""')}"`)
          .join(";"),
      )
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `alertas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${paraExportar.length} alerta(s) exportado(s).`);
  }

  async function excluir(id: Id<"alertas">) {
    try {
      await removerAlerta({ alertaId: id });
      toast.success("Alerta removido da auditoria.");
      if (detalheId === id) setDetalheId(null);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível remover o alerta.");
    }
  }

  async function executarLimpezaPorIdade() {
    setProcessando(true);
    try {
      const resultado = await limparPorIdade({ dias });
      toast.success(
        resultado.removidos === 0
          ? "Nenhum alerta mais antigo que o período informado."
          : `${resultado.removidos} alerta(s) removido(s).`,
      );
      setLimpezaAberta(false);
      setPagina(1);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha na limpeza por idade.");
    } finally {
      setProcessando(false);
    }
  }

  async function executarLimpezaTotal() {
    try {
      const resultado = await limparTudo();
      toast.success(`${resultado.removidos} alerta(s) removido(s) definitivamente.`);
      setPagina(1);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao limpar a base.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoSecao
        numero="05 · Alertas"
        titulo="Auditoria de envios"
        descricao="Somente metadados: quem digitou (ou anônimo), onde, qual risco, quais tipos e se enviou ou cancelou. O conteúdo da conversa não existe neste banco."
        acoes={
          <>
            <Button variant="outline" className="rounded-sm" onClick={exportarCsv}>
              <Download className="size-4" /> Exportar CSV
            </Button>
            <Button
              variant="outline"
              className="rounded-sm"
              onClick={() => setLimpezaAberta(true)}
            >
              Limpar por idade
            </Button>
            <ConfirmarAcao
              titulo="Limpar todos os alertas?"
              descricao="Toda a base de auditoria será apagada, inclusive a amostra de demonstração. Os itens detectados também são removidos em cascata. Esta ação não pode ser desfeita."
              rotuloConfirmar="Limpar tudo"
              onConfirmar={executarLimpezaTotal}
            >
              <Button
                variant="ghost"
                className="rounded-sm text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" /> Limpar tudo
              </Button>
            </ConfirmarAcao>
          </>
        }
      />

      <section
        aria-label="Filtros de auditoria"
        className="grid gap-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1fr_auto]"
      >
        <label className="flex flex-col gap-1.5">
          <span className="rotulo">De</span>
          <Input
            type="date"
            value={de}
            onChange={(evento) => alterarFiltro(() => setDe(evento.target.value))}
            className="rounded-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="rotulo">Até</span>
          <Input
            type="date"
            value={ate}
            onChange={(evento) => alterarFiltro(() => setAte(evento.target.value))}
            className="rounded-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="rotulo">Departamento</span>
          <Select
            value={departamento}
            onValueChange={(valor) => alterarFiltro(() => setDepartamento(valor))}
          >
            <SelectTrigger className="w-full rounded-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os departamentos</SelectItem>
              {(departamentos ?? []).map((nome) => (
                <SelectItem key={nome} value={nome}>
                  {nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="rotulo">Nível</span>
          <Select value={nivel} onValueChange={(valor) => alterarFiltro(() => setNivel(valor))}>
            <SelectTrigger className="w-full rounded-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os níveis</SelectItem>
              {RISCOS.map((risco) => (
                <SelectItem key={risco} value={risco}>
                  {ROTULO_RISCO[risco]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-end">
          <Button variant="ghost" className="rounded-sm" onClick={limparFiltros}>
            <X className="size-4" /> Limpar
          </Button>
        </div>
      </section>

      {!listagem ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : listagem.registros.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum alerta com estes filtros"
          descricao="Ajuste o período, o departamento ou o nível para ampliar a busca."
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-4">
            <p className="rotulo">
              {listagem.total} alerta(s) · página {listagem.pagina} de {listagem.totalPaginas}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {paraExportar ? `${paraExportar.length} disponíveis para exportação` : "—"}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="rotulo py-2 pr-4 font-normal">Data/hora</th>
                  <th className="rotulo py-2 pr-3 font-normal">Departamento</th>
                  <th className="rotulo py-2 pr-3 font-normal">Colaborador</th>
                  <th className="rotulo py-2 pr-3 font-normal">Site</th>
                  <th className="rotulo py-2 pr-3 font-normal">Nível</th>
                  <th className="rotulo py-2 pr-3 font-normal">Ação</th>
                  <th className="rotulo py-2 pr-3 font-normal">Tipos</th>
                  <th className="rotulo py-2 text-right font-normal">Ações</th>
                </tr>
              </thead>
              <tbody>
                {listagem.registros.map((alerta) => (
                  <tr key={alerta._id} className="border-b border-border/60 last:border-b-0">
                    <td className="tabular py-3 pr-4 text-[11px] text-muted-foreground">
                      {formatarDataHora(alerta.dataHora)}
                    </td>
                    <td className="py-3 pr-3 text-xs font-medium">
                      {alerta.departamento}
                      {alerta.demo && <span className="rotulo ml-2">amostra</span>}
                    </td>
                    <td className="py-3 pr-3 text-xs text-muted-foreground">
                      {alerta.colaborador || "anônimo"}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] text-muted-foreground">
                      {alerta.site}
                    </td>
                    <td className="py-3 pr-3">
                      <RiscoBadge risco={alerta.nivelRisco} />
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          "text-[11px]",
                          alerta.acao === "enviou" && alerta.nivelRisco === "alto"
                            ? "font-medium text-risco-alto"
                            : "text-muted-foreground",
                        )}
                      >
                        {alerta.acao === "enviou" ? "Enviou mesmo assim" : "Cancelou"}
                      </span>
                    </td>
                    <td className="max-w-[15rem] truncate py-3 pr-3 text-[11px] text-muted-foreground">
                      {alerta.itens.map((item) => item.tipoDetectado).join(" · ") || "—"}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-sm"
                          onClick={() => setDetalheId(alerta._id)}
                          aria-label="Ver detalhe do alerta"
                        >
                          <Eye className="size-3.5" />
                        </Button>
                        <ConfirmarAcao
                          titulo="Excluir alerta?"
                          descricao="O registro e seus tipos detectados serão removidos da auditoria. Esta ação não pode ser desfeita."
                          onConfirmar={() => excluir(alerta._id)}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-sm text-muted-foreground hover:text-destructive"
                            aria-label="Excluir alerta"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </ConfirmarAcao>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-sm"
              disabled={listagem.pagina <= 1}
              onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
            >
              Anterior
            </Button>
            <p className="tabular text-xs text-muted-foreground">
              {listagem.pagina} / {listagem.totalPaginas}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-sm"
              disabled={listagem.pagina >= listagem.totalPaginas}
              onClick={() => setPagina((atual) => atual + 1)}
            >
              Próxima
            </Button>
          </div>
        </>
      )}

      <Dialog open={detalheId !== null} onOpenChange={(aberto) => !aberto && setDetalheId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto shadow-none sm:max-w-lg">
          <DialogHeader>
            <p className="rotulo">Detalhe do alerta</p>
            <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
              {detalhe ? `${detalhe.departamento} · ${detalhe.site}` : "Carregando…"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {detalhe ? formatarDataHora(detalhe.dataHora) : ""}
            </DialogDescription>
          </DialogHeader>

          {!detalhe ? (
            <div className="flex min-h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-x-6 sm:grid-cols-2">
                <CampoResumo rotulo="Nível de risco">
                  <RiscoBadge risco={detalhe.nivelRisco} />
                </CampoResumo>
                <CampoResumo rotulo="Ação registrada">
                  {detalhe.acao === "enviou" ? "Enviou mesmo assim" : "Cancelou e revisou"}
                </CampoResumo>
                <CampoResumo rotulo="Colaborador">
                  {detalhe.colaborador || "anônimo"}
                </CampoResumo>
                <CampoResumo rotulo="Origem">
                  {detalhe.demo ? "Amostra de demonstração" : "Extensão"}
                </CampoResumo>
              </div>

              <div>
                <p className="rotulo mb-2">Tipos detectados</p>
                <ul className="border-t border-border">
                  {detalhe.itens.map((item, indice) => (
                    <li
                      key={`${item.tipoDetectado}-${indice}`}
                      className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{item.tipoDetectado}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {item.area ?? "—"}
                        </span>
                      </span>
                      <RiscoBadge risco={item.risco} />
                    </li>
                  ))}
                  {detalhe.itens.length === 0 && (
                    <li className="py-3 text-xs text-muted-foreground">
                      Nenhum tipo registrado (alerta de risco baixo).
                    </li>
                  )}
                </ul>
              </div>

              <p className="border-l-2 border-border pl-3 text-[11px] leading-5 text-muted-foreground">
                O texto da mensagem nunca foi enviado ao servidor nem armazenado. Este registro
                contém apenas os metadados exibidos acima.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              className="rounded-sm"
              onClick={() => setDetalheId(null)}
            >
              Fechar
            </Button>
            {detalhe && (
              <ConfirmarAcao
                titulo="Excluir alerta?"
                descricao="O registro e seus tipos detectados serão removidos da auditoria."
                onConfirmar={() => excluir(detalhe._id)}
              >
                <Button variant="destructive" className="rounded-sm">
                  <Trash2 className="size-4" /> Excluir
                </Button>
              </ConfirmarAcao>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={limpezaAberta} onOpenChange={setLimpezaAberta}>
        <DialogContent className="shadow-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
              Limpeza por idade
            </DialogTitle>
            <DialogDescription className="text-sm leading-6">
              Remove definitivamente os alertas mais antigos que o período informado. Útil para
              aplicar a política de retenção da empresa.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5">
            <span className="rotulo">Manter os últimos (dias)</span>
            <Input
              type="number"
              min={1}
              max={3650}
              value={dias}
              onChange={(evento) => setDias(Number(evento.target.value))}
              className="tabular w-32 rounded-sm"
            />
          </label>
          <p className="text-[11px] leading-5 text-muted-foreground">
            Serão removidos os alertas com data anterior a hoje menos {dias} dia(s). Esta ação
            não pode ser desfeita.
          </p>
          <DialogFooter className="border-t border-border pt-4">
            <Button
              variant="outline"
              className="rounded-sm"
              onClick={() => setLimpezaAberta(false)}
            >
              Cancelar
            </Button>
            <Button
              className="rounded-sm"
              onClick={executarLimpezaPorIdade}
              disabled={processando}
            >
              {processando ? <Loader2 className="size-4 animate-spin" /> : "Executar limpeza"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
