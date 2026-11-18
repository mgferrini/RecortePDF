import { labelSizeMm } from "./crop.mjs";
import { activePdfTab, cropOpenTab, readSettings, writeSettings } from "./tab.mjs";

const fileLine = document.querySelector("#file");
const message = document.querySelector("#message");
const cropButton = document.querySelector("#crop");
const xInput = document.querySelector("#x");
const yInput = document.querySelector("#y");

let settings = await readSettings();
let tab = null;

paint();
tab = await activePdfTab();
fileLine.textContent = describe(tab);
cropButton.disabled = !canCrop(tab);

cropButton.addEventListener("click", async () => {
  cropButton.disabled = true;
  hideMessage();
  cropButton.textContent = "Recortando…";
  try {
    const result = await cropOpenTab(tab, settings);
    const skipped = result.skipped.length
      ? ` Dejé afuera ${result.skipped.length} ${result.skipped.length === 1 ? "página" : "páginas"}.`
      : "";
    fileLine.textContent = `Listo: ${result.filename}. ${result.pageCount} ${result.pageCount === 1 ? "etiqueta" : "etiquetas"}.${skipped}`;
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "No pude recortar el PDF.");
  } finally {
    cropButton.disabled = !canCrop(tab);
    cropButton.textContent = "Recortar y descargar";
  }
});

document.querySelectorAll("[data-anchor]").forEach((button) => {
  button.addEventListener("click", async () => {
    settings = await writeSettings({ ...settings, anchor: button.dataset.anchor });
    paint();
  });
});

document.querySelectorAll("[data-landscape]").forEach((button) => {
  button.addEventListener("click", async () => {
    settings = await writeSettings({ ...settings, landscape: button.dataset.landscape === "true" });
    paint();
  });
});

for (const input of [xInput, yInput]) {
  input.addEventListener("change", async () => {
    const x = parseMm(xInput.value);
    const y = parseMm(yInput.value);
    if (x == null || y == null) {
      paint();
      return;
    }
    settings = await writeSettings({ ...settings, anchor: "custom", customXmm: x, customYmm: y });
    paint();
  });
}

function paint() {
  document.querySelectorAll("[data-anchor]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.anchor === settings.anchor));
  });
  document.querySelectorAll("[data-landscape]").forEach((button) => {
    const selected = (button.dataset.landscape === "true") === settings.landscape;
    button.setAttribute("aria-pressed", String(selected));
  });
  const size = labelSizeMm(settings.landscape);
  if (document.activeElement !== xInput) {
    xInput.value = settings.anchor === "custom" ? formatMm(settings.customXmm) : settings.anchor === "top-left" ? "0" : "";
  }
  if (document.activeElement !== yInput) {
    yInput.value = settings.anchor === "custom" ? formatMm(settings.customYmm) : settings.anchor === "top-left" ? "0" : "";
  }
  xInput.placeholder = settings.anchor === "top-left" || settings.anchor === "custom" ? "" : "auto";
  yInput.placeholder = settings.anchor === "top-left" || settings.anchor === "custom" ? "" : "auto";
  document.querySelector(".note").textContent =
    `El original no se toca. Imprimí el archivo nuevo en papel ${formatMm(size.widthMm)} × ${formatMm(size.heightMm)} mm, escala 100 %, sin ajustar a la página. La posición queda guardada en este Chrome.`;
}

function describe(current) {
  if (!current?.url || /^(chrome|chrome-untrusted|edge|about|devtools):/i.test(current.url)) {
    return "Abrí el PDF de la etiqueta en Chrome y volvé a tocar el ícono.";
  }
  let name = "esta pestaña";
  try {
    name = decodeURIComponent(new URL(current.url).pathname.split("/").pop() || name);
  } catch {
    /* keep the generic label */
  }
  return name || "PDF abierto";
}

function canCrop(current) {
  return Boolean(current?.url) && !/^(chrome|chrome-untrusted|edge|about|devtools):/i.test(current.url);
}

function showMessage(text) {
  message.hidden = false;
  message.textContent = text;
}

function hideMessage() {
  message.hidden = true;
  message.textContent = "";
}

function parseMm(raw) {
  const value = Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function formatMm(value) {
  const rounded = Math.round(value * 10) / 10;
  return Math.abs(rounded - Math.round(rounded)) < 0.05 ? String(Math.round(rounded)) : rounded.toFixed(1);
}
