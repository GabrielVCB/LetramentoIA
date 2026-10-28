import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Download, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { BaixarProjetoLink } from "@/components/BaixarProjeto";
import { Button } from "@/components/ui/button";
import { SECOES, ehSecaoValida, type SecaoId } from "@/components/painel/secoes";
import { Visao } from "@/components/painel/Visao";
import { Regras } from "@/components/painel/Regras";
import { Areas } from "@/components/painel/Areas";
import { Mensagens } from "@/components/painel/Mensagens";
import { Alertas } from "@/components/painel/Alertas";
import { Laboratorio } from "@/components/painel/Laboratorio";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const [parametros, setParametros] = useSearchParams();
  const navegar = useNavigate();
  const { user, signOut } = useAuth();
  const garantirSeed = useMutation(api.seed.garantirSeed);

  const secaoParam = parametros.get("secao");
  const secao: SecaoId = ehSecaoValida(secaoParam) ? secaoParam : "visao";
  const atual = SECOES.find((item) => item.id === secao) ?? SECOES[0]!;

  useEffect(() => {
    void garantirSeed({}).catch(() => {
      /* a semeadura é idempotente; falhas não bloqueiam o painel */
    });
  }, [garantirSeed]);

  function irPara(id: SecaoId) {
    setParametros(id === "visao" ? {} : { secao: id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function sair() {
    await signOut();
    navegar("/");
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="border-b border-border px-6 py-7">
          <Link to="/" className="group flex flex-col gap-1">
            <span className="font-serif text-2xl leading-none tracking-tight">Sentinela</span>
            <span className="rotulo">governança de ia</span>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-6" aria-label="Painel">
          {SECOES.map((item) => {
            const ativa = item.id === secao;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => irPara(item.id)}
                aria-current={ativa ? "page" : undefined}
                className={cn(
                  "group flex items-baseline gap-3 px-3 py-2.5 text-left transition-colors",
                  ativa
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <span className="tabular text-[10px] opacity-60">{item.numero}</span>
                <span className="flex-1">
                  <span className="block text-[13px] font-medium">{item.rotulo}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {item.descricao}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border px-5 py-4">
          <p className="rotulo mb-1">Sessão</p>
          <p className="truncate text-xs">{user?.email ?? user?.name ?? "Administrador local"}</p>
          <button
            type="button"
            onClick={sair}
            className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="size-3.5" /> Encerrar sessão
          </button>
          <BaixarProjetoLink className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            <Download className="size-3.5" /> Baixar projeto (.zip)
          </BaixarProjetoLink>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-sm lg:hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <Link to="/" className="flex items-baseline gap-2">
              <span className="font-serif text-xl tracking-tight">Sentinela</span>
              <span className="rotulo">governança de ia</span>
            </Link>
            <div className="flex items-center gap-1">
              <BaixarProjetoLink
                rotuloBaixando="…"
                aria-label="Baixar projeto"
                className="inline-flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              >
                <Download className="size-4" />
              </BaixarProjetoLink>
              <Button variant="ghost" size="sm" className="rounded-sm" onClick={sair}>
                <LogOut className="size-4" /> Sair
              </Button>
            </div>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto px-3 pb-3"
            aria-label="Painel (navegação móvel)"
          >
            {SECOES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => irPara(item.id)}
                className={cn(
                  "shrink-0 border px-2.5 py-1.5 text-[11px] transition-colors",
                  item.id === secao
                    ? "border-foreground/30 bg-sidebar-accent text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                <span className="tabular mr-1.5 opacity-60">{item.numero}</span>
                {item.rotulo}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <div className="mb-6 hidden items-center justify-between border-b border-border pb-3 lg:flex">
            <p className="rotulo">{atual.descricao}</p>
            <p className="rotulo">Painel administrativo · {atual.rotulo}</p>
          </div>

          {secao === "visao" && <Visao onNavegar={irPara} />}
          {secao === "regras" && <Regras />}
          {secao === "areas" && <Areas />}
          {secao === "mensagens" && <Mensagens />}
          {secao === "alertas" && <Alertas />}
          {secao === "laboratorio" && <Laboratorio />}
        </main>
      </div>
    </div>
  );
}
