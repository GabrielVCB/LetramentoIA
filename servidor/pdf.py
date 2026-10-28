"""
Sentinela — geração de PDF sem dependências externas.

Escreve um PDF 1.4 simples (Helvetica, A4 deitado) com título, subtítulo e uma
tabela de alertas. Nada é baixado da internet: o arquivo é montado em memória e
enviado na própria resposta HTTP.

Só é usado pela rota /api/admin/exportar.pdf, que exige sessão de administrador.
"""
from datetime import datetime

LARGURA_PAGINA = 842.0
ALTURA_PAGINA = 595.0
MARGEM = 28.0
LARGURA_CONTEUDO = LARGURA_PAGINA - 2 * MARGEM

LINHA_ALTURA = 15.0
TAMANHO_CABECALHO = 7.5
TAMANHO_CELULA = 7.5
TAMANHO_TITULO = 15
TAMANHO_SUBTITULO = 8.5

COR_TEXTO = (0.11, 0.11, 0.10)
COR_SUAVE = (0.42, 0.42, 0.40)
COR_CABECALHO = (0.10, 0.10, 0.09)
COR_LINHA_PAR = (0.96, 0.96, 0.94)
COR_BORDA = (0.85, 0.85, 0.82)


def _escapar(texto: str) -> str:
    """Escapa caracteres reservados da sintaxe de string do PDF."""
    return (
        str(texto)
        .replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def _largura_texto(texto: str, tamanho: float, negrito: bool = False) -> float:
    """Largura aproximada em pontos (suficiente para truncar células)."""
    fator = 0.56 if negrito else 0.52
    return len(str(texto)) * tamanho * fator


def _truncar(texto: str, largura: float, tamanho: float, negrito: bool = False) -> str:
    texto = "" if texto is None else str(texto)
    if _largura_texto(texto, tamanho, negrito) <= largura:
        return texto
    limite = max(1, int(largura / (tamanho * (0.56 if negrito else 0.52))) - 2)
    return texto[:limite].rstrip() + "…"


def _texto(x: float, y: float, conteudo: str, tamanho: float, negrito: bool = False,
           cor=COR_TEXTO) -> str:
    fonte = "/F2" if negrito else "/F1"
    return (
        f"{cor[0]:.3f} {cor[1]:.3f} {cor[2]:.3f} rg "
        f"BT {fonte} {tamanho} Tf {x:.2f} {y:.2f} Td ({_escapar(conteudo)}) Tj ET"
    )


def _retangulo(x: float, y: float, largura: float, altura: float, cor) -> str:
    return (
        f"{cor[0]:.3f} {cor[1]:.3f} {cor[2]:.3f} rg "
        f"{x:.2f} {y:.2f} {largura:.2f} {altura:.2f} re f"
    )


def _linha_horizontal(x: float, y: float, largura: float) -> str:
    return (
        f"{COR_BORDA[0]:.3f} {COR_BORDA[1]:.3f} {COR_BORDA[2]:.3f} RG 0.5 w "
        f"{x:.2f} {y:.2f} m {x + largura:.2f} {y:.2f} l S"
    )


def _colunas_proporcionais(colunas) -> list:
    """Converte pesos em larguras que somam a área útil da página."""
    total = sum(peso for _, peso in colunas) or 1.0
    larguras = []
    for _, peso in colunas:
        larguras.append(LARGURA_CONTEUDO * peso / total)
    return larguras


def _montar_paginas(titulo, subtitulo, colunas, linhas, nota) -> list:
    larguras = _colunas_proporcionais(colunas)
    gerado_em = datetime.now().strftime("%d/%m/%Y %H:%M")

    paginas = []
    resto = list(linhas)
    numero = 1
    while True:
        partes = []
        y = ALTURA_PAGINA - MARGEM

        partes.append(_texto(MARGEM, y - 14, titulo, TAMANHO_TITULO, True))
        y -= 24
        partes.append(
            _texto(MARGEM, y - 8, subtitulo, TAMANHO_SUBTITULO, False, COR_SUAVE)
        )
        y -= 22

        # Cabeçalho da tabela
        altura_cabecalho = 17.0
        partes.append(
            _retangulo(MARGEM, y - altura_cabecalho, LARGURA_CONTEUDO, altura_cabecalho, COR_CABECALHO)
        )
        x = MARGEM
        for indice, (nome, _peso) in enumerate(colunas):
            partes.append(
                _texto(
                    x + 5,
                    y - altura_cabecalho + 5.5,
                    _truncar(nome, larguras[indice] - 10, TAMANHO_CABECALHO, True),
                    TAMANHO_CABECALHO,
                    True,
                    (1.0, 1.0, 1.0),
                )
            )
            x += larguras[indice]
        y -= altura_cabecalho

        corpo_restante = 0
        for linha in resto:
            if y - LINHA_ALTURA < MARGEM + 26:
                break
            corpo_restante += 1
            if corpo_restante % 2 == 0:
                partes.append(
                    _retangulo(
                        MARGEM, y - LINHA_ALTURA, LARGURA_CONTEUDO, LINHA_ALTURA, COR_LINHA_PAR
                    )
                )
            x = MARGEM
            for indice, valor in enumerate(linha):
                partes.append(
                    _texto(
                        x + 5,
                        y - LINHA_ALTURA + 5,
                        _truncar(valor, larguras[indice] - 10, TAMANHO_CELULA),
                        TAMANHO_CELULA,
                    )
                )
                x += larguras[indice]
            partes.append(_linha_horizontal(MARGEM, y - LINHA_ALTURA, LARGURA_CONTEUDO))
            y -= LINHA_ALTURA

        if corpo_restante == 0:
            partes.append(
                _texto(MARGEM, y - 14, "Nenhum alerta com estes filtros.", TAMANHO_CELULA, False, COR_SUAVE)
            )

        resto = resto[corpo_restante:]

        # Rodapé
        partes.append(_linha_horizontal(MARGEM, MARGEM + 14, LARGURA_CONTEUDO))
        partes.append(
            _texto(
                MARGEM,
                MARGEM,
                "Sentinela · exportação de metadados · gerado em " + gerado_em,
                7,
                False,
                COR_SUAVE,
            )
        )
        if nota:
            partes.append(
                _texto(MARGEM, MARGEM - 9, nota, 7, False, COR_SUAVE)
            )
        numero_txt = f"página {numero}"
        partes.append(
            _texto(
                LARGURA_PAGINA - MARGEM - _largura_texto(numero_txt, 7),
                MARGEM,
                numero_txt,
                7,
                False,
                COR_SUAVE,
            )
        )

        paginas.append("\n".join(partes).encode("cp1252", "replace"))
        numero += 1
        if not resto:
            break

    return paginas


def _montar_documento(paginas: list) -> bytes:
    objetos = []
    total_paginas = len(paginas)
    # 1 catálogo, 2 páginas, 3 e 4 fontes, depois página/conteúdo alternados.
    ids_pagina = []
    for indice in range(total_paginas):
        ids_pagina.append(5 + indice * 2)

    objetos.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in ids_pagina)
    objetos.append(
        f"<< /Type /Pages /Count {total_paginas} /Kids [{kids}] >>".encode("ascii")
    )
    objetos.append(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )
    objetos.append(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    )

    for indice, conteudo in enumerate(paginas):
        pagina_id = ids_pagina[indice]
        conteudo_id = pagina_id + 1
        objetos.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {LARGURA_PAGINA:.0f} {ALTURA_PAGINA:.0f}] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                f"/Contents {conteudo_id} 0 R >>"
            ).encode("ascii")
        )
        objetos.append(
            b"<< /Length " + str(len(conteudo)).encode("ascii") + b" >>\nstream\n"
            + conteudo
            + b"\nendstream"
        )

    saida = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for numero, corpo in enumerate(objetos, start=1):
        offsets.append(len(saida))
        saida += f"{numero} 0 obj\n".encode("ascii") + corpo + b"\nendobj\n"

    inicio_xref = len(saida)
    saida += f"xref\n0 {len(objetos) + 1}\n".encode("ascii")
    saida += b"0000000000 65535 f \n"
    for offset in offsets:
        saida += f"{offset:010d} 00000 n \n".encode("ascii")
    saida += (
        f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\nstartxref\n{inicio_xref}\n%%EOF\n"
    ).encode("ascii")
    return bytes(saida)


def gerar_pdf(titulo: str, subtitulo: str, colunas, linhas, nota: str = "") -> bytes:
    """Monta o PDF completo a partir de colunas [(titulo, peso)] e linhas de texto."""
    return _montar_documento(_montar_paginas(titulo, subtitulo, colunas, linhas, nota))
