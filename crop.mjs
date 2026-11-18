import { PDFDocument, degrees } from "./vendor/pdf-lib.esm.min.js";

const PT_PER_MM = 72 / 25.4;
const SLACK_MM = 0.6;

export const defaultSettings = {
  anchor: "top-left",
  customXmm: 0,
  customYmm: 0,
  landscape: false,
};

export function mmToPt(mm) {
  return mm * PT_PER_MM;
}

export function ptToMm(pt) {
  return pt / PT_PER_MM;
}

export function sanitizeSettings(value) {
  const raw = value && typeof value === "object" ? value : {};
  const anchors = ["top-left", "top-center", "center", "custom"];
  return {
    anchor: anchors.includes(raw.anchor) ? raw.anchor : "top-left",
    customXmm: finite(raw.customXmm, 0),
    customYmm: finite(raw.customYmm, 0),
    landscape: raw.landscape === true,
  };
}

export function labelSizeMm(landscape) {
  return landscape ? { widthMm: 150, heightMm: 100 } : { widthMm: 100, heightMm: 150 };
}

export function resolveCrop(pageWidthMm, pageHeightMm, settings) {
  let { widthMm, heightMm } = labelSizeMm(settings.landscape);
  if (pageWidthMm + SLACK_MM < widthMm || pageHeightMm + SLACK_MM < heightMm) return null;
  widthMm = Math.min(widthMm, pageWidthMm);
  heightMm = Math.min(heightMm, pageHeightMm);

  let x = 0;
  let y = 0;
  if (settings.anchor === "top-center") x = (pageWidthMm - widthMm) / 2;
  else if (settings.anchor === "center") {
    x = (pageWidthMm - widthMm) / 2;
    y = (pageHeightMm - heightMm) / 2;
  } else if (settings.anchor === "custom") {
    x = settings.customXmm;
    y = settings.customYmm;
  }

  return {
    xMm: clamp(x, 0, Math.max(0, pageWidthMm - widthMm)),
    yMm: clamp(y, 0, Math.max(0, pageHeightMm - heightMm)),
    widthMm,
    heightMm,
  };
}

export function outputFilename(name, landscape) {
  const suffix = landscape ? "15x10" : "10x15";
  const base = String(name || "etiqueta")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim();
  return `${base || "etiqueta"}-${suffix}.pdf`;
}

export function filenameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    if (last.toLowerCase().endsWith(".pdf")) return last;
  } catch {
    /* the tab url is not a normal address */
  }
  return "etiqueta.pdf";
}

/** Crop every page to 10×15 without scaling the drawing. */
export async function cropPdf(bytes, settings) {
  const safe = sanitizeSettings(settings);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  const skipped = [];
  const pages = src.getPages();

  for (let index = 0; index < pages.length; index += 1) {
    const srcPage = pages[index];
    const view = viewFromPage(srcPage);
    const widthMm = ptToMm(view.width);
    const heightMm = ptToMm(view.height);
    const crop = resolveCrop(widthMm, heightMm, safe);
    if (!crop) {
      skipped.push({ page: index + 1, widthMm, heightMm, reason: "too-small" });
      continue;
    }

    const targetW = mmToPt(crop.widthMm);
    const targetH = mmToPt(crop.heightMm);
    const box = visualBox(view, mmToPt(crop.xMm), mmToPt(crop.yMm), targetW, targetH);
    try {
      const embedded = await out.embedPage(srcPage, box);
      const page = out.addPage([targetW, targetH]);
      const placed = placement(view.rotation, targetW, targetH);
      const swap = placed.rotate === 90 || placed.rotate === -90;
      page.drawPage(embedded, {
        x: placed.x,
        y: placed.y,
        width: swap ? targetH : targetW,
        height: swap ? targetW : targetH,
        rotate: degrees(placed.rotate),
      });
    } catch (error) {
      if (!isEmptyPage(error)) throw error;
      skipped.push({ page: index + 1, widthMm, heightMm, reason: "empty" });
    }
  }

  if (out.getPageCount() === 0) return { bytes: null, skipped, pageCount: 0 };
  return { bytes: await out.save(), skipped, pageCount: out.getPageCount() };
}

export function viewFromPage(page) {
  const box = page.getCropBox();
  const viewBox = [box.x, box.y, box.x + box.width, box.y + box.height];
  const rotation = normalize(page.getRotation().angle);
  const built = viewportOf(viewBox, rotation);
  return {
    width: built.width,
    height: built.height,
    rotation,
    convertToPdfPoint(x, y) {
      return inversePoint(built.transform, x, y);
    },
  };
}

function viewportOf(viewBox, rotation) {
  const scale = 1;
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  let rotateA;
  let rotateB;
  let rotateC;
  let rotateD;
  if (rotation === 180) {
    rotateA = -1;
    rotateB = 0;
    rotateC = 0;
    rotateD = 1;
  } else if (rotation === 90) {
    rotateA = 0;
    rotateB = 1;
    rotateC = 1;
    rotateD = 0;
  } else if (rotation === 270) {
    rotateA = 0;
    rotateB = -1;
    rotateC = -1;
    rotateD = 0;
  } else {
    rotateA = 1;
    rotateB = 0;
    rotateC = 0;
    rotateD = -1;
  }

  let offsetCanvasX;
  let offsetCanvasY;
  let width;
  let height;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale;
    offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale;
    width = (viewBox[3] - viewBox[1]) * scale;
    height = (viewBox[2] - viewBox[0]) * scale;
  } else {
    offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale;
    offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale;
    width = (viewBox[2] - viewBox[0]) * scale;
    height = (viewBox[3] - viewBox[1]) * scale;
  }

  return {
    width,
    height,
    transform: [
      rotateA * scale,
      rotateB * scale,
      rotateC * scale,
      rotateD * scale,
      offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
      offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
    ],
  };
}

function inversePoint(m, x, y) {
  const d = m[0] * m[3] - m[1] * m[2];
  return [
    (x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / d,
    (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / d,
  ];
}

function visualBox(view, x, y, w, h) {
  const corners = [
    view.convertToPdfPoint(x, y),
    view.convertToPdfPoint(x + w, y),
    view.convertToPdfPoint(x, y + h),
    view.convertToPdfPoint(x + w, y + h),
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return {
    left: Math.min(...xs),
    bottom: Math.min(...ys),
    right: Math.max(...xs),
    top: Math.max(...ys),
  };
}

function placement(rotation, pageW, pageH) {
  if (rotation === 90) return { x: 0, y: pageH, rotate: -90 };
  if (rotation === 180) return { x: pageW, y: pageH, rotate: 180 };
  if (rotation === 270) return { x: pageW, y: 0, rotate: 90 };
  return { x: 0, y: 0, rotate: 0 };
}

function normalize(rotation) {
  const turns = ((Math.round(rotation) % 360) + 360) % 360;
  return turns === 90 || turns === 180 || turns === 270 ? turns : 0;
}

function isEmptyPage(error) {
  return error instanceof Error && error.message.includes("missing Contents");
}

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
