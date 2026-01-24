import { create } from 'zustand';
import type { DialogItem, EngineKind, ExtractMode, FileItem, LogLevel, Project, ProjectSettings, TranslationMemoryEntry } from '../lib/types';
import { uid } from '../lib/utils';
import { TRANSLATOR_CREDIT, applyTranslations, extractDialogs } from '../lib/renpy';
import { checkPlaceholders, postprocessTranslatedLines, translateBatch } from '../lib/translate';
import { makeZip, downloadBlob } from '../lib/zip';
import { db } from './db';

type Progress = { running: boolean; total: number; done: number; label: string };

type Keys = { deepseekKey: string; deeplKey: string };

function loadKeys(): Keys {
  return {
    deepseekKey: localStorage.getItem('vnrpy_deepseekKey') || '',
    deeplKey: localStorage.getItem('vnrpy_deeplKey') || '',
  };
}

function saveKeys(k: Keys) {
  localStorage.setItem('vnrpy_deepseekKey', k.deepseekKey || '');
  localStorage.setItem('vnrpy_deeplKey', k.deeplKey || '');
}

function defaultSettings(): ProjectSettings {
  return {
    mode: 'safe',
    targetLang: 'vi',
    sourceLang: 'auto',
    engine: 'deepseek',
    batchSize: 20,
    concurrency: 1,
    lingvaBaseUrl: 'https://lingva.lunar.icu',
    tmEnabled: true,
    tmAutoAdd: true,
  };
}

function now() { return Date.now(); }

function normalizeSettings(s: any): ProjectSettings {
  const d = defaultSettings();
  const v = (s && typeof s === 'object') ? s : {};
  return {
    mode: (v.mode === 'balanced' || v.mode === 'aggressive') ? v.mode : (v.mode === 'safe' ? 'safe' : d.mode),
    targetLang: String(v.targetLang || d.targetLang),
    sourceLang: String(v.sourceLang || d.sourceLang),
    engine: (v.engine === 'deepl' || v.engine === 'lingva') ? v.engine : d.engine,
    batchSize: Number.isFinite(Number(v.batchSize)) ? Math.max(1, Math.min(60, Math.floor(Number(v.batchSize)))) : d.batchSize,
    concurrency: Number.isFinite(Number(v.concurrency)) ? Math.max(1, Math.min(6, Math.floor(Number(v.concurrency)))) : d.concurrency,
    lingvaBaseUrl: String(v.lingvaBaseUrl || d.lingvaBaseUrl),
    tmEnabled: v.tmEnabled === false ? false : d.tmEnabled,
    tmAutoAdd: v.tmAutoAdd === false ? false : d.tmAutoAdd,
  };
}

async function loadRecentLogs(projectId: string) {
  const rows = await db.logs.where('projectId').equals(projectId).reverse().sortBy('ts');
  return rows.slice(0, 300).reverse();
}

function logLine(level: LogLevel, msg: string) {
  const ts = new Date().toLocaleTimeString();
  const tag = level === 'error' ? 'ERROR' : (level === 'warn' ? 'WARN ' : 'INFO ');
  return `[${ts}] ${tag} ${msg}`;
}

function tmKey(targetLang: string, sourceKey: string) {
  return `${String(targetLang || '').trim().toLowerCase()}::${String(sourceKey || '').trim()}`;
}

function dialogSourceKey(d: Pick<DialogItem, 'cacheKey'|'maskedQuote'|'quote'>) {
  const k = String(d.cacheKey || d.maskedQuote || d.quote || '').trim();
  return k;
}

async function ensureProject(): Promise<Project> {
  const all = await db.projects.toArray();
  if (all.length) {
    const p = all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const next = { ...p, settings: normalizeSettings(p.settings) };
    if (JSON.stringify(next.settings) !== JSON.stringify(p.settings)) {
      next.updatedAt = now();
      await db.projects.put(next);
      return next;
    }
    return p;
  }

  const p: Project = {
    id: uid('proj'),
    name: 'Untitled Project',
    createdAt: now(),
    updatedAt: now(),
    settings: defaultSettings(),
  };
  await db.projects.add(p);
  return p;
}

export type AppState = {
  ready: boolean;
  projects: Project[];
  currentProjectId: string | null;
  currentFileId: string | null;
  files: FileItem[];
  dialogs: DialogItem[];
  filter: string;
  showUntranslatedOnly: boolean;
  selected: Record<string, boolean>;
  progress: Progress;
  logs: string;
  keys: Keys;
  lingvaBaseUrl: string;
  tmCount: number;

  init: () => Promise<void>;
  setFilter: (v: string) => void;
  setShowUntranslatedOnly: (v: boolean) => void;
  toggleSelect: (dialogId: string) => void;
  clearSelection: () => void;

  setMode: (mode: ExtractMode) => Promise<void>;
  setEngine: (engine: EngineKind) => Promise<void>;
  setLangs: (sourceLang: string, targetLang: string) => Promise<void>;
  setBatchSize: (n: number) => Promise<void>;
  setTMEnabled: (v: boolean) => Promise<void>;
  setTMAutoAdd: (v: boolean) => Promise<void>;

  setKeys: (deepseekKey: string, deeplKey: string) => void;
  setLingvaBaseUrl: (url: string) => Promise<void>;

  importLocalFiles: (files: FileList | File[]) => Promise<void>;
  setCurrentFile: (fileId: string) => Promise<void>;

  updateTranslation: (dialogId: string, text: string) => Promise<void>;
  bulkUpdateTranslations: (updates: Array<{ id: string; text: string }>) => Promise<number>;
  copyOriginalToTranslation: (dialogId: string) => Promise<void>;
  translateScope: (scope: 'all' | 'filtered' | 'selected' | 'missing') => Promise<void>;
  cancelTranslate: () => void;

  applyTMToCurrentFile: (mode: 'missing' | 'all') => Promise<number>;
  listTM: (q: string, limit: number, targetLang: string | null) => Promise<TranslationMemoryEntry[]>;
  deleteTM: (key: string) => Promise<void>;
  clearTM: () => Promise<void>;
  exportTM: () => Promise<void>;
  importTM: (files: FileList | File[]) => Promise<void>;

  exportZip: () => Promise<void>;
  exportCurrentFile: () => Promise<void>;
  resetProject: () => Promise<void>;
};

let activeAbort: AbortController | null = null;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  projects: [],
  currentProjectId: null,
  currentFileId: null,
  files: [],
  dialogs: [],
  filter: '',
  showUntranslatedOnly: false,
  selected: {},
  progress: { running: false, total: 0, done: 0, label: '' },
  logs: '',
  keys: loadKeys(),
  lingvaBaseUrl: defaultSettings().lingvaBaseUrl,
  tmCount: 0,

  init: async () => {
    const p = await ensureProject();
    const projects = await db.projects.toArray();
    const files = await db.files.where('projectId').equals(p.id).sortBy('name');
    const currentFileId = files[0]?.id ?? null;
    const dialogs = currentFileId ? await db.dialogs.where('fileId').equals(currentFileId).sortBy('idx') : [];
    const logs = (await loadRecentLogs(p.id)).map(x => logLine(x.level, x.message)).join('\n');
    const tmCount = await db.tm.count();
    set({
      ready: true,
      projects: projects.sort((a, b) => b.updatedAt - a.updatedAt),
      currentProjectId: p.id,
      files,
      currentFileId,
      dialogs,
      lingvaBaseUrl: p.settings.lingvaBaseUrl,
      logs,
      tmCount,
    });
  },

  setFilter: (v) => set({ filter: v }),
  setShowUntranslatedOnly: (v) => set({ showUntranslatedOnly: v }),

  toggleSelect: (dialogId) => {
    const s = { ...get().selected };
    s[dialogId] = !s[dialogId];
    if (!s[dialogId]) delete s[dialogId];
    set({ selected: s });
  },

  clearSelection: () => set({ selected: {} }),

  setKeys: (deepseekKey, deeplKey) => {
    const next = { deepseekKey: deepseekKey || '', deeplKey: deeplKey || '' };
    saveKeys(next);
    set({ keys: next });
  },

  setMode: async (mode) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, mode });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ projects: (await db.projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  setEngine: async (engine) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, engine });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ projects: (await db.projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  setLangs: async (sourceLang, targetLang) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, sourceLang, targetLang });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ projects: (await db.projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  setBatchSize: async (n) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, batchSize: n });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ projects: (await db.projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  setTMEnabled: async (v) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, tmEnabled: !!v });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ projects: (await db.projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  setTMAutoAdd: async (v) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, tmAutoAdd: !!v });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ projects: (await db.projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  setLingvaBaseUrl: async (url) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings({ ...p.settings, lingvaBaseUrl: String(url || '').trim() });
    p.updatedAt = now();
    await db.projects.put(p);
    set({ lingvaBaseUrl: p.settings.lingvaBaseUrl });
  },

  importLocalFiles: async (fileList) => {
    const pid = get().currentProjectId;
    if (!pid) return;

    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings(p.settings);

    const arr: File[] = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (!arr.length) return;

    const imported: string[] = [];

    for (const f of arr) {
      const name = f.name || 'script.rpy';
      if (!name.toLowerCase().endsWith('.rpy')) continue;

      const text = await f.text();
      const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
      const extracted = extractDialogs(text, p.settings.mode);

      const fileId = uid('file');
      const fileRow: FileItem = {
        id: fileId,
        projectId: pid,
        name,
        path: String((f as any).webkitRelativePath || name),
        createdAt: now(),
        updatedAt: now(),
        sourceText: text,
        eol,
        dialogCount: extracted.length,
      };

      await db.transaction('rw', db.files, db.dialogs, db.tm, async () => {
        await db.files.add(fileRow);

        const rows: DialogItem[] = extracted.map((d, idx) => ({
          id: `${fileId}:${idx}`,
          fileId,
          idx,
          lineIndex: d.lineIndex,
          contentStart: d.contentStart,
          contentEnd: d.contentEnd,
          quoteChar: d.quoteChar,
          isTriple: d.isTriple,
          quote: d.quote,
          maskedQuote: d.maskedQuote,
          placeholderMap: d.placeholderMap,
          cacheKey: d.cacheKey,
          translated: null,
          updatedAt: now(),
        }));

        if (p.settings.tmEnabled && rows.length) {
          const keys = rows.map(r => tmKey(p.settings.targetLang, dialogSourceKey(r)));
          const hits = await db.tm.bulkGet(keys);
          for (let i = 0; i < rows.length; i++) {
            const h = hits[i];
            if (h?.translatedText) rows[i].translated = h.translatedText;
          }
        }

        await db.dialogs.bulkAdd(rows);
      });

      imported.push(fileId);
    }

    if (!imported.length) return;

    p.updatedAt = now();
    await db.projects.put(p);

    const files = await db.files.where('projectId').equals(pid).sortBy('name');
    const currentFileId = get().currentFileId || files[0]?.id || null;
    const dialogs = currentFileId ? await db.dialogs.where('fileId').equals(currentFileId).sortBy('idx') : [];
    set({ files, currentFileId, dialogs });
    get().clearSelection();
  },

  setCurrentFile: async (fileId) => {
    const dialogs = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
    set({ currentFileId: fileId, dialogs });
    get().clearSelection();
  },

  updateTranslation: async (dialogId, text) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings(p.settings);

    const row = await db.dialogs.get(dialogId);
    if (!row) return;

    const nextText = String(text ?? '');
    row.translated = nextText;
    row.updatedAt = now();

    await db.transaction('rw', db.dialogs, db.tm, async () => {
      await db.dialogs.put(row);

      if (p.settings.tmEnabled && p.settings.tmAutoAdd && nextText.trim()) {
        const sk = dialogSourceKey(row);
        const k = tmKey(p.settings.targetLang, sk);
        const ex = await db.tm.get(k);
        const entry: TranslationMemoryEntry = ex ? {
          ...ex,
          translatedText: nextText,
          sourceText: row.quote,
          updatedAt: now(),
        } : {
          key: k,
          targetLang: String(p.settings.targetLang).trim().toLowerCase(),
          sourceKey: sk,
          sourceText: row.quote,
          translatedText: nextText,
          createdAt: now(),
          updatedAt: now(),
          useCount: 0,
        };
        await db.tm.put(entry);
      }
    });

    set({ dialogs: get().dialogs.map(d => d.id === dialogId ? { ...d, translated: nextText, updatedAt: row.updatedAt } : d) });
    const tmCount = await db.tm.count();
    set({ tmCount });
  },

  bulkUpdateTranslations: async (updates) => {
    const pid = get().currentProjectId;
    const fileId = get().currentFileId;
    if (!pid || !fileId) return 0;
    const p = await db.projects.get(pid);
    if (!p) return 0;
    const settings = normalizeSettings(p.settings);
    const cleaned = (Array.isArray(updates) ? updates : []).map(u => ({ id: String((u as any)?.id || ""), text: String((u as any)?.text ?? "") })).filter(u => u.id);
    if (!cleaned.length) return 0;
    const touched = now();

    await db.transaction("rw", db.dialogs, db.tm, async () => {
      for (const u of cleaned) {
        const row = await db.dialogs.get(u.id);
        if (!row) continue;
        row.translated = u.text;
        row.updatedAt = touched;
        await db.dialogs.put(row);
        if (settings.tmEnabled && settings.tmAutoAdd && u.text.trim()) {
          const sk = dialogSourceKey(row);
          const k = tmKey(settings.targetLang, sk);
          const ex = await db.tm.get(k);
          const entry: TranslationMemoryEntry = ex ? { ...ex, translatedText: u.text, sourceText: row.quote || ex.sourceText, updatedAt: touched } : {
            key: k,
            targetLang: settings.targetLang,
            sourceKey: sk,
            sourceText: row.quote || "",
            translatedText: u.text,
            createdAt: touched,
            updatedAt: touched,
            useCount: 0,
          };
          await db.tm.put(entry);
        }
      }
    });

    if (fileId === get().currentFileId) {
      const refreshed = await db.dialogs.where("fileId").equals(fileId).sortBy("idx");
      set({ dialogs: refreshed });
    }

    const tmCount = await db.tm.count();
    set({ tmCount });

    return cleaned.length;
  },

  copyOriginalToTranslation: async (dialogId) => {
    const row = await db.dialogs.get(dialogId);
    if (!row) return;
    await get().updateTranslation(dialogId, row.quote);
  },

  applyTMToCurrentFile: async (mode) => {
    const pid = get().currentProjectId;
    const fileId = get().currentFileId;
    if (!pid || !fileId) return 0;

    const p = await db.projects.get(pid);
    if (!p) return 0;
    p.settings = normalizeSettings(p.settings);
    if (!p.settings.tmEnabled) return 0;

    const all = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
    const keys = all.map(d => tmKey(p.settings.targetLang, dialogSourceKey(d)));
    const hits = await db.tm.bulkGet(keys);

    const toUpdate: DialogItem[] = [];

    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      const h = hits[i];
      if (!h?.translatedText) continue;
      const has = !!(d.translated && d.translated.trim());
      if (mode === 'missing' && has) continue;
      const next = h.translatedText;
      if (d.translated === next) continue;
      toUpdate.push({ ...d, translated: next, updatedAt: now() });
    }

    if (!toUpdate.length) return 0;

    await db.transaction('rw', db.dialogs, db.tm, async () => {
      await db.dialogs.bulkPut(toUpdate);
      for (const u of toUpdate) {
        const sk = dialogSourceKey(u);
        const k = tmKey(p.settings.targetLang, sk);
        const ex = await db.tm.get(k);
        if (!ex) continue;
        ex.useCount = (ex.useCount || 0) + 1;
        ex.updatedAt = now();
        await db.tm.put(ex);
      }
    });

    if (fileId === get().currentFileId) {
      const refreshed = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
      set({ dialogs: refreshed });
    }

    const tmCount = await db.tm.count();
    set({ tmCount });
    return toUpdate.length;
  },

  translateScope: async (scope) => {
    const pid = get().currentProjectId;
    const fileId = get().currentFileId;
    if (!pid || !fileId) return;

    const p = await db.projects.get(pid);
    if (!p) return;
    p.settings = normalizeSettings(p.settings);

    const { keys } = get();
    const settings = {
      sourceLang: p.settings.sourceLang,
      targetLang: p.settings.targetLang,
      deepseekKey: keys.deepseekKey,
      deeplKey: keys.deeplKey,
      lingvaBaseUrl: p.settings.lingvaBaseUrl,
    };

    const all = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
    const filter = get().filter.trim().toLowerCase();
    const selectedIds = new Set(Object.keys(get().selected || {}));

    const candidates = all.filter(d => {
      if (scope === 'missing' && (d.translated && d.translated.trim())) return false;
      if (scope === 'selected' && !selectedIds.has(d.id)) return false;
      if (scope === 'filtered' && filter) {
        const a = (d.quote || '').toLowerCase();
        const b = (d.translated || '').toLowerCase();
        if (!a.includes(filter) && !b.includes(filter)) return false;
      }
      if (get().showUntranslatedOnly && (d.translated && d.translated.trim())) return false;
      return true;
    });

    if (!candidates.length) return;

    const append = async (level: LogLevel, message: string) => {
      const item = { id: uid('log'), projectId: pid, ts: now(), level, message };
      await db.logs.add(item);
      const lines = (get().logs ? get().logs.split('\n') : []).concat([logLine(level, message)]).slice(-400);
      set({ logs: lines.join('\n') });
    };

    const batchSize = Math.max(1, Math.min(60, p.settings.batchSize || 20));
    activeAbort?.abort();
    activeAbort = new AbortController();

    set({ progress: { running: true, total: candidates.length, done: 0, label: 'Translating…' } });
    await append('info', `Translate started: engine=${p.settings.engine}, mode=${p.settings.mode}, scope=${scope}, items=${candidates.length}`);

    try {
      if (p.settings.tmEnabled) {
        const filled = await get().applyTMToCurrentFile('missing');
        if (filled) await append('info', `TM filled ${filled} lines before machine translation.`);
      }

      const refreshedAll = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
      const candidates2 = refreshedAll.filter(d => {
        if (scope === 'missing' && (d.translated && d.translated.trim())) return false;
        if (scope === 'selected' && !selectedIds.has(d.id)) return false;
        if (scope === 'filtered' && filter) {
          const a = (d.quote || '').toLowerCase();
          const b = (d.translated || '').toLowerCase();
          if (!a.includes(filter) && !b.includes(filter)) return false;
        }
        if (get().showUntranslatedOnly && (d.translated && d.translated.trim())) return false;
        return true;
      });

      if (!candidates2.length) {
        await append('info', 'Nothing left to translate after TM.');
        return;
      }

      for (let start = 0; start < candidates2.length; start += batchSize) {
        const batch = candidates2.slice(start, start + batchSize);
        const signal = activeAbort.signal;

        const translated = await translateBatch(p.settings.engine, batch, settings, signal);
        const normalized = postprocessTranslatedLines(batch, translated);

        const warnIdxs: number[] = [];

        await db.transaction('rw', db.dialogs, db.tm, async () => {
          for (let i = 0; i < batch.length; i++) {
            const d = batch[i];
            const next = String(normalized[i] ?? '');
            const row = await db.dialogs.get(d.id);
            if (!row) continue;
            row.translated = next;
            row.updatedAt = now();
            await db.dialogs.put(row);

            if (p.settings.tmEnabled && p.settings.tmAutoAdd && next.trim()) {
              const sk = dialogSourceKey(row);
              const k = tmKey(p.settings.targetLang, sk);
              const ex = await db.tm.get(k);
              const entry: TranslationMemoryEntry = ex ? {
                ...ex,
                translatedText: next,
                sourceText: row.quote,
                updatedAt: now(),
              } : {
                key: k,
                targetLang: String(p.settings.targetLang).trim().toLowerCase(),
                sourceKey: sk,
                sourceText: row.quote,
                translatedText: next,
                createdAt: now(),
                updatedAt: now(),
                useCount: 0,
              };
              await db.tm.put(entry);
            }

            if (checkPlaceholders(next)) warnIdxs.push(d.idx + 1);
          }
        });

        for (const w of warnIdxs) await append('warn', `Placeholder still appears after translation at idx=${w}. Review manually.`);

        const done = Math.min(candidates2.length, start + batch.length);
        set({ progress: { running: true, total: candidates2.length, done, label: `Translating… ${done}/${candidates2.length}` } });

        if (fileId === get().currentFileId) {
          const refreshed = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
          set({ dialogs: refreshed });
        }
      }

      const tmCount = await db.tm.count();
      set({ tmCount });
      await append('info', 'Translate finished.');
    } catch (e: any) {
      if (e?.name === 'AbortError') await append('warn', 'Translate canceled.');
      else await append('error', String(e?.message || e));
    } finally {
      set({ progress: { running: false, total: 0, done: 0, label: '' } });
      activeAbort = null;
    }
  },

  cancelTranslate: () => {
    activeAbort?.abort();
  },

  listTM: async (q, limit, targetLang) => {
    const query = String(q || '').trim().toLowerCase();
    const lim = Math.max(10, Math.min(5000, Math.floor(limit || 500)));
    const tgt = targetLang ? String(targetLang).trim().toLowerCase() : null;

    let rows: TranslationMemoryEntry[] = [];

    if (tgt) {
      rows = (await db.tm.where('targetLang').equals(tgt).sortBy('updatedAt')).reverse();
    } else {
      rows = await db.tm.orderBy('updatedAt').reverse().toArray();
    }

    if (query) {
      rows = rows.filter(r =>
        (r.sourceText || '').toLowerCase().includes(query) ||
        (r.translatedText || '').toLowerCase().includes(query) ||
        (r.sourceKey || '').toLowerCase().includes(query)
      );
    }

    return rows.slice(0, lim);
  },

  deleteTM: async (key) => {
    const k = String(key || '').trim();
    if (!k) return;
    await db.tm.delete(k);
    const tmCount = await db.tm.count();
    set({ tmCount });
  },

  clearTM: async () => {
    await db.tm.clear();
    const tmCount = await db.tm.count();
    set({ tmCount });
  },

  exportTM: async () => {
    const rows = await db.tm.orderBy('updatedAt').reverse().toArray();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: rows }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `translation_memory_${new Date().toISOString().slice(0, 10)}.json`);
  },

  importTM: async (files) => {
    const arr: File[] = Array.isArray(files) ? files : Array.from(files);
    if (!arr.length) return;

    let added = 0;

    for (const f of arr) {
      const raw = await f.text();
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }

      const entries: any[] = Array.isArray(parsed?.entries) ? parsed.entries : (Array.isArray(parsed) ? parsed : []);
      const normalized: TranslationMemoryEntry[] = [];

      for (const e of entries) {
        const targetLang = String(e?.targetLang || '').trim().toLowerCase();
        const sourceKey = String(e?.sourceKey || '').trim();
        const sourceText = String(e?.sourceText || '');
        const translatedText = String(e?.translatedText || '');
        if (!targetLang || !sourceKey || !translatedText.trim()) continue;
        const key = tmKey(targetLang, sourceKey);
        normalized.push({
          key,
          targetLang,
          sourceKey,
          sourceText,
          translatedText,
          createdAt: Number(e?.createdAt) || now(),
          updatedAt: Number(e?.updatedAt) || now(),
          useCount: Number(e?.useCount) || 0,
        });
      }

      if (normalized.length) {
        await db.tm.bulkPut(normalized);
        added += normalized.length;
      }
    }

    const tmCount = await db.tm.count();
    set({ tmCount });

    const pid = get().currentProjectId;
    if (pid && added) {
      await db.logs.add({ id: uid('log'), projectId: pid, ts: now(), level: 'info', message: `TM import: ${added} entries merged.` });
      const logs = (await loadRecentLogs(pid)).map(x => logLine(x.level, x.message)).join('\n');
      set({ logs });
    }
  },

  exportZip: async () => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const p = await db.projects.get(pid);
    if (!p) return;

    const files = await db.files.where('projectId').equals(pid).sortBy('name');

    const out: Array<{ path: string; content: string }> = [];
    for (const f of files) {
      const dialogs = await db.dialogs.where('fileId').equals(f.id).sortBy('idx');
      const merged = applyTranslations(f.sourceText, dialogs, f.eol, TRANSLATOR_CREDIT);
      out.push({ path: f.path || f.name, content: merged });
    }

    const blob = await makeZip(out);
    downloadBlob(blob, `${p.name.replace(/[^a-z0-9_-]+/gi, '_') || 'translated'}.zip`);
  },

  exportCurrentFile: async () => {
    const pid = get().currentProjectId;
    const fileId = get().currentFileId;
    if (!pid || !fileId) return;

    const f = await db.files.get(fileId);
    if (!f) return;

    const dialogs = await db.dialogs.where('fileId').equals(fileId).sortBy('idx');
    const merged = applyTranslations(f.sourceText, dialogs, f.eol, TRANSLATOR_CREDIT);
    const blob = await makeZip([{ path: f.path || f.name, content: merged }]);
    downloadBlob(blob, `${f.name.replace(/[^a-z0-9_-]+/gi, '_') || 'file'}.zip`);
  },

  resetProject: async () => {
    const pid = get().currentProjectId;
    if (!pid) return;
    await db.transaction('rw', db.files, db.dialogs, db.logs, async () => {
      const files = await db.files.where('projectId').equals(pid).toArray();
      const fileIds = files.map(x => x.id);
      if (fileIds.length) await db.dialogs.where('fileId').anyOf(fileIds).delete();
      await db.files.where('projectId').equals(pid).delete();
      await db.logs.where('projectId').equals(pid).delete();
    });
    set({ files: [], dialogs: [], currentFileId: null, logs: '', selected: {}, filter: '' });
  },
}));
