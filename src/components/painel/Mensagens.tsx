import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CabecalhoSecao, RiscoBadge } from "./comum";
import { CLASSES_RISCO, MENSAGENS_PADRAO, RISCOS, type Risco } from "@/lib/dados";
import { cn } from "@/lib/utils";

type Textos = Record<Risco, string>;

const VAZIO: Textos = { baixo: "", medio: "", alto: "" };

export function Mensagens() {
  const mensagens = useQuery(api.painel.listarMensagens);
  const atualizarMensagem = useMutation(api.painel.atualizarMensagem);
  const [textos, setTextos] = useState<Textos>(VAZIO);
  const [salvando, setSalvando] = useState<Risco | null>(null);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (!carregado && mensagens) {
      const proximo = { ...VAZIO };
      for (const mensagem of mensagens) proximo[mensagem.nivel] = mensagem.texto;
      setTextos(proximo);
      setCarregado(true);
    }
  }, [mensagens, carregado]);

  async function salvar(nivel: Risco) {
    if (!textos[nivel].trim()) {
      toast.error("A mensagem não pode ficar vazia.");
      return;
    }
    setSalvando(nivel);
    try {
      await atualizarMensagem({ nivel, texto: textos[nivel] });
      toast.success(`Mensagem de risco ${nivel} salva.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a mensagem.");
    } finally {
      setSalvando(null);
    }
  }

  if (!mensagens || !carregado) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoSecao
        numero="04 · Mensagens"
        titulo="Mensagens educativas"
        descricao="É o texto que aparece no aviso da extensão, imediatamente abaixo dos tipos detectados. A alteração chega aos navegadores na próxima sincronização (a cada cinco minutos)."
      />

      <div className="grid gap-8 lg:grid-cols-3">
        {RISCOS.map((risco) => {
          const cores = CLASSES_RISCO[risco];
          const alterada = textos[risco].trim() !== MENSAGENS_PADRAO[risco];
          return (
            <section key={risco} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <RiscoBadge risco={risco} />
                <span className="rotulo">{textos[risco].length}/600</span>
              </div>
              <Textarea
                value={textos[risco]}
                onChange={(evento) =>
                  setTextos((atual) => ({ ...atual, [risco]: evento.target.value }))
                }
                maxLength={600}
                className={cn("min-h-44 resize-y rounded-sm text-xs leading-5", cores.borda)}
                aria-label={`Mensagem educativa para risco ${risco}`}
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground disabled:opacity-40"
                  onClick={() => setTextos((atual) => ({ ...atual, [risco]: MENSAGENS_PADRAO[risco] }))}
                  disabled={!alterada}
                >
                  Restaurar padrão
                </button>
                <Button
                  size="sm"
                  className="rounded-sm"
                  onClick={() => salvar(risco)}
                  disabled={salvando === risco}
                >
                  {salvando === risco ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      <div className="border-t border-border pt-6">
        <p className="rotulo mb-2">Como aparece na extensão</p>
        <div className="max-w-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-[11px] font-medium tracking-[0.14em] text-risco-alto uppercase">
              Risco alto
            </span>
            <span className="rotulo">2 tipos</span>
          </div>
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="text-[11px] text-muted-foreground">
              Token ou chave de API · Código-fonte interno
            </p>
            <p className="text-xs leading-5 text-muted-foreground">{textos.alto}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
