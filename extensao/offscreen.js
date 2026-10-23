/**
 * Sentinela — página offscreen.
 *
 * Recebe imagens e PDFs colados no chat, extrai o texto localmente (OCR com
 * Tesseract.js e pdf.js, ambos empacotados na extensão) e devolve o texto ao
 * service worker. Nada é enviado para a rede: os arquivos de idioma, o core do
 * OCR e o worker do PDF são carregados de dentro da própria extensão.
 */
import * as pdfjsLib from "./vendor/pdf/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "vendor/pdf/pdf.worker.min.mjs",
);

const LIMITE_CARACTERES = 80000;
const LADO_MAXIMO_OCR = 2200;
const MAXIMO_PAGINAS_PDF = 40;

let promessaWorker = null;

/** Cria (uma única vez) o worker do Tesseract com os arquivos locais. */
async function obterWorker() {
  if (!promessaWorker) {
    if (!globalThis.Tesseract || typeof globalThis.Tesseract.createWorker !== "function") {
      throw new Error("Tesseract.js não carregou.");
    }
    promessaWorker = globalThis.Tesseract.createWorker(["por", "eng"], 1, {
      workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
      corePath: chrome.runtime.getURL(
        "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
      ),
      langPath: chrome.runtime.getURL("vendor/tesseract/lang"),
      workerBlobURL: false,
      cacheMethod: "none",
      gzip: true,
      logger: () => {},
    }).catch((erro) => {
      promessaWorker = null;
      throw erro;
    });
  }
  return promessaWorker;
}

function base64ParaBytes(base64) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Reduz a imagem antes do OCR: menos pixels, mesma legibilidade. */
function prepararCanvas(bitmap) {
  const maiorLado = Math.max(bitmap.width, bitmap.height) || 1;
  const escala = Math.min(1, LADO_MAXIMO_OCR / maiorLado);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));

  const contexto = canvas.getContext("2d");
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function extrairImagem(base64, mime) {
  const bytes = base64ParaBytes(base64);
  const blob = new Blob([bytes], { type: mime || "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = prepararCanvas(bitmap);
  if (typeof bitmap.close === "function") bitmap.close();

  const worker = await obterWorker();
  const resultado = await worker.recognize(canvas);
  canvas.width = 0;
  canvas.height = 0;

  return String((resultado && resultado.data && resultado.data.text) || "").slice(
    0,
    LIMITE_CARACTERES,
  );
}

async function extrairPdf(base64) {
  const bytes = base64ParaBytes(base64);
  const documento = await pdfjsLib.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;

  const total = Math.min(documento.numPages, MAXIMO_PAGINAS_PDF);
  let texto = "";

  try {
    for (let numero = 1; numero <= total; numero++) {
      const pagina = await documento.getPage(numero);
      const conteudo = await pagina.getTextContent();
      let parte = "";

      for (const item of conteudo.items) {
        if (typeof item.str !== "string") continue;
        parte += item.str;
        parte += item.hasEOL ? "\n" : " ";
      }

      texto += parte.trim() + "\n\n";
      pagina.cleanup();

      if (texto.length >= LIMITE_CARACTERES) break;
    }
  } finally {
    await documento.destroy();
  }

  return texto.slice(0, LIMITE_CARACTERES).trim();
}

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  if (!mensagem || mensagem.tipo !== "OFFSCREEN_EXTRAIR") return false;

  (async () => {
    const anexo = mensagem.anexo || {};
    try {
      if (!anexo.dados) {
        responder({ ok: false, erro: "Anexo vazio." });
        return;
      }

      const texto =
        anexo.tipo === "pdf"
          ? await extrairPdf(anexo.dados)
          : await extrairImagem(anexo.dados, anexo.mime);

      responder({ ok: true, texto: texto });
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      console.warn("[Sentinela] falha na extração local:", detalhe);
      responder({
        ok: false,
        erro:
          anexo.tipo === "pdf"
            ? "Não foi possível ler o PDF."
            : "Não foi possível ler a imagem.",
      });
    }
  })();

  return true; // resposta assíncrona
});
