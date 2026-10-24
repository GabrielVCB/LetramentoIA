import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CabecalhoSecao, Metrica, RiscoBadge, EstadoVazio } from "./comum";
import { BarraEnvio, BarrasHorizontais, GraficoEvolucao } from "./Graficos";
import { formatarDataHora, formatarNumero, ROTULO_RISCO } from "@/lib/dados";
import { Loader2 } from "lucide-react";
import type { SecaoId } from "./secoes";

const ROTULO_ACAO = { enviou: "Enviou", cancelou: "Cancelou" } as const;

export function Visao({ onNavegar }: { onNavegar: (secao: SecaoId) => void }) {
  const [limiar, setLimiar] = useState(30);
  const configuracoes = useQuery(api.painel.obterConfiguracoes);
  const salvarConfiguracoes = useMutation(api.painel.salvarConfiguracoes);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (configuracoes && typeof configuracoes.limiarGargalo === "number") {
      setLimiar(configuracoes.limiarGargalo);
    }
  }, [configuracoes]);

  const relatorio = useQuery(api.painel.painel, { limiar });

  async function aplicarLimiar() {
    setSalvando(true);
    try {
      await salvarConfiguracoes({ limiarGargalo: limiar });
      toast.success("Limiar de gargalo atualizado.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar o limiar.");
    } finally {
      setSalvando(false);
    }
  }

  if (!relatorio) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const semDados = relatorio.total === 0;

  return (
    <div className="flex flex-col gap-10">
      <CabecalhoSecao
        numero="01 · Visão geral"
        titulo="Relatórios de letramento"
        descricao="O que os colaboradores levaram para fora — e o que decidiram revisar. Todos os números vêm de metadados; nenhum texto de conversa é armazenado."
        acoes={
          <Button variant="outline" className="rounded-sm" onClick={() => onNavegar("alertas")}>
            Ver auditoria
          </Button>
        }
      />

      <section
        aria-label="Indicadores gerais"
        className="grid grid-cols-2 divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-y-0 sm:divide-x"
      >
        <div className="pr-4 sm:pr-6">
          <Metrica
            rotulo="Alertas registrados"
            valor={formatarNumero(relatorio.total)}
            detalhe={`${formatarNumero(relatorio.departamentosAtivos)} departamentos monitorados`}
          />
        </div>
        <div className="pl-4 sm:px-6">
          <Metrica
            rotulo="Risco alto"
            valor={formatarNumero(relatorio.totalAlto)}
            detalhe={`${relatorio.taxaAlto}% do total de alertas`}
          />
        </div>
        <div className="border-t border-border pr-4 pt-1 sm:border-t-0 sm:pr-6">
          <Metrica
            rotulo="Enviou mesmo assim"
            valor={`${relatorio.taxaEnvio}%`}
            detalhe={`${formatarNumero(relatorio.totalEnviou)} envios · ${formatarNumero(relatorio.totalCancelou)} cancelamentos`}
          />
        </div>
        <div className="border-t border-border pl-4 pt-1 sm:border-t-0 sm:px-6">
          <Metrica
            rotulo="Tipos distintos"
            valor={formatarNumero(relatorio.tiposDistintos)}
            detalhe="categorias de dado detectadas"
          />
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl tracking-tight">Evolução dos alertas</h2>
          <span className="rotulo">Últimos 14 dias</span>
        </div>
        <GraficoEvolucao dados={relatorio.evolucao} />
      </section>

      <div className="grid gap-10 border-t border-border pt-8 lg:grid-cols-2 lg:gap-14">
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-serif text-xl tracking-tight">Risco alto por departamento</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Absoluto de alertas classificados como alto.
            </p>
          </div>
          {relatorio.porDepartamento.length === 0 ? (
            <EstadoVazio
              titulo="Sem alertas"
              descricao="Assim que a extensão registrar um envio, os departamentos aparecem aqui."
            />
          ) : (
            <BarrasHorizontais
              itens={relatorio.porDepartamento.map((item) => ({
                rotulo: item.departamento,
                valor: item.alto,
                detalhe: `/${item.total}`,
              }))}
            />
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-serif text-xl tracking-tight">Tipos de dado mais detectados</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Frequência por tipo, independente do nível.
            </p>
          </div>
          {relatorio.tipos.length === 0 ? (
            <EstadoVazio
              titulo="Nenhuma detecção"
              descricao="A matriz de risco ainda não recebeu registros."
            />
          ) : (
            <ol className="flex flex-col">
              {relatorio.tipos.map((tipo, indice) => (
                <li
                  key={tipo.tipo}
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
                >
                  <span className="tabular text-[10px] text-muted-foreground">
                    {String(indice + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{tipo.tipo}</span>
                    <span className="block text-[11px] text-muted-foreground">{tipo.area}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <RiscoBadge risco={tipo.risco} />
                    <span className="tabular w-8 text-right text-xs text-muted-foreground">
                      {tipo.total}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-5 border-t border-border pt-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h2 className="font-serif text-xl tracking-tight">
              Enviou mesmo assim × cancelou
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Indicador de letramento: quanto maior a fatia escura, menor a efetividade dos
              avisos naquele departamento.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="rotulo">Limiar de gargalo (%)</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={limiar}
                onChange={(evento) => setLimiar(Number(evento.target.value))}
                className="tabular w-24 rounded-sm"
              />
            </label>
            <Button
              variant="outline"
              className="rounded-sm"
              onClick={aplicarLimiar}
              disabled={salvando}
            >
              {salvando ? <Loader2 className="size-4 animate-spin" /> : "Aplicar"}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="rotulo py-2 pr-4 font-normal">Departamento</th>
                <th className="rotulo py-2 pr-4 text-right font-normal">Alertas</th>
                <th className="rotulo py-2 pr-4 text-right font-normal">Risco alto</th>
                <th className="rotulo py-2 pr-4 font-normal">Enviou mesmo assim</th>
                <th className="rotulo py-2 pr-4 font-normal">Situação</th>
              </tr>
            </thead>
            <tbody>
              {relatorio.porDepartamento.map((item) => {
                const gargalo = relatorio.gargalos.some(
                  (g) => g.departamento === item.departamento,
                );
                return (
                  <tr key={item.departamento} className="border-b border-border/60 last:border-b-0">
                    <td className="py-3 pr-4 text-xs font-medium">{item.departamento}</td>
                    <td className="tabular py-3 pr-4 text-right text-xs text-muted-foreground">
                      {item.total}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="tabular text-xs text-muted-foreground">
                        {item.alto} · {item.taxaAlto}%
                      </span>
                    </td>
                    <td className="w-52 py-3 pr-4">
                      <BarraEnvio enviou={item.enviou} cancelou={item.cancelou} compacta />
                    </td>
                    <td className="py-3 pr-4">
                      {gargalo ? (
                        <span className="text-[11px] font-medium text-risco-alto">Gargalo</span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Acompanhar</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          Gargalo = departamento com no mínimo 3 alertas e ao menos {limiar}% deles em risco
          alto.
        </p>

        {relatorio.gargalos.length > 0 && (
          <div className="border-l-2 border-risco-alto bg-risco-alto-bg/50 px-5 py-4">
            <p className="rotulo mb-2">Gargalos de letramento identificados</p>
            <ul className="flex flex-col gap-1.5">
              {relatorio.gargalos.map((item) => (
                <li key={item.departamento} className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium">{item.departamento}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.alto} de {item.total} alertas em risco alto ({item.taxaAlto}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-xl tracking-tight">Últimos alertas</h2>
          <button
            type="button"
            onClick={() => onNavegar("alertas")}
            className="text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
          >
            Ver todos
          </button>
        </div>
        {relatorio.ultimos.length === 0 ? (
          <EstadoVazio
            titulo="Nada registrado ainda"
            descricao="Use o laboratório para simular um envio e ver o alerta aparecer aqui."
          >
            <Button variant="outline" className="rounded-sm" onClick={() => onNavegar("laboratorio")}>
              Abrir laboratório
            </Button>
          </EstadoVazio>
        ) : (
          <ul className="flex flex-col">
            {relatorio.ultimos.map((alerta) => (
              <li
                key={alerta._id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 py-3 last:border-b-0 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-center"
              >
                <span className="tabular hidden text-[11px] text-muted-foreground sm:block">
                  {formatarDataHora(alerta.dataHora)}
                </span>
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{alerta.departamento}</span>
                  <span className="text-muted-foreground"> · {alerta.site}</span>
                </span>
                <RiscoBadge risco={alerta.nivelRisco} />
                <span className="text-[11px] text-muted-foreground">
                  {ROTULO_ACAO[alerta.acao]}
                  {alerta.acao === "enviou" && alerta.nivelRisco === "alto" && (
                    <span className="ml-2 text-risco-alto">atenção</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {semDados && (
        <p className="text-xs text-muted-foreground">
          Dica: como administrador, você pode começar pelo laboratório ou aguardar os envios da
          extensão instalada nos navegadores.
        </p>
      )}

      <p className="border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
        Classificação aplicada: {ROTULO_RISCO.alto} &gt; {ROTULO_RISCO.medio} &gt;{" "}
        {ROTULO_RISCO.baixo}. Um alerta é alto quando ao menos um tipo detectado é de risco alto.
      </p>
    </div>
  );
}
