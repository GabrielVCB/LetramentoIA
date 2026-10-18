import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CLASSES_RISCO, ROTULO_RISCO, type Risco } from "@/lib/dados";
import type { Deteccao } from "@/lib/detectores";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

/**
 * Reprodução fiel do painel que a extensão injeta via Shadow DOM.
 * Mostra apenas metadados (tipo, área e risco), nunca o texto digitado.
 */
export function BannerRisco({
  nivel,
  deteccoes,
  mensagem,
  analisando = false,
  className,
}: {
  nivel: Risco;
  deteccoes: Deteccao[];
  mensagem: string;
  analisando?: boolean;
  className?: string;
}) {
  const cores = CLASSES_RISCO[nivel];
  const semDeteccoes = deteccoes.length === 0;

  return (
    <section
      aria-live="polite"
      aria-label={`Aviso de risco ${ROTULO_RISCO[nivel]}`}
      className={cn(
        "relative overflow-hidden border bg-card",
        cores.borda,
        className,
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", cores.ponto)} aria-hidden />
      <div className="flex flex-col gap-3 py-4 pr-5 pl-5">
        <div className="flex items-center justify-between gap-3">
          <span className={cn("flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] uppercase", cores.texto)}>
            <ShieldAlert className="size-3.5" aria-hidden />
            Risco {ROTULO_RISCO[nivel]}
          </span>
          <span className="rotulo">
            {analisando ? "analisando…" : semDeteccoes ? "sem detecções" : `${deteccoes.length} tipo(s)`}
          </span>
        </div>

        {semDeteccoes ? (
          <p className="text-xs text-muted-foreground">
            Nenhum tipo de informação corporativa monitorada foi identificado.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {deteccoes.map((deteccao) => (
              <li
                key={`${deteccao.tipo}-${deteccao.area}`}
                className="inline-flex items-center gap-1.5 border border-border/80 bg-background/70 px-1.5 py-0.5 text-[11px] leading-4"
              >
                <span
                  className={cn("size-1 rounded-full", CLASSES_RISCO[deteccao.risco].ponto)}
                  aria-hidden
                />
                <span className="font-medium">{deteccao.tipo}</span>
                <span className="text-muted-foreground">· {deteccao.area}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs leading-5 text-muted-foreground">{mensagem}</p>
      </div>
    </section>
  );
}

/** Modal exibido ao tentar enviar com risco médio ou alto. */
export function ModalRisco({
  aberto,
  nivel,
  deteccoes,
  mensagem,
  onOpenChange,
  onCancelar,
  onEnviar,
  enviando = false,
}: {
  aberto: boolean;
  nivel: Risco;
  deteccoes: Deteccao[];
  mensagem: string;
  onOpenChange: (aberto: boolean) => void;
  onCancelar: () => void;
  onEnviar: () => void;
  enviando?: boolean;
}) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border shadow-none sm:max-w-md">
        <DialogHeader>
          <p className="rotulo">Confirmação de envio</p>
          <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
            Enviar mesmo assim?
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            A mensagem contém dados classificados como risco{" "}
            <span className={cn("font-medium", CLASSES_RISCO[nivel].texto)}>
              {ROTULO_RISCO[nivel].toLowerCase()}
            </span>
            . Ao enviar, o alerta será registrado no painel de governança — o texto não é
            armazenado.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border border-y border-border">
          {deteccoes.map((deteccao) => (
            <li
              key={`${deteccao.tipo}-${deteccao.area}`}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="text-sm">{deteccao.tipo}</span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {deteccao.area}
                <span
                  className={cn("size-1.5 rounded-full", CLASSES_RISCO[deteccao.risco].ponto)}
                  aria-hidden
                />
                {ROTULO_RISCO[deteccao.risco]}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-5 text-muted-foreground">{mensagem}</p>

        <DialogFooter className="gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
            Cancelar e revisar
          </Button>
          <Button type="button" onClick={onEnviar} disabled={enviando}>
            Enviar mesmo assim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
