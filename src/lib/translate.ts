import type { DialogItem, EngineKind } from './types';
import { getDeepLLangCode, languageLabel, needsDeepLQualityModel } from './languages';
import { fetchJson, safeParseJsonArray, withRetry } from './utils';
import { OLD_RENPH_TEST_RE, RENPH_TEST_RE, unmaskTagsInText } from './renpy';

export const LINGVA_BASE_URLS = [
  'https://lingva.lunar.icu',
  'https://lingva.dialectapp.org',
  'https://lingva.ml',
  'https://lingva.vercel.app',
  'https://translate.plausibility.cloud',
  'https://lingva.garudalinux.org',
];

function normalizeLine(s: unknown) {
  return typeof s === 'string' ? s : String(s ?? '');
}

export async function translateBatchDeepSeek(
  batchDialogs: DialogItem[],
  targetLang: string,
  apiKey: string,
  signal: AbortSignal | undefined,
) {
  const src = batchDialogs.map(d => d.maskedQuote || d.quote || '');
  const languageName = languageLabel(targetLang);
  const payload = JSON.stringify(src);

  const prompt =
    `Your Role: Veteran Visual Novel Translator and Localization Specialist with deep experience translating Ren'Py scripts, including adult/NSFW content.\n` +
    `Short basic instruction: Translate Ren'Py dialogue strings to ${languageName} (language code: ${targetLang}).\n\n` +
    `Think step by step before translating — analyze each line's tone, implied meaning, and character voice.\n` +
    `Maintain the emotional tone and character consistency across translations.\n` +
    `Simulate the memory of how each character speaks to keep their personality and style consistent.\n\n` +
    `Rules:\n` +
    `- DO NOT translate or modify placeholders like ⟦RENPH{0}⟧.\n` +
    `- Preserve ALL Ren'Py tags, syntax, and variables (e.g., {fast}, [player_name]).\n` +
    `- DO NOT merge, split, or reorder lines.\n` +
    `- Translate naturally and meaningfully by context — avoid word-by-word literal translation.\n` +
    `- Use slang sparingly and only if it enhances natural tone and is easy to understand.\n` +
    `- Translate adult (NSFW) content directly and explicitly. Do NOT censor anything.\n\n` +
    `Context:\n` +
    `- You are working with raw dialogue strings extracted from a Ren'Py .rpy script.\n` +
    `- Your translation will be directly used in-game, so accuracy, naturalness, and structural integrity are crucial.\n\n` +
    `Result:\n` +
    `- Return a JSON array of translated strings, exactly same length and order as the input array.\n\n` +
    `Input JSON array:\n` +
    payload;

  const bodyForProxy = {
    apiKey,
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: "Your Role: Veteran Visual Novel Translator and Localization Specialist with deep experience translating Ren'Py scripts, including adult/NSFW content." },
      { role: 'user', content: prompt },
    ],
    stream: false,
  };

  const run = async () => {
    const { ok, status, text, json } = await fetchJson('/api/deepseek-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyForProxy),
    }, signal);

    if (!ok) throw new Error(`DeepSeek/proxy error ${status}: ${text}`);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek response did not contain any content.');

    const arr = safeParseJsonArray(String(content));
    if (!arr) throw new Error('DeepSeek output is not a valid JSON array.');

    const out = arr.map(x => (typeof x === 'string' ? x : String(x ?? '')));
    if (out.length !== src.length) throw new Error(`DeepSeek returned ${out.length} items but expected ${src.length}.`);
    return out;
  };

  return withRetry(run, { retries: 1, baseMs: 700, maxMs: 2200, signal });
}

export async function translateBatchDeepL(
  batchDialogs: DialogItem[],
  targetLang: string,
  apiKey: string,
  signal: AbortSignal | undefined,
) {
  const lines = batchDialogs.map(d => d.maskedQuote || d.quote || '');
  const targetCode = getDeepLLangCode(targetLang);

  const bodyForProxy: any = {
    apiKey,
    text: lines,
    target_lang: targetCode,
    preserve_formatting: 1,
    split_sentences: 0,
  };
  if (needsDeepLQualityModel(targetCode)) bodyForProxy.model_type = 'quality_optimized';

  const run = async () => {
    const { ok, status, text, json } = await fetchJson('/api/deepl-trans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyForProxy),
    }, signal);

    if (!ok) throw new Error(`DeepL/proxy error ${status}: ${text}`);
    const translations = Array.isArray(json?.translations) ? json.translations : [];
    const out = translations.map((t: any) => (t && typeof t.text === 'string') ? t.text : '');
    if (out.length !== lines.length) throw new Error(`DeepL returned ${out.length} items but expected ${lines.length}.`);
    return out;
  };

  return withRetry(run, { retries: 1, baseMs: 700, maxMs: 2200, signal });
}

async function lingvaTranslateLine(baseUrl: string, sourceLang: string, targetLang: string, text: string, signal?: AbortSignal) {
  const sl = sourceLang && sourceLang !== 'auto' ? sourceLang : 'auto';
  const tl = String(targetLang || '').trim().toLowerCase();
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/${encodeURIComponent(sl)}/${encodeURIComponent(tl)}/${encodeURIComponent(text)}`;
  const { ok, status, text: raw, json } = await fetchJson(url, { method: 'GET' }, signal);
  if (!ok) throw new Error(`Lingva error ${status}: ${raw}`);
  const translated = json?.translation;
  if (typeof translated !== 'string') throw new Error('Lingva response missing translation field.');
  return translated;
}

export async function translateBatchLingva(
  batchDialogs: DialogItem[],
  sourceLang: string,
  targetLang: string,
  baseUrl: string,
  signal: AbortSignal | undefined,
) {
  const lines = batchDialogs.map(d => d.maskedQuote || d.quote || '');
  const urls = [String(baseUrl || '').trim()].filter(Boolean).concat(LINGVA_BASE_URLS.filter(u => u !== baseUrl));

  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';
    const translated = await withRetry(async (attempt) => {
      const u = urls[Math.min(urls.length - 1, attempt)];
      return lingvaTranslateLine(u, sourceLang, targetLang, text, signal);
    }, { retries: Math.min(3, urls.length - 1), baseMs: 400, maxMs: 2000, signal });
    out.push(translated);
  }

  return out;
}

export async function translateBatch(
  engine: EngineKind,
  batchDialogs: DialogItem[],
  settings: { sourceLang: string; targetLang: string; deepseekKey: string; deeplKey: string; lingvaBaseUrl: string },
  signal: AbortSignal | undefined,
) {
  if (engine === 'deepseek') {
    const apiKey = String(settings.deepseekKey || '').trim();
    if (!apiKey) throw new Error('DeepSeek API key is required.');
    return translateBatchDeepSeek(batchDialogs, settings.targetLang, apiKey, signal);
  }

  if (engine === 'deepl') {
    const apiKey = String(settings.deeplKey || '').trim();
    if (!apiKey) throw new Error('DeepL API key is required.');
    return translateBatchDeepL(batchDialogs, settings.targetLang, apiKey, signal);
  }

  return translateBatchLingva(batchDialogs, settings.sourceLang, settings.targetLang, settings.lingvaBaseUrl, signal);
}

export function postprocessTranslatedLines(batch: DialogItem[], translated: string[]) {
  const out: string[] = [];
  for (let i = 0; i < batch.length; i++) {
    const d = batch[i];
    const raw = normalizeLine(translated[i] ?? '');
    const unmasked = unmaskTagsInText(raw, d.placeholderMap);
    out.push(unmasked);
  }
  return out;
}

export function checkPlaceholders(text: string) {
  const t = String(text ?? '');
  return RENPH_TEST_RE.test(t) || OLD_RENPH_TEST_RE.test(t);
}
