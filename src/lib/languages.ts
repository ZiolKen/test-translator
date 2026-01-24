export type Lang = { code: string; name: string; deepl?: string };

export const LANGUAGES: Lang[] = [
  { code: 'en', name: 'English', deepl: 'EN' },
  { code: 'zh', name: 'Chinese (Simplified)', deepl: 'ZH' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish', deepl: 'ES' },
  { code: 'fr', name: 'French', deepl: 'FR' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese', deepl: 'PT-PT' },
  { code: 'ru', name: 'Russian' },
  { code: 'de', name: 'German', deepl: 'DE' },
  { code: 'ja', name: 'Japanese', deepl: 'JA' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'tl', name: 'Filipino' },
  { code: 'ko', name: 'Korean', deepl: 'KO' },
];

export function languageLabel(code: string) {
  const c = String(code || '').trim().toLowerCase();
  return LANGUAGES.find(x => x.code.toLowerCase() === c)?.name || code;
}

export function getDeepLLangCode(code: string) {
  const c = String(code || '').trim().toLowerCase();
  const v = LANGUAGES.find(x => x.code.toLowerCase() === c)?.deepl;
  if (!v) throw new Error(`DeepL does not support target language: ${languageLabel(code)}.`);
  return v;
}

export function isDeepLSupportedTarget(code: string) {
  const c = String(code || '').trim().toLowerCase();
  return !!LANGUAGES.find(x => x.code.toLowerCase() === c)?.deepl;
}

export function needsDeepLQualityModel(targetCode: string) {
  const t = String(targetCode || '').toUpperCase();
  return t === 'JA' || t === 'ZH' || t === 'KO';
}
