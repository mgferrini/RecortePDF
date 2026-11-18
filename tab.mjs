import { cropPdf, filenameFromUrl, outputFilename, sanitizeSettings } from "./crop.mjs";

const STORAGE_KEY = "corte";

export async function readSettings() {
  const local = await chrome.storage.local.get(STORAGE_KEY);
  if (local[STORAGE_KEY]) return sanitizeSettings(local[STORAGE_KEY]);
  try {
    const synced = await chrome.storage.sync.get(STORAGE_KEY);
    if (synced[STORAGE_KEY]) return sanitizeSettings(synced[STORAGE_KEY]);
  } catch {
    /* sync is unavailable when Chrome is not signed in */
  }
  return sanitizeSettings(null);
}

export async function writeSettings(settings) {
  const safe = sanitizeSettings(settings);
  await chrome.storage.local.set({ [STORAGE_KEY]: safe });
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: safe });
  } catch {
    /* the local copy is enough on this PC */
  }
  return safe;
}

export async function activePdfTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && !isExtensionPage(active.url)) return active;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.find((tab) => tab.url && !isExtensionPage(tab.url)) || active || null;
}

export async function cropOpenTab(tab, settings) {
  if (!tab?.url) throw friendly("Abrí el PDF en Chrome y volvé a tocar el ícono.", "not-pdf");
  if (isBlocked(tab.url)) throw friendly("Esta pestaña no es un PDF.", "not-pdf");

  let response;
  try {
    response = await fetch(tab.url);
  } catch {
    throw friendly(accessMessage(tab.url), tab.url.startsWith("file:") ? "file-access" : "not-pdf");
  }
  if (!response.ok) throw friendly("No pude leer el PDF de esta pestaña.", "not-pdf");

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isPdf(bytes)) throw friendly("Lo que está abierto no es un PDF.", "not-pdf");

  let result;
  try {
    result = await cropPdf(bytes, settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt|password/i.test(message)) {
      throw friendly("Este PDF tiene contraseña. Quitásela y volvé a abrirlo.", "password");
    }
    throw friendly("No pude recortar este PDF.", "not-pdf");
  }

  if (!result.bytes) {
    throw friendly("Ninguna página entra en 10×15 cm.", "empty");
  }

  const filename = outputFilename(filenameFromUrl(tab.url), settings.landscape);
  await downloadPdf(result.bytes, filename);
  return { filename, pageCount: result.pageCount, skipped: result.skipped };
}

async function downloadPdf(bytes, filename) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }
}

function isPdf(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

function isExtensionPage(url) {
  return !url || url.startsWith("chrome-extension://");
}

function isBlocked(url) {
  return /^(chrome|chrome-untrusted|edge|about|devtools):/i.test(url);
}

function accessMessage(url) {
  if (url.startsWith("file:")) {
    return "El PDF está en el disco. En chrome://extensions, Detalles de Corte 10×15, activá “Permitir acceso a URLs de archivo”.";
  }
  if (url.startsWith("blob:")) {
    return "Este PDF está abierto como archivo temporal. Bajalo, abrilo en Chrome y volvé a tocar el ícono.";
  }
  return "No pude leer el PDF de esta pestaña.";
}

function friendly(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
