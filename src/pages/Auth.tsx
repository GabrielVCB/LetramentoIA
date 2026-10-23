import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, ArrowRight, Loader2, Mail, UserRound } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o código. Tente novamente.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("O código informado está incorreto ou expirou.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Não foi possível entrar como convidado: ${
          error instanceof Error ? error.message : "erro desconhecido"
        }`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <aside className="hidden flex-col justify-between border-r border-border bg-muted/25 p-12 lg:flex">
        <Link to="/" className="flex items-baseline gap-2.5">
          <span className="font-serif text-2xl leading-none tracking-tight">Sentinela</span>
          <span className="rotulo">governança de ia</span>
        </Link>

        <div className="max-w-sm">
          <p className="rotulo">Painel administrativo</p>
          <h1 className="mt-5 font-serif text-5xl leading-[1.03] tracking-tight text-balance">
            O aviso chega antes do envio.
          </h1>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            Governança, auditoria e letramento em IA. Acompanhe os alertas de vazamento sem
            armazenar uma única linha do texto digitado.
          </p>

          <dl className="mt-10 border-t border-border">
            {[
              ["Regras editáveis", "por área e nível de risco"],
              ["Auditoria sem conteúdo", "somente metadados do alerta"],
              ["Relatórios de letramento", "envios × cancelamentos"],
            ].map(([titulo, detalhe]) => (
              <div key={titulo} className="flex items-baseline justify-between gap-4 border-b border-border/70 py-3">
                <dt className="text-xs">{titulo}</dt>
                <dd className="text-right text-[10px] text-muted-foreground">{detalhe}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[10px] leading-5 text-muted-foreground">
          Sentinela · governança de IA · roda localmente
        </p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-12 flex items-baseline gap-2 lg:hidden">
            <span className="font-serif text-2xl leading-none tracking-tight">Sentinela</span>
            <span className="rotulo">governança de ia</span>
          </Link>

          {step === "signIn" ? (
            <>
              <p className="rotulo">Acesso restrito</p>
              <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight">
                Entrar no painel
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Informe seu e-mail para receber um código de acesso. Não é necessário criar senha.
              </p>

              <form onSubmit={handleEmailSubmit} className="mt-8 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="rotulo">E-mail corporativo</span>
                  <div className="relative">
                    <Mail
                      className="absolute top-3 left-3 size-4 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      name="email"
                      placeholder="nome@empresa.com.br"
                      type="email"
                      className="rounded-sm pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </label>

                {error && (
                  <p className="border-l-2 border-destructive pl-3 text-xs leading-5 text-destructive" role="alert">
                    {error}
                  </p>
                )}

                <Button type="submit" className="rounded-sm" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Receber código <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>

              <div className="my-7 flex items-center gap-4">
                <span className="h-px flex-1 bg-border" />
                <span className="rotulo">ou</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full rounded-sm"
                onClick={handleGuestLogin}
                disabled={isLoading}
              >
                <UserRound className="size-4" /> Entrar como convidado
              </Button>

              <p className="mt-6 text-[11px] leading-5 text-muted-foreground">
                O acesso de convidado existe para explorar o painel. Em produção, o acesso deve
                ser restrito a pessoas autorizadas.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep("signIn");
                  setOtp("");
                  setError(null);
                }}
                className="mb-8 flex items-center gap-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" /> Usar outro e-mail
              </button>

              <p className="rotulo">Verificação</p>
              <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight">
                Confira seu e-mail
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Enviamos um código de seis dígitos para{" "}
                <span className="text-foreground">{step.email}</span>.
              </p>

              <form onSubmit={handleOtpSubmit} className="mt-8 flex flex-col gap-4">
                <input type="hidden" name="email" value={step.email} />
                <input type="hidden" name="code" value={otp} />

                <InputOTP
                  value={otp}
                  onChange={setOtp}
                  maxLength={6}
                  disabled={isLoading}
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter" && otp.length === 6 && !isLoading) {
                      const form = (evento.target as HTMLElement).closest("form");
                      form?.requestSubmit();
                    }
                  }}
                >
                  <InputOTPGroup className="w-full justify-between">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-11 w-11 rounded-sm border"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>

                {error && (
                  <p className="border-l-2 border-destructive pl-3 text-xs leading-5 text-destructive" role="alert">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  className="rounded-sm"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Verificando…
                    </>
                  ) : (
                    <>
                      Verificar código <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>

              <p className="mt-6 text-[11px] leading-5 text-muted-foreground">
                O código expira em poucos minutos. Verifique também a caixa de spam.
              </p>
            </>
          )}

          <div className="mt-12 border-t border-border pt-4">
            <Link
              to="/"
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Voltar para a página inicial
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
