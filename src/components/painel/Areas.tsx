import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CabecalhoSecao, ConfirmarAcao, EstadoVazio } from "./comum";

export function Areas() {
  const areas = useQuery(api.painel.listarAreas);
  const criarArea = useMutation(api.painel.criarArea);
  const atualizarArea = useMutation(api.painel.atualizarArea);
  const removerArea = useMutation(api.painel.removerArea);

  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<Id<"areas"> | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);

  function abrirNova() {
    setEditandoId(null);
    setNome("");
    setDescricao("");
    setDialogoAberto(true);
  }

  function abrirEdicao(area: NonNullable<typeof areas>[number]) {
    setEditandoId(area._id);
    setNome(area.nome);
    setDescricao(area.descricao);
    setDialogoAberto(true);
  }

  async function salvar() {
    if (!nome.trim()) {
      toast.error("Informe o nome da área.");
      return;
    }
    setSalvando(true);
    try {
      if (editandoId) {
        await atualizarArea({ areaId: editandoId, nome, descricao });
        toast.success("Área atualizada.");
      } else {
        await criarArea({ nome, descricao });
        toast.success("Área criada.");
      }
      setDialogoAberto(false);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a área.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(areaId: Id<"areas">) {
    try {
      const resultado = await removerArea({ areaId });
      toast.success(
        `Área removida. ${resultado.regrasRemovidas} regra(s) vinculada(s) também foram excluídas.`,
      );
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível excluir a área.");
    }
  }

  if (!areas) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoSecao
        numero="03 · Áreas"
        titulo="Estrutura da matriz"
        descricao="As áreas organizam regras e alimentam os filtros do painel. O nome da área é registrado no alerta como departamento — o histórico é preservado mesmo após uma exclusão."
        acoes={
          <Button className="rounded-sm" onClick={abrirNova}>
            <Plus className="size-4" /> Nova área
          </Button>
        }
      />

      {areas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma área cadastrada"
          descricao="Crie a primeira área para poder vincular regras de detecção."
        />
      ) : (
        <ul className="border-t border-border">
          {areas.map((area, indice) => (
            <li
              key={area._id}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-4 border-b border-border py-5"
            >
              <span className="tabular pt-1 text-[10px] text-muted-foreground">
                {String(indice + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{area.nome}</p>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                  {area.descricao || "Sem descrição cadastrada."}
                </p>
                <p className="rotulo mt-2">
                  {area.totalRegras} regra(s) · {area.totalAtivas} ativa(s)
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-sm"
                  onClick={() => abrirEdicao(area)}
                  aria-label={`Editar área ${area.nome}`}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <ConfirmarAcao
                  titulo="Excluir área?"
                  descricao={`A área "${area.nome}" e suas ${area.totalRegras} regra(s) serão removidas. Os alertas já registrados com esse departamento permanecem na auditoria.`}
                  onConfirmar={() => excluir(area._id)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-sm text-muted-foreground hover:text-destructive"
                    aria-label={`Excluir área ${area.nome}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </ConfirmarAcao>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent className="shadow-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
              {editandoId ? "Editar área" : "Nova área"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Use nomes curtos, como aparecem na empresa. Eles viram o campo “departamento” dos
              alertas.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Nome</span>
              <Input
                value={nome}
                onChange={(evento) => setNome(evento.target.value)}
                placeholder="Ex.: Operações"
                className="rounded-sm"
                maxLength={60}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Descrição</span>
              <Textarea
                value={descricao}
                onChange={(evento) => setDescricao(evento.target.value)}
                placeholder="Que tipo de informação esta área protege?"
                className="min-h-20 rounded-sm text-xs"
                maxLength={240}
              />
            </label>
          </div>

          <DialogFooter className="border-t border-border pt-4">
            <Button
              variant="outline"
              className="rounded-sm"
              onClick={() => setDialogoAberto(false)}
            >
              Cancelar
            </Button>
            <Button className="rounded-sm" onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 className="size-4 animate-spin" /> : "Salvar área"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
