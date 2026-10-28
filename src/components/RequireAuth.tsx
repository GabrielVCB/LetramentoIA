import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

/**
 * Protege uma rota que exige sessão.
 *
 * Em vez de jogar o visitante direto no formulário de login, explica o que foi
 * bloqueado e oferece entrar. A rota original vai em `returnTo`, então o
 * usuário volta exatamente para onde estava.
 */
export function RequireAuth({
  children,
  title = "Entre para acessar o painel",
  description = "Esta área é restrita ao RH e aos gestores autorizados.",
  redirectImmediately = false,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  redirectImmediately?: boolean;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const signInHref = `/auth?returnTo=${encodeURIComponent(returnTo)}`;

    if (redirectImmediately) {
      return <Navigate to={signInHref} replace />;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="w-full max-w-md border border-border bg-card px-8 py-10">
          <div className="flex size-10 items-center justify-center border border-border">
            <Lock className="size-4 text-muted-foreground" />
          </div>
          <p className="rotulo mt-6">Acesso restrito</p>
          <h1 className="mt-3 font-serif text-3xl leading-tight tracking-tight">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-7 flex flex-col gap-2">
            <Button className="w-full rounded-sm" onClick={() => navigate(signInHref)}>
              Entrar
            </Button>
            <Button
              variant="ghost"
              className="w-full rounded-sm"
              onClick={() => navigate("/")}
            >
              Voltar para a página inicial
            </Button>
          </div>
          <p className="mt-6 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
            Você retorna a esta página automaticamente após entrar.{" "}
            <Link to="/" className="underline decoration-border underline-offset-4">
              Saber mais
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return children;
}
