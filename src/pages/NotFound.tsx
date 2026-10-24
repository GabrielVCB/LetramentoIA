import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <p className="rotulo">Erro 404</p>
      <h1 className="mt-5 font-serif text-6xl tracking-tight">Página não encontrada.</h1>
      <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
        O endereço acessado não existe neste painel. Volte para a visão geral ou para a página
        inicial.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild className="rounded-sm">
          <Link to="/dashboard">Ir para o painel</Link>
        </Button>
        <Button asChild variant="outline" className="rounded-sm">
          <Link to="/">Página inicial</Link>
        </Button>
      </div>
    </main>
  );
}
