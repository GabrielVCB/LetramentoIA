import { cn } from "@/lib/utils";
import { formatarDataCurta } from "@/lib/dados";

interface DiaEvolucao {
  data: string;
  total: number;
  alto: number;
  medio: number;
  baixo: number;
  cancelou: number;
}

/** Evolução diária em SVG puro: barra total (clara) com risco alto (escura). */
export function GraficoEvolucao({ dados }: { dados: DiaEvolucao[] }) {
  const largura = 620;
  const alturaBase = 128;
  const topo = 8;
  const maximo = Math.max(1, ...dados.map((dia) => dia.total));
  const passo = largura / Math.max(dados.length, 1);
  const larguraBarra = Math.min(22, passo * 0.46);

  return (
    <figure className="flex flex-col gap-4">
      <svg
        viewBox={`0 0 ${largura} 168`}
        role="img"
        aria-label="Alertas por dia nos últimos 14 dias"
        className="h-auto w-full"
      >
        {[0, 0.5, 1].map((fracao) => {
          const y = topo + alturaBase * (1 - fracao);
          return (
            <line
              key={fracao}
              x1={0}
              x2={largura}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray={fracao === 0 ? undefined : "2 4"}
            />
          );
        })}

        {dados.map((dia, indice) => {
          const centro = passo * indice + passo / 2;
          const alturaTotal = (dia.total / maximo) * alturaBase;
          const alturaAlto = (dia.alto / maximo) * alturaBase;
          const yTotal = topo + alturaBase - alturaTotal;
          const yAlto = topo + alturaBase - alturaAlto;
          return (
            <g key={dia.data}>
              <rect
                x={centro - larguraBarra / 2}
                y={yTotal}
                width={larguraBarra}
                height={Math.max(alturaTotal, dia.total > 0 ? 2 : 0)}
                fill="var(--chart-4)"
              />
              {dia.alto > 0 && (
                <rect
                  x={centro - larguraBarra / 2}
                  y={yAlto}
                  width={larguraBarra}
                  height={Math.max(alturaAlto, 2)}
                  fill="var(--foreground)"
                />
              )}
              <text
                x={centro}
                y={alturaBase + topo + 16}
                textAnchor="middle"
                fontSize={9}
                fill="var(--muted-foreground)"
                fontFamily="var(--font-mono), monospace"
              >
                {formatarDataCurta(new Date(`${dia.data}T12:00:00`).getTime())}
              </text>
              <title>
                {`${formatarDataCurta(new Date(`${dia.data}T12:00:00`).getTime())}: ${dia.total} alerta(s), ${dia.alto} de risco alto`}
              </title>
            </g>
          );
        })}
        <line
          x1={0}
          x2={largura}
          y1={topo + alturaBase}
          y2={topo + alturaBase}
          stroke="var(--border)"
          strokeWidth={1}
        />
      </svg>
      <figcaption className="flex flex-wrap items-center gap-5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 bg-foreground" aria-hidden /> Risco alto
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 bg-chart-4" aria-hidden /> Demais alertas
        </span>
        <span className="ml-auto">Últimos 14 dias</span>
      </figcaption>
    </figure>
  );
}

/** Lista de barras horizontais finas, ordenada pelo chamador. */
export function BarrasHorizontais({
  itens,
  sufixo,
  className,
}: {
  itens: Array<{ rotulo: string; valor: number; detalhe?: string }>;
  sufixo?: string;
  className?: string;
}) {
  const maximo = Math.max(1, ...itens.map((item) => item.valor));
  return (
    <ul className={cn("flex flex-col", className)}>
      {itens.map((item) => (
        <li
          key={item.rotulo}
          className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
        >
          <span className="truncate text-xs" title={item.rotulo}>
            {item.rotulo}
          </span>
          <span className="h-1.5 w-full bg-muted" aria-hidden>
            <span
              className="block h-full bg-foreground/80"
              style={{ width: `${Math.max((item.valor / maximo) * 100, item.valor > 0 ? 2 : 0)}%` }}
            />
          </span>
          <span className="tabular min-w-10 text-right text-xs text-muted-foreground">
            {item.valor}
            {sufixo}
            {item.detalhe && <span className="ml-1 text-muted-foreground/70">{item.detalhe}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Barra segmentada: envios (escuro) versus cancelamentos (claro). */
export function BarraEnvio({
  enviou,
  cancelou,
  compacta = false,
}: {
  enviou: number;
  cancelou: number;
  compacta?: boolean;
}) {
  const total = enviou + cancelou;
  const taxa = total === 0 ? 0 : Math.round((enviou / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn("flex w-full overflow-hidden border border-border/70", compacta ? "h-1.5" : "h-2")}
        role="img"
        aria-label={`${taxa}% enviou mesmo assim, ${100 - taxa}% cancelou`}
      >
        <span className="bg-foreground/80" style={{ width: `${total === 0 ? 0 : taxa}%` }} />
        <span className="bg-chart-4" style={{ width: `${total === 0 ? 0 : 100 - taxa}%` }} />
      </div>
      <span className="tabular w-9 shrink-0 text-right text-[11px] text-muted-foreground">
        {total === 0 ? "—" : `${taxa}%`}
      </span>
    </div>
  );
}
