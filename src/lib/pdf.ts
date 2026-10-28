/**
 * Geração de PDF no navegador, sem bibliotecas externas.
 *
 * Escreve um PDF 1.4 (Helvetica, A4 deitado) com título, subtítulo e tabela.
 * Usado pela exportação da auditoria de alertas. Só caracteres latinos são
 * aceitos: os símbolos "—" e "·" são trocados por equivalentes simples.
 */

const LARGURA_PAGINA = 842;
const ALTURA_PAGINA = 595;
const MARGEM = 28;
const LARGURA_CONTEUDO = LARGURA_PAGINA - 2 * MARGEM;
const LINHA_ALTURA = 15;
const TAMANHO_CELULA = 7.5;
const TAMANHO_CABECALHO = 7.5;

type Cor = [number, number, number];
const COR_TEXTO: Cor = [0.11, 0.11, 0.1];
const COR_SUAVE: Cor = [0.42, 0.42, 0.4];
const COR_CABECALHO: Cor = [0.1, 0.1, 0.09];
const COR_LINHA_PAR: Cor = [0.96, 0.96, 0.94];
const COR_BORDA: Cor = [0.85, 0.85, 0.82];

export type Coluna = { titulo: string; peso: number };

function limpar(texto: string): string {
  return String(texto ?? "")
    .replace(/—/g, "-")
    .replace(/·/g, "|")
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\x20-\xFF]/g, "?");
}

function escapar(texto: string): string {
  return limpar(texto).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function larguraTexto(texto: string, tamanho: number, negrito = false): number {
  return texto.length * tamanho * (negrito ? 0.56 : 0.52);
}

function truncar(texto: string, largura: number, tamanho: number, negrito = false): string {
  const limpo = limpar(texto);
  if (larguraTexto(limpo, tamanho, negrito) <= largura) return limpo;
  const limite = Math.max(1, Math.floor(largura / (tamanho * (negrito ? 0.56 : 0.52))) - 2);
  return `${limpo.slice(0, limite).trimEnd()}…`;
}

function texto(
  x: number,
  y: number,
  conteudo: string,
  tamanho: number,
  negrito = false,
  cor: Cor = COR_TEXTO,
): string {
  const fonte = negrito ? "/F2" : "/F1";
  return `${cor[0]} ${cor[1]} ${cor[2]} rg BT ${fonte} ${tamanho} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapar(conteudo)}) Tj ET`;
}

function retangulo(x: number, y: number, largura: number, altura: number, cor: Cor): string {
  return `${cor[0]} ${cor[1]} ${cor[2]} rg ${x.toFixed(2)} ${y.toFixed(2)} ${largura.toFixed(2)} ${altura.toFixed(2)} re f`;
}

function linhaHorizontal(x: number, y: number, largura: number): string {
  return `${COR_BORDA[0]} ${COR_BORDA[1]} ${COR_BORDA[2]} RG 0.5 w ${x.toFixed(2)} ${y.toFixed(2)} m ${(x + largura).toFixed(2)} ${y.toFixed(2)} l S`;
}

/** Converte o texto do PDF (1 byte por caractere) em bytes reais. */
function bytesDoTexto(conteudo: string): Uint8Array {
  const bytes = new Uint8Array(conteudo.length);
  for (let i = 0; i < conteudo.length; i += 1) {
    const codigo = conteudo.charCodeAt(i);
    bytes[i] = codigo <= 255 ? codigo : 63;
  }
  return bytes;
}

function montarPaginas(
  titulo: string,
  subtitulo: string,
  colunas: Coluna[],
  linhas: string[][],
  nota: string,
): string[] {
  const totalPesos = colunas.reduce((soma, coluna) => soma + coluna.peso, 0) || 1;
  const larguras = colunas.map((coluna) => (LARGURA_CONTEUDO * coluna.peso) / totalPesos);
  const geradoEm = new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const paginas: string[] = [];
  let resto = [...linhas];
  let numero = 1;

  for (;;) {
    const partes: string[] = [];
    let y = ALTURA_PAGINA - MARGEM;

    partes.push(texto(MARGEM, y - 14, titulo, 15, true));
    y -= 24;
    partes.push(texto(MARGEM, y - 8, subtitulo, 8.5, false, COR_SUAVE));
    y -= 22;

    const alturaCabecalho = 17;
    partes.push(
      retangulo(MARGEM, y - alturaCabecalho, LARGURA_CONTEUDO, alturaCabecalho, COR_CABECALHO),
    );
    let x = MARGEM;
    colunas.forEach((coluna, indice) => {
      partes.push(
        texto(
          x + 5,
          y - alturaCabecalho + 5.5,
          truncar(coluna.titulo, larguras[indice] - 10, TAMANHO_CABECALHO, true),
          TAMANHO_CABECALHO,
          true,
          [1, 1, 1],
        ),
      );
      x += larguras[indice];
    });
    y -= alturaCabecalho;

    let consumidas = 0;
    for (const linha of resto) {
      if (y - LINHA_ALTURA < MARGEM + 26) break;
      consumidas += 1;
      if (consumidas % 2 === 0) {
        partes.push(retangulo(MARGEM, y - LINHA_ALTURA, LARGURA_CONTEUDO, LINHA_ALTURA, COR_LINHA_PAR));
      }
      x = MARGEM;
      linha.forEach((valor, indice) => {
        partes.push(
          texto(
            x + 5,
            y - LINHA_ALTURA + 5,
            truncar(valor, larguras[indice] - 10, TAMANHO_CELULA),
            TAMANHO_CELULA,
          ),
        );
        x += larguras[indice];
      });
      partes.push(linhaHorizontal(MARGEM, y - LINHA_ALTURA, LARGURA_CONTEUDO));
      y -= LINHA_ALTURA;
    }

    if (consumidas === 0) {
      partes.push(texto(MARGEM, y - 14, "Nenhum alerta com estes filtros.", TAMANHO_CELULA, false, COR_SUAVE));
    }

    resto = resto.slice(consumidas);

    partes.push(linhaHorizontal(MARGEM, MARGEM + 14, LARGURA_CONTEUDO));
    partes.push(
      texto(
        MARGEM,
        MARGEM,
        `Sentinela | exportacao de metadados | gerado em ${geradoEm}`,
        7,
        false,
        COR_SUAVE,
      ),
    );
    if (nota) partes.push(texto(MARGEM, MARGEM - 9, nota, 7, false, COR_SUAVE));
    const rodape = `pagina ${numero}`;
    partes.push(
      texto(
        LARGURA_PAGINA - MARGEM - larguraTexto(rodape, 7),
        MARGEM,
        rodape,
        7,
        false,
        COR_SUAVE,
      ),
    );

    paginas.push(partes.join("\n"));
    numero += 1;
    if (resto.length === 0) break;
  }

  return paginas;
}

function montarDocumento(paginas: string[]): Blob {
  const partes: Uint8Array[] = [];
  const objetos: Uint8Array[] = [];

  objetos.push(bytesDoTexto("<< /Type /Catalog /Pages 2 0 R >>"));
  const kids = paginas.map((_, indice) => `${5 + indice * 2} 0 R`).join(" ");
  objetos.push(bytesDoTexto(`<< /Type /Pages /Count ${paginas.length} /Kids [${kids}] >>`));
  objetos.push(
    bytesDoTexto("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
  );
  objetos.push(
    bytesDoTexto(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ),
  );

  paginas.forEach((conteudo, indice) => {
    const paginaId = 5 + indice * 2;
    const conteudoId = paginaId + 1;
    objetos.push(
      bytesDoTexto(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA_PAGINA} ${ALTURA_PAGINA}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${conteudoId} 0 R >>`,
      ),
    );

    const fluxo = bytesDoTexto(conteudo);
    const cabecalho = bytesDoTexto(`<< /Length ${fluxo.length} >>\nstream\n`);
    const fim = bytesDoTexto("\nendstream");
    const objeto = new Uint8Array(cabecalho.length + fluxo.length + fim.length);
    objeto.set(cabecalho, 0);
    objeto.set(fluxo, cabecalho.length);
    objeto.set(fim, cabecalho.length + fluxo.length);
    objetos.push(objeto);
  });

  partes.push(bytesDoTexto("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));

  const offsets: number[] = [];
  let tamanho = partes[0].length;
  objetos.forEach((corpo, indice) => {
    offsets.push(tamanho);
    const inicio = bytesDoTexto(`${indice + 1} 0 obj\n`);
    const fim = bytesDoTexto("\nendobj\n");
    partes.push(inicio, corpo, fim);
    tamanho += inicio.length + corpo.length + fim.length;
  });

  const inicioXref = tamanho;
  const linhasXref = [bytesDoTexto(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`)];
  let tamanhoXref = linhasXref[0].length;
  offsets.forEach((offset) => {
    const linha = bytesDoTexto(`${String(offset).padStart(10, "0")} 00000 n \n`);
    linhasXref.push(linha);
    tamanhoXref += linha.length;
  });
  linhasXref.push(
    bytesDoTexto(
      `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`,
    ),
  );

  const todos = [...partes, ...linhasXref];
  const total = todos.reduce((soma, parte) => soma + parte.length, 0);
  const saida = new Uint8Array(total);
  let posicao = 0;
  for (const parte of todos) {
    saida.set(parte, posicao);
    posicao += parte.length;
  }

  return new Blob([saida], { type: "application/pdf" });
}

export function gerarPdfTabela(params: {
  titulo: string;
  subtitulo: string;
  colunas: Coluna[];
  linhas: string[][];
  nota?: string;
}): Blob {
  return montarDocumento(
    montarPaginas(
      params.titulo,
      params.subtitulo,
      params.colunas,
      params.linhas,
      params.nota ?? "",
    ),
  );
}
