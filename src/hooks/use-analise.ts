import { useCallback, useEffect, useRef, useState } from "react";
import { analisarTexto, type Analise, type RegraEntrada } from "@/lib/detectores";

/**
 * Executa a análise local com debounce de ~400 ms, como a extensão faz
 * ao escutar o evento `input` do campo de texto.
 *
 * `reanalisar` força uma leitura imediata — usada no momento do envio, para
 * que nenhuma tecla pressionada nos últimos 400 ms escape da classificação.
 */
export function useAnaliseComDebounce(
  texto: string,
  regras: RegraEntrada[],
  atraso = 400,
): { analise: Analise; analisando: boolean; reanalisar: () => Analise } {
  const [analise, setAnalise] = useState<Analise>(() => analisarTexto(texto, regras));
  const [analisando, setAnalisando] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setAnalisando(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setAnalise(analisarTexto(texto, regras));
      setAnalisando(false);
    }, atraso);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [texto, regras, atraso]);

  const reanalisar = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const resultado = analisarTexto(texto, regras);
    setAnalise(resultado);
    setAnalisando(false);
    return resultado;
  }, [texto, regras]);

  return { analise, analisando, reanalisar };
}
