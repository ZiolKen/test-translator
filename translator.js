import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const STEP = 100;
const DIST_DIR = "dist";

/* ========== GOOGLE TRANSLATE (unofficial API) ========== */
async function translateGoogle(text, from = "auto", to = "vi") {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const data = await res.json();
  return data[0].map((t) => t[0]).join("");
}

/* ========== UTILITIES ========== */
function addLeadingZeros(num, totalLength) {
  return String(num).padStart(totalLength, "0");
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ========== PROTECT REN'PY TAGS ========== */
/**
 * Bảo vệ các tag/code Ren'Py khỏi bị dịch
 * Ví dụ: [mc], {w=0.5}, {color=#fff}, %(var)s
 */
function protectTags(text) {
  const placeholders = [];
  const protectedText = text.replace(/(\[[^\]]+\]|\{[^}]+\}|%\([^)]+\)s)/g, (match) => {
    const key = `__TAG_${placeholders.length}__`;
    placeholders.push({ key, value: match });
    return key;
  });
  return { protectedText, placeholders };
}

/**
 * Khôi phục lại tag gốc sau khi dịch
 */
function restoreTags(translatedText, placeholders) {
  let restored = translatedText;
  for (const { key, value } of placeholders) {
    restored = restored.replace(new RegExp(key, "g"), value);
  }
  return restored;
}

/* ========== EXTRACT TEXTS FOR TRANSLATION ========== */
function extractTexts(filePath) {
  const ext = path.extname(filePath);
  const raw = fs.readFileSync(filePath, "utf8");

  if (ext === ".json") {
    const obj = JSON.parse(raw);
    const texts = [];
    const walk = (o) => {
      if (typeof o === "string") {
        if (/[\u3040-\u30FF\u4E00-\u9FFF]|[A-Za-z]/.test(o)) texts.push(o);
      } else if (Array.isArray(o)) o.forEach(walk);
      else if (typeof o === "object" && o) Object.values(o).forEach(walk);
    };
    walk(obj);
    return texts;
  }

  if (ext === ".rpy") {
    const matches = raw.match(/"([^"]+)"/g) || [];
    return matches.map((m) => m.replace(/^"|"$/g, ""));
  }

  throw new Error("Unsupported file type.");
}

/* ========== AUTOMATIC TRANSLATION ========== */
export async function translateFile(filePath, from = "auto", to = "vi", onProgress = () => {}) {
  const id = path.basename(filePath, path.extname(filePath)) + "-" + uuidv4();
  const arr = extractTexts(filePath);
  ensureDir(`${DIST_DIR}/${id}`);

  let page = 0;
  const digit = Math.ceil(Math.log10(arr.length / STEP + 1));

  // Resume từ bản dịch cũ (nếu có)
  const existingFiles = fs.readdirSync(`${DIST_DIR}/${id}`).filter(f => f.endsWith(".json"));
  page = existingFiles.length;

  const result = {};
  for (const file of existingFiles) {
    Object.assign(result, JSON.parse(fs.readFileSync(`${DIST_DIR}/${id}/${file}`)));
  }

  while (page * STEP < arr.length) {
    const slice = arr.slice(page * STEP, ++page * STEP);
    const total = Math.ceil(arr.length / STEP);
    onProgress({ page, total, progress: (page / total * 100).toFixed(1) });

    console.log(`🔹 Translating batch ${page}/${total} (${slice.length} lines)`);

    // === Bảo vệ tag ===
    const protectedBatch = slice.map((text) => protectTags(text));
    const joined = protectedBatch.map((p) => p.protectedText).join("\n");

    let translated;
    try {
      translated = await translateGoogle(joined, from, to);
    } catch (err) {
      console.error("❌ Translation error:", err);
      page--;
      await new Promise(r => setTimeout(r, 5000)); // Wait and retry
      continue;
    }

    // === Khôi phục tag ===
    const translatedArr = translated.split("\n").slice(0, slice.length);
    const restoredArr = translatedArr.map((t, i) =>
      restoreTags(t, protectedBatch[i].placeholders)
    );

    const mapped = Object.fromEntries(slice.map((s, i) => [s, restoredArr[i] || ""]));

    fs.writeFileSync(
      `${DIST_DIR}/${id}/p${addLeadingZeros(page, digit)}.json`,
      JSON.stringify(mapped, null, 2)
    );

    Object.assign(result, mapped);
    fs.writeFileSync(`${DIST_DIR}/${id}-progress.json`, JSON.stringify(result, null, 2));
  }

  return { id, result };
}

/* ========== MERGE TRANSLATED TEXT BACK INTO ORIGINAL FILE ========== */
export function mergeBack(originalPath, translatedObj) {
  const ext = path.extname(originalPath);
  let raw = fs.readFileSync(originalPath, "utf8");

  if (ext === ".json") {
    let obj = JSON.parse(raw);
    const replace = (o) => {
      if (typeof o === "string") return translatedObj[o] || o;
      if (Array.isArray(o)) return o.map(replace);
      if (typeof o === "object" && o) for (let k in o) o[k] = replace(o[k]);
      return o;
    };
    obj = replace(obj);
    return JSON.stringify(obj, null, 2);
  }

  if (ext === ".rpy") {
    for (const [orig, trans] of Object.entries(translatedObj)) {
      if (!trans) continue;
      const safeOrig = orig.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      raw = raw.replace(new RegExp(`"${safeOrig}"`, "g"), `"${trans}"`);
    }
    return raw;
  }

  throw new Error("Unsupported file type.");
}

/* ========== MERGE ALL PARTS AUTOMATICALLY ========== */
/**
 * Hợp nhất toàn bộ file JSON trong thư mục dist/<id>/
 * thành một file .rpy hoàn chỉnh
 */
export function mergeAll(originalFile, id, outputFile = null) {
  const folder = `${DIST_DIR}/${id}`;
  if (!fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`);

  const jsonFiles = fs.readdirSync(folder).filter(f => f.endsWith(".json"));
  const all = {};
  for (const file of jsonFiles) {
    Object.assign(all, JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")));
  }

  const merged = mergeBack(originalFile, all);
  const outPath = outputFile || `${path.dirname(originalFile)}/${path.basename(originalFile, ".rpy")}_translated.rpy`;
  fs.writeFileSync(outPath, merged, "utf8");

  console.log(`✅ Merged file created: ${outPath}`);
  return outPath;
}
