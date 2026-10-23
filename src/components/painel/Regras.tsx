import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { CabecalhoSecao, ConfirmarAcao, EstadoVazio, RiscoBadge } from "./comum";
import { RISCOS, ROTULO_RISCO, type Risco, type TipoRegra } from "@/lib/dados";
import { aplicarRegra, type RegraEntrada } from "@/lib/detectores";
import { cn } from "@/lib/utils";

interface FormularioRegra {
  areaId: string;
  nome: string;
  tipo: TipoRegra;
  padrao: string;
  risco: Risco;
  ativo: boolean;
}

const FORMULARIO_VAZIO: FormularioRegra = {
  areaId: "",
  nome: "",
  tipo: "palavra-chave",
  padrao: "",
  risco: "medio",
  ativo: true,
};

export function Regras() {
  const regras = useQuery(api.painel.listarRegras);
  const areas = useQuery(api.painel.listarAreas);
  const criarRegra = useMutation(api.painel.criarRegra);
  const atualizarRegra = useMutation(api.painel.atualizarRegra);
  const alternarRegra = useMutation(api.painel.alternarRegra);
  const removerRegra = useMutation(api.painel.removerRegra);

  const [busca, setBusca] = useState("");
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<Id<"regras"> | null>(null);
  const [formulario, setFormulario] = useState<FormularioRegra>(FORMULARIO_VAZIO);
  const [amostra, setAmostra] = useState("");
  const [resultadoTeste, setResultadoTeste] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const filtradas = useMemo(() => {
    if (!regras) return [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return regras;
    return regras.filter((regra) =>
      [regra.nome, regra.area, regra.padrao, regra.tipo, ROTULO_RISCO[regra.risco]]
        .join(" ")
        .toLowerCase()
        .includes(termo),
    );
  }, [regras, busca]);

  function abrirNova() {
    setEditandoId(null);
    setFormulario({
      ...FORMULARIO_VAZIO,
      areaId: areas?.[0]?._id ?? "",
    });
    setAmostra("");
    setResultadoTeste(null);
    setDialogoAberto(true);
  }

  function abrirEdicao(regra: NonNullable<typeof regras>[number]) {
    setEditandoId(regra._id);
    setFormulario({
      areaId: regra.areaId,
      nome: regra.nome,
      tipo: regra.tipo,
      padrao: regra.padrao,
      risco: regra.risco,
      ativo: regra.ativo,
    });
    setAmostra("");
    setResultadoTeste(null);
    setDialogoAberto(true);
  }

  function testarPadrao() {
    if (!formulario.padrao.trim()) {
      setResultadoTeste("Informe um padrão antes de testar.");
      return;
    }
    if (formulario.tipo === "regex") {
      try {
        new RegExp(formulario.padrao, "gi");
      } catch (erro) {
        setResultadoTeste(
          `Expressão inválida: ${erro instanceof Error ? erro.message : "verifique a sintaxe"}`,
        );
        return;
      }
    }
    const regra: RegraEntrada = {
      nome: formulario.nome || "Regra em teste",
      area: areas?.find((area) => area._id === formulario.areaId)?.nome ?? "—",
      tipo: formulario.tipo,
      padrao: formulario.padrao,
      risco: formulario.risco,
      ativo: true,
    };
    const deteccao = aplicarRegra(regra, amostra);
    setResultadoTeste(
      deteccao
        ? `${deteccao.ocorrencias} correspondência(s) encontrada(s) no texto de exemplo.`
        : "Nenhuma correspondência no texto de exemplo.",
    );
  }

  async function salvar() {
    if (!formulario.areaId) {
      toast.error("Selecione uma área.");
      return;
    }
    if (!formulario.nome.trim() || !formulario.padrao.trim()) {
      toast.error("Nome e padrão são obrigatórios.");
      return;
    }
    setSalvando(true);
    try {
      const dados = {
        areaId: formulario.areaId as Id<"areas">,
        nome: formulario.nome,
        tipo: formulario.tipo,
        padrao: formulario.padrao,
        risco: formulario.risco,
        ativo: formulario.ativo,
      };
      if (editandoId) {
        await atualizarRegra({ regraId: editandoId, ...dados });
        toast.success("Regra atualizada.");
      } else {
        await criarRegra(dados);
        toast.success("Regra criada.");
      }
      setDialogoAberto(false);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a regra.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(regraId: Id<"regras">, ativo: boolean) {
    try {
      await alternarRegra({ regraId, ativo });
      toast.success(ativo ? "Regra ativada." : "Regra desativada.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível alterar a regra.");
    }
  }

  async function excluir(regraId: Id<"regras">) {
    try {
      await removerRegra({ regraId });
      toast.success("Regra removida.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível remover a regra.");
    }
  }

  if (!regras || !areas) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoSecao
        numero="02 · Regras"
        titulo="Detectores editáveis"
        descricao="Cada regra pertence a uma área e carrega um nível de risco. A extensão baixa esta lista a cada cinco minutos e aplica tudo localmente, no navegador."
        acoes={
          <Button className="rounded-sm" onClick={abrirNova}>
            <Plus className="size-4" /> Nova regra
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar por nome, área ou padrão…"
            className="rounded-sm"
            aria-label="Buscar regras"
          />
        </div>
        <p className="rotulo">
          {filtradas.length} de {regras.length} regras ·{" "}
          {regras.filter((regra) => regra.ativo).length} ativas
        </p>
      </div>

      {filtradas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma regra encontrada"
          descricao="Ajuste a busca ou crie uma regra para uma área existente."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="rotulo py-2 pr-4 font-normal">Regra</th>
                <th className="rotulo py-2 pr-3 font-normal">Área</th>
                <th className="rotulo py-2 pr-3 font-normal">Tipo</th>
                <th className="rotulo py-2 pr-3 font-normal">Risco</th>
                <th className="rotulo py-2 pr-3 font-normal">Ativa</th>
                <th className="rotulo py-2 text-right font-normal">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((regra) => (
                <tr key={regra._id} className="border-b border-border/60 last:border-b-0">
                  <td className="max-w-[22rem] py-3 pr-4">
                    <span className="block text-xs font-medium">{regra.nome}</span>
                    <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {regra.padrao}
                    </code>
                  </td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">{regra.area}</td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {regra.tipo === "regex" ? "Regex" : "Palavra-chave"}
                  </td>
                  <td className="py-3 pr-3">
                    <RiscoBadge risco={regra.risco} />
                  </td>
                  <td className="py-3 pr-3">
                    <Switch
                      checked={regra.ativo}
                      onCheckedChange={(valor) => alternar(regra._id, valor)}
                      aria-label={`Ativar regra ${regra.nome}`}
                    />
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-sm"
                        onClick={() => abrirEdicao(regra)}
                        aria-label={`Editar regra ${regra.nome}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <ConfirmarAcao
                        titulo="Excluir regra?"
                        descricao={`A regra "${regra.nome}" será removida da configuração baixada pela extensão. Esta ação não pode ser desfeita.`}
                        onConfirmar={() => excluir(regra._id)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-sm text-muted-foreground hover:text-destructive"
                          aria-label={`Excluir regra ${regra.nome}`}
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
      )}

      <div className="border-t border-border pt-5">
        <p className="rotulo mb-2">Detectores técnicos sempre ativos</p>
        <p className="max-w-3xl text-xs leading-6 text-muted-foreground">
          CPF e CNPJ com validação de dígitos verificadores · IPv4 de faixas privadas e hostnames
          internos · tokens e chaves de API · senhas e credenciais · dados bancários · cartões com
          validação de Luhn · heurística de código-fonte. Esses detectores não dependem do banco e
          funcionam mesmo offline.
        </p>
      </div>

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto shadow-none sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
              {editandoId ? "Editar regra" : "Nova regra"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Regras de palavra-chave aceitam vários termos separados por vírgula. Regras de
              regex são aplicadas sem diferenciar maiúsculas de minúsculas.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Nome</span>
              <Input
                value={formulario.nome}
                onChange={(evento) =>
                  setFormulario((atual) => ({ ...atual, nome: evento.target.value }))
                }
                placeholder="Ex.: Dados bancários"
                className="rounded-sm"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="rotulo">Área</span>
                <Select
                  value={formulario.areaId}
                  onValueChange={(valor) =>
                    setFormulario((atual) => ({ ...atual, areaId: valor }))
                  }
                >
                  <SelectTrigger className="w-full rounded-sm">
                    <SelectValue placeholder="Selecione a área" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => (
                      <SelectItem key={area._id} value={area._id}>
                        {area.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="rotulo">Tipo</span>
                <Select
                  value={formulario.tipo}
                  onValueChange={(valor) =>
                    setFormulario((atual) => ({ ...atual, tipo: valor as TipoRegra }))
                  }
                >
                  <SelectTrigger className="w-full rounded-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="palavra-chave">Palavra-chave</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Padrão</span>
              <Textarea
                value={formulario.padrao}
                onChange={(evento) =>
                  setFormulario((atual) => ({ ...atual, padrao: evento.target.value }))
                }
                placeholder={
                  formulario.tipo === "regex"
                    ? "Ex.: \\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b"
                    : "Ex.: salário, remuneração, holerite"
                }
                className="min-h-20 rounded-sm font-mono text-xs"
                spellCheck={false}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="rotulo">Risco</span>
                <Select
                  value={formulario.risco}
                  onValueChange={(valor) =>
                    setFormulario((atual) => ({ ...atual, risco: valor as Risco }))
                  }
                >
                  <SelectTrigger className="w-full rounded-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISCOS.map((risco) => (
                      <SelectItem key={risco} value={risco}>
                        {ROTULO_RISCO[risco]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex items-center justify-between gap-3 border border-border px-3 py-2 sm:mt-5">
                <span className="text-xs">Regra ativa</span>
                <Switch
                  checked={formulario.ativo}
                  onCheckedChange={(valor) =>
                    setFormulario((atual) => ({ ...atual, ativo: valor }))
                  }
                />
              </label>
            </div>

            <div className="border-t border-border pt-4">
              <p className="rotulo mb-2">Testar contra um texto</p>
              <Textarea
                value={amostra}
                onChange={(evento) => setAmostra(evento.target.value)}
                placeholder="Digite ou cole um texto de exemplo para validar o padrão antes de salvar."
                className="min-h-20 rounded-sm text-xs"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-sm"
                  onClick={testarPadrao}
                >
                  Testar regra
                </Button>
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    resultadoTeste?.includes("Nenhuma") && "text-risco-medio",
                  )}
                  role="status"
                >
                  {resultadoTeste}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              className="rounded-sm"
              onClick={() => setDialogoAberto(false)}
            >
              Cancelar
            </Button>
            <Button className="rounded-sm" onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 className="size-4 animate-spin" /> : "Salvar regra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
