import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useAnaliseComDebounce } from "@/hooks/use-analise";
import { BannerRisco } from "@/components/painel/BannerRisco";
import { BaixarProjetoLink } from "@/components/BaixarProjeto";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AREAS_SEED,
  MENSAGENS_PADRAO,
  SITES_MONITORADOS,
  type Risco,
} from "@/lib/dados";
import type { RegraEntrada } from "@/lib/detectores";
import { ArrowRight, ArrowUpRight, Download } from "lucide-react";

const TEXTO_INICIAL =
  "Preciso revisar o orçamento interno do trimestre e o cronograma do projeto Atlas antes da reunião de segunda.";

const EXEMPLOS_DEMO = [
  {
    rotulo: "CPF",
    texto: "O CPF do novo analista é 529.982.247-25. Pode conferir os dados para o contrato?",
  },
  {
    rotulo: "Token",
    texto: "Estou com erro na API. Minha chave é sk-proj-8fJ2kLm9Qr4Tz7Xb1Nc6Vd3.",
  },
  {
    rotulo: "Sem risco",
    texto: "Pode revisar a redação deste e-mail de agradecimento para o cliente?",
  },
];

const ETAPAS = [
  {
    numero: "01",
    titulo: "Instalação sem loja",
    texto:
      "A extensão entra no Chrome ou no Edge em modo de desenvolvedor, sem loja e sem depender de nenhum serviço externo.",
  },
  {
    numero: "02",
    titulo: "Leitura no campo",
    texto:
      "MutationObserver encontra a caixa de texto de cada IA. A cada pausa na digitação, os detectores rodam no navegador.",
  },
  {
    numero: "03",
    titulo: "Aviso no momento certo",
    texto:
      "Um painel em Shadow DOM classifica o risco, lista os tipos e explica o que fazer. Em risco alto, o envio pede confirmação.",
  },
  {
    numero: "04",
    titulo: "Auditoria sem conteúdo",
    texto:
      "Só o alerta chega ao servidor: site, departamento, nível, tipos e a decisão do colaborador. Nunca o texto.",
  },
];

const fade = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const config = useQuery(api.painel.config);
  const garantirSeed = useMutation(api.seed.garantirSeed);

  const [texto, setTexto] = useState(TEXTO_INICIAL);
  const regras = useMemo<RegraEntrada[]>(() => config?.regras ?? [], [config]);
  const { analise, analisando } = useAnaliseComDebounce(texto, regras);
  const mensagem = config?.mensagens[analise.nivel] ?? MENSAGENS_PADRAO[analise.nivel];

  useEffect(() => {
    void garantirSeed({}).catch(() => {
      /* a demonstração continua funcionando com os detectores embutidos */
    });
  }, [garantirSeed]);

  const destino = isAuthenticated ? "/dashboard" : "/auth";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-baseline gap-2.5" aria-label="Sentinela, página inicial">
            <span className="font-serif text-2xl leading-none tracking-tight">Sentinela</span>
            <span className="rotulo hidden sm:inline">governança de ia</span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Navegação principal">
            <a
              href="#principio"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Princípio
            </a>
            <a
              href="#matriz"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Matriz de risco
            </a>
            <a
              href="#funciona"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Como funciona
            </a>
            <a
              href="#letramento"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Letramento
            </a>
          </nav>

          <Button asChild variant="outline" className="rounded-sm">
            <Link to={destino}>
              {isAuthenticated ? "Abrir painel" : "Entrar"}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-5 pt-14 pb-16 sm:px-8 lg:pt-24 lg:pb-24">
          <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="rotulo">Governança de dados · uso de IA</p>
              <h1 className="mt-6 max-w-xl font-serif text-[2.9rem] leading-[0.98] tracking-tight text-balance sm:text-6xl lg:text-[4.15rem]">
                O que é confidencial não deveria virar <em className="italic">prompt</em>.
              </h1>
              <p className="mt-7 max-w-md text-sm leading-7 text-muted-foreground">
                Um painel de governança e letramento em IA para reduzir o vazamento de
                informações corporativas. A extensão lê o que o colaborador digita no ChatGPT,
                Gemini, Claude e Copilot — e avisa antes do envio. O texto nunca sai da máquina.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild className="rounded-sm">
                  <Link to={destino}>
                    {isAuthenticated ? "Abrir o painel" : "Começar pelo painel"}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="rounded-sm">
                  <a href="#matriz">Ver a matriz de risco</a>
                </Button>
                <BaixarProjetoLink
                  className={buttonVariants({ variant: "outline", className: "rounded-sm" })}
                  rotuloBaixando="Baixando projeto"
                >
                  <Download className="size-4" /> Baixar projeto
                </BaixarProjetoLink>
              </div>

              <dl className="mt-12 grid max-w-md grid-cols-3 gap-4 border-t border-border pt-5">
                <div>
                  <dt className="rotulo">Sites</dt>
                  <dd className="mt-1 font-serif text-2xl">05</dd>
                </div>
                <div>
                  <dt className="rotulo">Áreas</dt>
                  <dd className="mt-1 font-serif text-2xl">
                    {String(AREAS_SEED.length).padStart(2, "0")}
                  </dd>
                </div>
                <div>
                  <dt className="rotulo">Texto enviado</dt>
                  <dd className="mt-1 font-serif text-2xl">00</dd>
                </div>
              </dl>
            </motion.div>

            {/* Demonstração ao vivo */}
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div className="border border-border bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                  <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-risco-baixo" aria-hidden />
                    chatgpt.com
                  </span>
                  <span className="rotulo">prévia · análise local</span>
                </div>

                <Textarea
                  value={texto}
                  onChange={(evento) => setTexto(evento.target.value)}
                  aria-label="Texto de demonstração"
                  className="min-h-32 resize-none rounded-none border-0 bg-transparent px-4 py-4 text-sm leading-6 shadow-none focus-visible:ring-0"
                />

                <div className="border-t border-border bg-muted/30 p-3">
                  <BannerRisco
                    nivel={analise.nivel}
                    deteccoes={analise.deteccoes}
                    mensagem={mensagem}
                    analisando={analisando}
                    className="border-0"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rotulo">Testar</span>
                    {EXEMPLOS_DEMO.map((exemplo) => (
                      <button
                        key={exemplo.rotulo}
                        type="button"
                        onClick={() => setTexto(exemplo.texto)}
                        className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                      >
                        {exemplo.rotulo}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground">nada é gravado aqui</span>
                </div>
              </div>

              <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                <span className="mt-1.5 block size-1 shrink-0 bg-foreground/40" aria-hidden />
                A classificação vem da matriz de risco editável no painel. Esta prévia usa os
                mesmos detectores da extensão, rodando no seu navegador.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Faixa de sites monitorados */}
        <div className="border-y border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span className="rotulo">Monitorado</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {SITES_MONITORADOS.map((site, indice) => (
                <span key={site} className="flex items-center gap-3">
                  {indice > 0 && <span className="text-border">/</span>}
                  {site}
                </span>
              ))}
            </div>
            <span className="rotulo">análise local</span>
          </div>
        </div>

        {/* 01 O problema */}
        <motion.section {...fade} className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
            <div>
              <p className="rotulo">01 — O problema</p>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] tracking-tight text-balance">
                A política existe. O hábito não acompanha.
              </h2>
              <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
                Ferramentas de IA públicas são úteis e vão continuar sendo usadas. O que precisa
                mudar é o que entra nelas.
              </p>
            </div>

            <div className="border-t border-border">
              {[
                {
                  n: "01",
                  titulo: "A IA pública virou atalho",
                  texto:
                    "Reescrever e-mail, depurar código, resumir contrato. A ferramenta certa, muitas vezes com o dado errado dentro.",
                },
                {
                  n: "02",
                  titulo: "O vazamento não parece vazamento",
                  texto:
                    "Um CPF no meio de uma frase, um token colado para pedir ajuda. Nada disso aciona o antivírus — nem o jurídico.",
                },
                {
                  n: "03",
                  titulo: "Sem registro, não há gestão",
                  texto:
                    "Quem enviou, com que risco, em qual área? Sem auditoria, a política de uso de IA fica só no papel.",
                },
              ].map((item) => (
                <div
                  key={item.n}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 border-b border-border py-6"
                >
                  <span className="tabular pt-1 text-[10px] text-muted-foreground">{item.n}</span>
                  <div>
                    <h3 className="text-sm font-medium">{item.titulo}</h3>
                    <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                      {item.texto}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* 02 Princípio */}
        <motion.section
          id="principio"
          {...fade}
          className="scroll-mt-20 border-y border-border bg-muted/25"
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="rotulo">02 — Princípio</p>
                <h2 className="mt-5 max-w-xl font-serif text-4xl leading-[1.05] tracking-tight text-balance">
                  Vigilância sobre o risco, não sobre a conversa.
                </h2>
              </div>
              <p className="max-w-xs text-xs leading-6 text-muted-foreground">
                O sistema foi desenhado para que o conteúdo sensível nunca atravesse a fronteira
                do navegador.
              </p>
            </div>

            <div className="mt-14 grid gap-8 border-t border-border pt-8 md:grid-cols-3 md:gap-12">
              {[
                {
                  n: "01",
                  titulo: "Lê no navegador",
                  texto:
                    "Content script observa o campo de texto e aplica os detectores localmente. Nenhum keystroke é transmitido.",
                },
                {
                  n: "02",
                  titulo: "Classifica pelo contexto",
                  texto:
                    "Cada regra pertence a uma área e a um nível. A maior gravidade encontrada define o alerta: alto, médio ou baixo.",
                },
                {
                  n: "03",
                  titulo: "Registra só o alerta",
                  texto:
                    "Site, departamento, nível, tipos detectados e a decisão de enviar ou cancelar. Sem texto, sem histórico de chat.",
                },
              ].map((item) => (
                <div key={item.n}>
                  <p className="tabular text-[10px] text-muted-foreground">{item.n}</p>
                  <h3 className="mt-3 font-serif text-xl tracking-tight">{item.titulo}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.texto}</p>
                </div>
              ))}
            </div>

            <p className="mt-12 border-l-2 border-foreground/20 pl-5 font-serif text-xl leading-relaxed text-foreground/80 italic">
              “O texto não sai da máquina. Nem para o servidor da própria empresa.”
            </p>
          </div>
        </motion.section>

        {/* 03 Matriz */}
        <motion.section
          id="matriz"
          {...fade}
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 lg:py-28"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="rotulo">03 — Matriz de risco</p>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] tracking-tight">
                {AREAS_SEED.length} áreas, uma escala só.
              </h2>
            </div>
            <p className="max-w-xs text-xs leading-6 text-muted-foreground">
              A classificação é sempre a mesma: um item de risco alto eleva a mensagem a risco
              alto. Sem itens altos, um médio eleva a risco médio.
            </p>
          </div>

          <div className="mt-10 overflow-x-auto border-t border-border">
            <table className="w-full min-w-[820px] border-collapse text-left align-top">
              <thead>
                <tr className="border-b border-border">
                  <th className="rotulo py-3 pr-5 font-normal">Área</th>
                  {(["baixo", "medio", "alto"] as Risco[]).map((risco) => (
                    <th key={risco} className="rotulo py-3 pr-5 font-normal">
                      <span className="flex items-center gap-2">
                        <span
                          className={
                            risco === "baixo"
                              ? "size-1.5 rounded-full bg-risco-baixo"
                              : risco === "medio"
                                ? "size-1.5 rounded-full bg-risco-medio"
                                : "size-1.5 rounded-full bg-risco-alto"
                          }
                          aria-hidden
                        />
                        {risco === "baixo" ? "Baixo" : risco === "medio" ? "Médio" : "Alto"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AREAS_SEED.map((area) => {
                  const porRisco = (nivel: Risco) =>
                    area.regras.filter((regra) => regra.risco === nivel);
                  return (
                    <tr key={area.nome} className="border-b border-border/60">
                      <td className="py-5 pr-5 align-top">
                        <span className="block text-xs font-medium">{area.nome}</span>
                        <span className="mt-1 block max-w-[13rem] text-[10px] leading-4 text-muted-foreground">
                          {area.descricao}
                        </span>
                      </td>
                      {(["baixo", "medio", "alto"] as Risco[]).map((nivel) => (
                        <td key={nivel} className="py-5 pr-5 align-top">
                          <ul className="flex flex-col gap-1">
                            {porRisco(nivel).map((regra) => (
                              <li
                                key={regra.nome}
                                className="text-[11px] leading-4 text-muted-foreground"
                              >
                                {regra.nome}
                              </li>
                            ))}
                          </ul>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Regras editáveis no painel · a extensão sincroniza a matriz a cada cinco minutos.
          </p>
        </motion.section>

        {/* 04 Como funciona */}
        <motion.section
          id="funciona"
          {...fade}
          className="scroll-mt-20 border-y border-border bg-muted/25"
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="rotulo">04 — Como funciona</p>
                <h2 className="mt-5 font-serif text-4xl leading-[1.05] tracking-tight">
                  Do campo de texto à auditoria.
                </h2>
              </div>
              <p className="max-w-xs text-xs leading-6 text-muted-foreground">
                Extensão Manifest V3 (Chrome ou Edge), servidor Flask com banco Postgres na
                nuvem (ou SQLite na máquina) e painel servido pela mesma aplicação.
              </p>
            </div>

            <div className="mt-12 grid gap-x-10 gap-y-10 border-t border-border pt-8 sm:grid-cols-2 lg:grid-cols-4">
              {ETAPAS.map((etapa) => (
                <div key={etapa.numero}>
                  <p className="tabular text-[10px] text-muted-foreground">{etapa.numero}</p>
                  <h3 className="mt-3 font-serif text-xl tracking-tight">{etapa.titulo}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{etapa.texto}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* 05 Letramento */}
        <motion.section
          id="letramento"
          {...fade}
          className="scroll-mt-20 bg-foreground text-background"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-20 lg:py-28">
            <div>
              <p className="text-[10px] font-medium tracking-[0.22em] text-background/50 uppercase">
                05 — Letramento
              </p>
              <h2 className="mt-5 max-w-xl font-serif text-4xl leading-[1.05] tracking-tight text-balance lg:text-5xl">
                “Enviou mesmo assim” é o número que importa.
              </h2>
              <p className="mt-6 max-w-lg text-sm leading-7 text-background/65">
                O painel compara envios e cancelamentos por departamento. Não para punir, mas para
                mostrar onde o aviso ainda não está funcionando — e onde o letramento precisa ser
                reforçado.
              </p>
              <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-background/15 pt-6 text-xs text-background/60">
                <span>Relatórios com filtros de data, área e nível</span>
                <span>Retenção configurável</span>
                <span>Exportação em CSV</span>
              </div>
            </div>

            <div className="lg:border-l lg:border-background/15 lg:pl-12">
              <p className="font-serif text-7xl leading-none tracking-tight">30%</p>
              <p className="mt-4 max-w-xs text-sm leading-6 text-background/65">
                de alertas em risco alto, com no mínimo três registros no departamento, indicam um
                gargalo de letramento. O limiar é configurável no painel.
              </p>
              <div className="mt-8 border-t border-background/15 pt-4">
                <p className="text-[10px] tracking-[0.18em] text-background/45 uppercase">
                  Como ler
                </p>
                <p className="mt-2 text-xs leading-6 text-background/60">
                  Muitos cancelamentos indicam que o aviso chegou antes do envio. Muitos envios em
                  risco alto indicam que o aviso precisa de contexto, treinamento ou uma
                  alternativa corporativa.
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* CTA */}
        <motion.section {...fade} className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="flex flex-col items-center border-y border-border py-16 text-center lg:py-20">
            <p className="rotulo">Painel administrativo</p>
            <h2 className="mt-5 max-w-2xl font-serif text-4xl leading-[1.05] tracking-tight text-balance lg:text-5xl">
              Comece pelo painel. Depois instale a extensão.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
              Regras, áreas, mensagens educativas, auditoria e relatórios de letramento em um só
              lugar. Entre com e-mail ou como convidado para explorar.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild className="rounded-sm">
                <Link to={destino}>
                  {isAuthenticated ? "Abrir o painel" : "Entrar no painel"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-sm">
                <Link to="/dashboard?secao=laboratorio">Testar o laboratório</Link>
              </Button>
            </div>
          </div>
        </motion.section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link to="/" className="flex items-baseline gap-2">
              <span className="font-serif text-xl tracking-tight">Sentinela</span>
              <span className="rotulo">governança de ia</span>
            </Link>
            <p className="mt-3 max-w-sm text-[11px] leading-5 text-muted-foreground">
              Painel de governança, auditoria e letramento em IA. Extensão MV3 (Chrome e Edge) +
              servidor Flask, na própria máquina ou publicado na nuvem.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-14 gap-y-6 text-[11px]">
            <div className="flex flex-col gap-2">
              <span className="rotulo">Painel</span>
              <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
                Visão geral
              </Link>
              <Link
                to="/dashboard?secao=alertas"
                className="text-muted-foreground hover:text-foreground"
              >
                Auditoria
              </Link>
              <Link
                to="/dashboard?secao=regras"
                className="text-muted-foreground hover:text-foreground"
              >
                Regras
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="rotulo">Projeto</span>
              <a href="#matriz" className="text-muted-foreground hover:text-foreground">
                Matriz de risco
              </a>
              <a href="#principio" className="text-muted-foreground hover:text-foreground">
                Princípio de privacidade
              </a>
              <Link
                to="/dashboard?secao=laboratorio"
                className="text-muted-foreground hover:text-foreground"
              >
                Laboratório
              </Link>
              <BaixarProjetoLink className="text-muted-foreground hover:text-foreground">
                Baixar projeto (.zip)
              </BaixarProjetoLink>
            </div>
            <p className="max-w-[11rem] text-[10px] leading-5 text-muted-foreground">
              Nenhum texto de conversa é armazenado neste sistema.
            </p>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-4 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>© {new Date().getFullYear()} Sentinela</span>
            <span className="tabular">Chrome/Edge MV3 · Flask · Postgres · nuvem ou local</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
