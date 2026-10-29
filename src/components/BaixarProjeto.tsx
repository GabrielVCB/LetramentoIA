import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from "react";
import { toast } from "sonner";

const NOME_ZIP = "sentinela-projeto.zip";
// A versão na URL evita que o navegador entregue um ZIP antigo em cache.
const VERSAO_ZIP = "2.6.2";
const CAMINHO_ZIP = `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/sentinela-projeto.zip?v=${VERSAO_ZIP}`;

type Estado = "ocioso" | "baixando" | "pronto";

function salvarArquivo(conteudo: Blob, nome: string) {
  const url = URL.createObjectURL(conteudo);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Baixa o ZIP do projeto via `fetch` + Blob.
 *
 * O link direto (`href` com `download`) continua válido para clique do meio,
 * Ctrl/Cmd+clique e "salvar link como", mas o caminho principal passa por um
 * Blob porque a prévia roda dentro de um iframe: navegar para o arquivo em uma
 * nova aba muitas vezes é bloqueado ou abre uma aba vazia. Quando o navegador
 * recusa o download, oferecemos o endereço direto em um aviso.
 */
export function useBaixarProjeto() {
  const [estado, setEstado] = useState<Estado>("ocioso");
  const [progresso, setProgresso] = useState(0);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controle.current?.abort();
  }, []);

  const baixar = useCallback(
    async (evento: MouseEvent<HTMLAnchorElement>) => {
      // Deixa o navegador tratar atalhos que pedem "abrir em nova aba".
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      evento.preventDefault();
      if (controle.current) return;

      const abortar = new AbortController();
      controle.current = abortar;
      setEstado("baixando");
      setProgresso(0);

      try {
        const resposta = await fetch(CAMINHO_ZIP, {
          signal: abortar.signal,
          cache: "no-store",
        });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const total = Number(resposta.headers.get("content-length")) || 0;
        const leitor = resposta.body?.getReader();
        const pedacos: BlobPart[] = [];
        let recebido = 0;

        if (leitor) {
          for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            pedacos.push(value as BlobPart);
            recebido += value.byteLength;
            if (total > 0) {
              setProgresso(Math.min(99, Math.round((recebido / total) * 100)));
            }
          }
        }

        const conteudo = leitor ? new Blob(pedacos, { type: "application/zip" }) : await resposta.blob();
        const inicio = new Uint8Array(await conteudo.slice(0, 4).arrayBuffer());
        const assinaturaZip = inicio[0] === 0x50 && inicio[1] === 0x4b;
        if (conteudo.size < 1024 || !assinaturaZip) {
          throw new Error("O servidor não devolveu o arquivo ZIP.");
        }

        salvarArquivo(conteudo, NOME_ZIP);
        setProgresso(100);
        setEstado("pronto");
        const tamanho = `${(conteudo.size / 1_048_576).toFixed(1)} MB`;
        toast.success("Download iniciado", {
          description:
            window.self !== window.top
              ? `${NOME_ZIP} — ${tamanho}. Se o arquivo não aparecer, abra a prévia em outra aba e clique de novo.`
              : `${NOME_ZIP} — ${tamanho}`,
        });
      } catch (erro) {
        if (abortar.signal.aborted) return;
        setEstado("ocioso");
        setProgresso(0);
        toast.error("Não foi possível baixar automaticamente", {
          description:
            "A prévia pode estar bloqueando downloads. Abra o arquivo direto ou use o link do rodapé.",
          duration: 12_000,
          action: {
            label: "Abrir arquivo",
            onClick: () => window.open(CAMINHO_ZIP, "_blank", "noopener,noreferrer"),
          },
        });
        console.error("Falha ao baixar o projeto:", erro);
      } finally {
        controle.current = null;
      }
    },
    [],
  );

  return { estado, progresso, baixar, href: CAMINHO_ZIP, nome: NOME_ZIP };
}

/** Link de download com rótulo que reflete o progresso. */
export function BaixarProjetoLink({
  className,
  children,
  rotuloBaixando = "Baixando",
  ...resto
}: ComponentPropsWithoutRef<"a"> & { rotuloBaixando?: string }) {
  const { estado, progresso, baixar, href, nome } = useBaixarProjeto();

  return (
    <a
      {...resto}
      href={href}
      download={nome}
      onClick={baixar}
      aria-busy={estado === "baixando"}
      className={className}
    >
      {estado === "baixando" ? (
        <span className="tabular">
          {rotuloBaixando} {progresso > 0 ? `${progresso}%` : "…"}
        </span>
      ) : (
        children
      )}
    </a>
  );
}
