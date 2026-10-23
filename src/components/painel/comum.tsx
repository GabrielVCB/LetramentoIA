import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CLASSES_RISCO, ROTULO_RISCO, type Risco } from "@/lib/dados";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Selo discreto com o nível de risco. */
export function RiscoBadge({
  risco,
  className,
}: {
  risco: Risco;
  className?: string;
}) {
  const cores = CLASSES_RISCO[risco];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        cores.borda,
        cores.fundo,
        cores.texto,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", cores.ponto)} />
      {ROTULO_RISCO[risco]}
    </span>
  );
}

/** Cabeçalho padrão de cada seção do painel. */
export function CabecalhoSecao({
  numero,
  titulo,
  descricao,
  acoes,
}: {
  numero?: string;
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {numero && <p className="rotulo mb-3">{numero}</p>}
        <h1 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
          {titulo}
        </h1>
        {descricao && (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{descricao}</p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  );
}

/** Métrica grande, sem cartão: número + rótulo + detalhe. */
export function Metrica({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-5">
      <span className="rotulo">{rotulo}</span>
      <span className="tabular font-serif text-4xl leading-none tracking-tight">
        {valor}
      </span>
      {detalhe && <span className="text-xs leading-5 text-muted-foreground">{detalhe}</span>}
    </div>
  );
}

/** Estado vazio sóbrio, com ação opcional. */
export function EstadoVazio({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 border border-dashed border-border px-6 py-10">
      <p className="text-sm font-medium">{titulo}</p>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{descricao}</p>
      {children}
    </div>
  );
}

/** Rótulo com valor, usado em resumos de metadados. */
export function CampoResumo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-2.5 last:border-b-0">
      <span className="rotulo">{rotulo}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/** Confirmação obrigatória antes de qualquer exclusão. */
export function ConfirmarAcao({
  titulo,
  descricao,
  rotuloConfirmar = "Excluir",
  onConfirmar,
  children,
  destrutivo = true,
}: {
  titulo: string;
  descricao: string;
  rotuloConfirmar?: string;
  onConfirmar: () => void;
  children: ReactNode;
  destrutivo?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="shadow-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-2xl font-normal">
            {titulo}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-6">
            {descricao}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirmar}
            className={cn(
              destrutivo &&
                "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30",
            )}
          >
            {rotuloConfirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Divisor de seção com rótulo opcional. */
export function DivisorRotulado({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="rotulo shrink-0">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
