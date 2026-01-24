import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { LANGUAGES } from '../lib/languages';
import type { DialogItem, EngineKind, ExtractMode, TranslationMemoryEntry } from '../lib/types';
import { useApp } from './state';
import { Modal } from './components/Modal';

function useHotkeys(on: { find: () => void; translateMissing: () => void; exportZip: () => void; }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); on.find(); }
      if (k === 'e') { e.preventDefault(); on.exportZip(); }
      if (e.key === 'Enter') { e.preventDefault(); on.translateMissing(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [on]);
}

function StatDot({ d }: { d: DialogItem }) {
  const has = !!(d.translated && d.translated.trim());
  if (!has) return <span className="dot muted" />;
  if ((d.translated || '').includes('⟦RENPH') || (d.translated || '').includes('__RENPLH_')) return <span className="dot warn" />;
  return <span className="dot ok" />;
}

function RowActions(props: { onCopy: () => void; onEdit: () => void; }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button className="iconBtn" title="Copy original to translation" onClick={props.onCopy}>↩</button>
      <button className="iconBtn" title="Edit in modal" onClick={props.onEdit}>⤢</button>
    </div>
  );
}

function DialogRow({
  data,
  index,
  style,
}: ListChildComponentProps<{
  items: DialogItem[];
  selected: Record<string, boolean>;
  toggle: (id: string) => void;
  update: (id: string, text: string) => void;
  copy: (id: string) => void;
  openEditor: (d: DialogItem) => void;
  activeId: string | null;
}>) {
  const d = data.items[index];
  if (!d) return null;

  const checked = !!data.selected[d.id];
  const active = data.activeId === d.id;

  return (
    <div className={'row' + (active ? ' activeRow' : '')} style={style}>
      <div className="cellIndex">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatDot d={d} />
          <span>#{index + 1}</span>
        </div>
        <div className="small">Line {d.lineIndex + 1}</div>
        <label className="badge" style={{ cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => data.toggle(d.id)}
            style={{ margin: 0 }}
          />
          Select
        </label>
      </div>

      <div className="cellText">
        <textarea value={d.quote || ''} readOnly />
        <div className="hint">{d.maskedQuote}</div>
      </div>

      <div className="cellText">
        <textarea
          value={d.translated || ''}
          placeholder="Write translation…"
          onChange={(e) => data.update(d.id, e.target.value)}
        />
        <div className="hint">{(d.translated || '').slice(0, 160)}</div>
      </div>

      <RowActions
        onCopy={() => data.copy(d.id)}
        onEdit={() => data.openEditor(d)}
      />
    </div>
  );
}

function SettingsModal(props: { open: boolean; onClose: () => void; }) {
  const app = useApp();
  const pid = app.currentProjectId;
  const project = app.projects.find(p => p.id === pid);

  const [deepseekKey, setDeepseekKey] = useState(app.keys.deepseekKey);
  const [deeplKey, setDeeplKey] = useState(app.keys.deeplKey);
  const [lingva, setLingva] = useState(app.lingvaBaseUrl);

  useEffect(() => {
    if (!props.open) return;
    setDeepseekKey(app.keys.deepseekKey);
    setDeeplKey(app.keys.deeplKey);
    setLingva(app.lingvaBaseUrl);
  }, [props.open]);

  return (
    <Modal
      open={props.open}
      title="Settings"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={async () => {
              app.setKeys(deepseekKey, deeplKey);
              await app.setLingvaBaseUrl(lingva);
              props.onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <span>DeepSeek API key (stored locally in your browser)</span>
        <input value={deepseekKey} onChange={(e) => setDeepseekKey(e.target.value)} placeholder="sk-..." />
      </div>
      <div className="field">
        <span>DeepL API key (stored locally in your browser)</span>
        <input value={deeplKey} onChange={(e) => setDeeplKey(e.target.value)} placeholder="deepl-..." />
      </div>
      <div className="field full">
        <span>Lingva base URL</span>
        <input value={lingva} onChange={(e) => setLingva(e.target.value)} placeholder="https://lingva.lunar.icu" />
      </div>

      <div className="field">
        <span>Translation Memory</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="badge" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={project?.settings.tmEnabled ?? true}
              onChange={(e) => app.setTMEnabled(e.target.checked)}
              style={{ margin: 0 }}
            />
            Enable
          </label>
          <label className="badge" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={project?.settings.tmAutoAdd ?? true}
              onChange={(e) => app.setTMAutoAdd(e.target.checked)}
              style={{ margin: 0 }}
            />
            Auto-add on edits/translations
          </label>
          <span className="small">Entries: {app.tmCount}</span>
        </div>
      </div>

      <div className="field">
        <span>Hotkeys</span>
        <textarea
          readOnly
          value={`- Ctrl/Cmd+F: Find/Replace\n- Ctrl/Cmd+Enter: Translate missing\n- Ctrl/Cmd+E: Export zip\n\nAPI keys never leave your browser except when calling your own /api proxies.`}
        />
      </div>
      <div className="field">
        <span>Danger zone</span>
        <button className="btn danger" onClick={() => app.resetProject()}>Reset project (delete imported files & translations)</button>
      </div>
    </Modal>
  );
}

function EditorModal(props: { open: boolean; onClose: () => void; dialog: DialogItem | null; }) {
  const app = useApp();
  const d = props.dialog;
  const [text, setText] = useState(d?.translated || '');

  useEffect(() => {
    setText(d?.translated || '');
  }, [d?.id]);

  return (
    <Modal
      open={props.open}
      title={d ? `Edit #${(d.idx ?? 0) + 1}` : 'Edit'}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn" onClick={() => d && app.copyOriginalToTranslation(d.id)}>Copy Original</button>
          <button
            className="btn primary"
            onClick={async () => {
              if (!d) return;
              await app.updateTranslation(d.id, text);
              props.onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="field full">
        <span>Original</span>
        <textarea readOnly value={d?.quote || ''} />
      </div>
      <div className="field full">
        <span>Translation</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="field full">
        <span>Masked preview</span>
        <textarea readOnly value={d?.maskedQuote || ''} />
      </div>
    </Modal>
  );
}

function TranslateModal(props: { open: boolean; onClose: () => void; onRun: (scope: 'all'|'filtered'|'selected'|'missing') => void; }) {
  const app = useApp();
  const pid = app.currentProjectId;
  const project = app.projects.find(p => p.id === pid);

  return (
    <Modal
      open={props.open}
      title="Translate"
      onClose={props.onClose}
      footer={<button className="btn" onClick={props.onClose}>Close</button>}
    >
      <div className="field full">
        <span>Scope</span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => props.onRun('missing')}>Translate missing</button>
          <button className="btn" onClick={() => props.onRun('filtered')}>Translate search results</button>
          <button className="btn" onClick={() => props.onRun('selected')}>Translate selected</button>
          <button className="btn" onClick={() => props.onRun('all')}>Translate all</button>
        </div>
      </div>

      <div className="field">
        <span>Engine</span>
        <select value={project?.settings.engine || 'deepseek'} onChange={(e) => app.setEngine(e.target.value as EngineKind)}>
          <option value="deepseek">DeepSeek (via /api/deepseek-proxy)</option>
          <option value="deepl">DeepL (via /api/deepl-trans)</option>
          <option value="lingva">Lingva (direct)</option>
        </select>
      </div>

      <div className="field">
        <span>Extract mode</span>
        <select value={project?.settings.mode || 'safe'} onChange={(e) => app.setMode(e.target.value as ExtractMode)}>
          <option value="safe">Safe (dialogue-focused)</option>
          <option value="balanced">Balanced</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </div>

      <div className="field">
        <span>Source language (Lingva)</span>
        <select value={project?.settings.sourceLang || 'auto'} onChange={(e) => app.setLangs(e.target.value, project?.settings.targetLang || 'vi')}>
          <option value="auto">auto</option>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

      <div className="field">
        <span>Target language</span>
        <select value={project?.settings.targetLang || 'vi'} onChange={(e) => app.setLangs(project?.settings.sourceLang || 'auto', e.target.value)}>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

      <div className="field full">
        <span>Batch size</span>
        <input
          type="number"
          min={1}
          max={60}
          value={project?.settings.batchSize || 20}
          onChange={(e) => app.setBatchSize(Number(e.target.value || 20))}
        />
      </div>
    </Modal>
  );
}

type FindScope = 'filtered' | 'all' | 'selected';
type FindField = 'source' | 'translation' | 'both';

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function FindReplaceModal(props: {
  open: boolean;
  onClose: () => void;
  scopeItems: { filtered: DialogItem[]; all: DialogItem[]; selected: DialogItem[] };
  listRef: React.RefObject<List>;
  setActiveId: (id: string | null) => void;
  activeId: string | null;
}) {
  const app = useApp();

  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [scope, setScope] = useState<FindScope>('filtered');
  const [field, setField] = useState<FindField>('both');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    setCursor(0);
  }, [props.open]);

  const items = scope === 'filtered' ? props.scopeItems.filtered : (scope === 'selected' ? props.scopeItems.selected : props.scopeItems.all);

  const compiled = useMemo(() => {
    const q = String(find || '');
    if (!q) return { ok: false as const, err: '' as string, test: (_: string) => false, replace: (s: string) => s };
    try {
      const flags = 'g' + (caseSensitive ? '' : 'i');
      const re = useRegex ? new RegExp(q, flags) : new RegExp(escapeRegExp(q), flags);
      const test = (s: string) => { re.lastIndex = 0; return re.test(s); };
      const replace = (s: string) => s.replace(re, repl);
      return { ok: true as const, err: '', test, replace };
    } catch (e: any) {
      return { ok: false as const, err: String(e?.message || e), test: (_: string) => false, replace: (s: string) => s };
    }
  }, [find, repl, caseSensitive, useRegex]);

  const matches = useMemo(() => {
    if (!compiled.ok) return [] as Array<{ id: string; idx: number }>;
    const out: Array<{ id: string; idx: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      const a = d.quote || '';
      const b = d.translated || '';
      const hit = field === 'source' ? compiled.test(a) : (field === 'translation' ? compiled.test(b) : (compiled.test(a) || compiled.test(b)));
      if (hit) out.push({ id: d.id, idx: i });
    }
    return out;
  }, [items, compiled.ok, compiled, field]);

  const current = matches.length ? matches[Math.max(0, Math.min(cursor, matches.length - 1))] : null;

  const jumpTo = (pos: number) => {
    if (!matches.length) return;
    const next = (pos + matches.length) % matches.length;
    setCursor(next);
    const m = matches[next];
    props.setActiveId(m.id);
    props.listRef.current?.scrollToItem(m.idx, 'center');
  };

  const replaceCurrent = async () => {
    if (!compiled.ok || !current) return;
    const d = items[current.idx];
    if (!d) return;
    const before = String(d.translated || '');
    const after = compiled.replace(before);
    if (after === before) { jumpTo(cursor + 1); return; }
    await app.updateTranslation(d.id, after);
    jumpTo(cursor + 1);
  };

  const replaceAll = async () => {
    if (!compiled.ok) return;
    const updates: Array<{ id: string; text: string }> = [];
    for (const m of matches) {
      const d = items[m.idx];
      if (!d) continue;
      const before = String(d.translated || '');
      const after = compiled.replace(before);
      if (after !== before) updates.push({ id: d.id, text: after });
    }
    if (!updates.length) return;
    await app.bulkUpdateTranslations(updates);
    setCursor(0);
  };

  return (
    <Modal
      open={props.open}
      title="Find & Replace"
      onClose={() => { props.setActiveId(null); props.onClose(); }}
      footer={
        <>
          <button className="btn" onClick={() => jumpTo(cursor - 1)} disabled={!matches.length}>Prev</button>
          <button className="btn" onClick={() => jumpTo(cursor + 1)} disabled={!matches.length}>Next</button>
          <button className="btn" onClick={replaceCurrent} disabled={!matches.length || !compiled.ok}>Replace</button>
          <button className="btn primary" onClick={replaceAll} disabled={!matches.length || !compiled.ok}>Replace all</button>
        </>
      }
    >
      <div className="field full">
        <span>Find</span>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Text or regex" />
      </div>
      <div className="field full">
        <span>Replace with (translations only)</span>
        <input value={repl} onChange={(e) => setRepl(e.target.value)} placeholder="Replacement" />
      </div>

      <div className="field">
        <span>Scope</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as FindScope)}>
          <option value="filtered">Search results (current view)</option>
          <option value="selected">Selected</option>
          <option value="all">All rows</option>
        </select>
      </div>

      <div className="field">
        <span>Search in</span>
        <select value={field} onChange={(e) => setField(e.target.value as FindField)}>
          <option value="both">Source + Translation</option>
          <option value="source">Source</option>
          <option value="translation">Translation</option>
        </select>
      </div>

      <div className="field full">
        <span>Options</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="badge" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} style={{ margin: 0 }} />
            Case sensitive
          </label>
          <label className="badge" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} style={{ margin: 0 }} />
            Regex
          </label>
          <span className="small">Matches: {matches.length}{current ? ` • ${cursor + 1}/${matches.length}` : ''}</span>
          {compiled.ok ? null : <span className="small" style={{ color: 'var(--warn)' }}>Invalid pattern: {compiled.err}</span>}
        </div>
      </div>
    </Modal>
  );
}

function MemoryModal(props: { open: boolean; onClose: () => void; }) {
  const app = useApp();
  const pid = app.currentProjectId;
  const project = app.projects.find(p => p.id === pid);

  const [q, setQ] = useState('');
  const [onlyCurrentLang, setOnlyCurrentLang] = useState(true);
  const [rows, setRows] = useState<TranslationMemoryEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const currentTarget = String(project?.settings.targetLang || '');

  const refresh = async (query: string, currentOnly: boolean) => {
    setBusy(true);
    try {
      const list = await app.listTM(query, 400, currentOnly ? currentTarget : null);
      setRows(list);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!props.open) return;
    setQ('');
    setOnlyCurrentLang(true);
    refresh('', true);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const t = window.setTimeout(() => refresh(q, onlyCurrentLang), 180);
    return () => window.clearTimeout(t);
  }, [q, onlyCurrentLang, props.open, currentTarget]);

  const importRef = useRef<HTMLInputElement | null>(null);

  return (
    <Modal
      open={props.open}
      title="Translation Memory"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={() => app.applyTMToCurrentFile('missing')} disabled={!app.currentFileId}>Fill missing (current file)</button>
          <button className="btn" onClick={() => importRef.current?.click()}>Import TM</button>
          <button className="btn" onClick={() => app.exportTM()}>Export TM</button>
          <button className="btn danger" onClick={() => app.clearTM()} disabled={!app.tmCount}>Clear TM</button>
        </>
      }
    >
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const files = e.target.files;
          if (files) await app.importTM(files);
          e.target.value = '';
          await refresh(q, onlyCurrentLang);
        }}
      />

      <div className="field full">
        <span>Search</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search source or translation" />
      </div>

      <div className="field">
        <span>Filter</span>
        <select value={onlyCurrentLang ? 'current' : 'all'} onChange={(e) => setOnlyCurrentLang(e.target.value === 'current')}>
          <option value="current">Current target language</option>
          <option value="all">All languages</option>
        </select>
      </div>

      <div className="field">
        <span>Status</span>
        <input readOnly value={busy ? 'Loading…' : `Entries: ${app.tmCount} • Showing: ${rows.length}`} />
      </div>

      <div className="field full">
        <span>Entries</span>
        <div className="tmTable">
          <div className="tmHead">
            <div>Lang</div>
            <div>Source</div>
            <div>Translation</div>
            <div>Updated</div>
            <div></div>
          </div>
          {rows.map(r => (
            <div key={r.key} className="tmRow">
              <div className="tmCell mono">{r.targetLang}</div>
              <div className="tmCell">{r.sourceText}</div>
              <div className="tmCell">{r.translatedText}</div>
              <div className="tmCell mono">{new Date(r.updatedAt).toLocaleDateString()}</div>
              <div className="tmCell" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn" onClick={() => navigator.clipboard.writeText(r.translatedText || '')}>Copy</button>
                <button className="btn danger" onClick={async () => { await app.deleteTM(r.key); await refresh(q, onlyCurrentLang); }}>Delete</button>
              </div>
            </div>
          ))}
          {!rows.length ? <div className="tmEmpty">No entries.</div> : null}
        </div>
      </div>
    </Modal>
  );
}

export function App() {
  const app = useApp();

  const importFilesRef = useRef<HTMLInputElement | null>(null);
  const importFolderRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<List | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DialogItem | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => { app.init(); }, []);

  useHotkeys({
    find: () => setFindOpen(true),
    translateMissing: () => app.translateScope('missing'),
    exportZip: () => app.exportZip(),
  });

  const currentFile = useMemo(() => app.files.find(f => f.id === app.currentFileId) || null, [app.files, app.currentFileId]);

  const displayed = useMemo(() => {
    const q = app.filter.trim().toLowerCase();
    let list = app.dialogs;

    if (app.showUntranslatedOnly) list = list.filter(d => !d.translated || !d.translated.trim());
    if (q) list = list.filter(d => (d.quote || '').toLowerCase().includes(q) || (d.translated || '').toLowerCase().includes(q));

    return list;
  }, [app.dialogs, app.filter, app.showUntranslatedOnly]);

  const selectedList = useMemo(() => {
    const ids = new Set(Object.keys(app.selected || {}));
    return app.dialogs.filter(d => ids.has(d.id));
  }, [app.dialogs, app.selected]);

  const counts = useMemo(() => {
    const total = app.dialogs.length;
    const done = app.dialogs.filter(d => d.translated && d.translated.trim()).length;
    const remaining = total - done;
    const selected = Object.keys(app.selected).length;
    return { total, done, remaining, selected, filtered: displayed.length };
  }, [app.dialogs, app.selected, displayed]);

  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const listHeight = useMemo(() => Math.max(320, vh - 220), [vh]);

  if (!app.ready) {
    return <div className="app"><div className="topbar"><div className="brand"><div className="logo" /><h1>VN Ren'Py Translator</h1></div><span className="small">Loading…</span></div></div>;
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo" />
          <h1>VN Ren'Py Translator</h1>
        </div>

        <div className="pill">
          <label>Search</label>
          <input value={app.filter} onChange={(e) => app.setFilter(e.target.value)} placeholder="Quick filter…" />
        </div>

        <div className="pill">
          <label>Untranslated</label>
          <input type="checkbox" checked={app.showUntranslatedOnly} onChange={(e) => app.setShowUntranslatedOnly(e.target.checked)} />
        </div>

        <div className="actions">
          <button className="btn" onClick={() => setFindOpen(true)}>Find/Replace</button>
          <button className="btn" onClick={() => setMemoryOpen(true)}>Memory</button>
          <button className="btn" onClick={() => setTranslateOpen(true)}>Translate</button>
          <button className="btn" onClick={() => app.exportCurrentFile()} disabled={!app.currentFileId}>Export file</button>
          <button className="btn primary" onClick={() => app.exportZip()} disabled={!app.files.length}>Export zip</button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>

        <input
          ref={importFilesRef}
          type="file"
          accept=".rpy"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = e.target.files;
            if (files) await app.importLocalFiles(files);
            e.target.value = '';
          }}
        />

        <input
          ref={importFolderRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = e.target.files;
            if (files) await app.importLocalFiles(files);
            e.target.value = '';
          }}
          {...({ webkitdirectory: 'true', directory: 'true' } as any)}
        />
      </div>

      <div className="main">
        <div className="sidebar">
          <div className="sidebarHeader">
            <div className="title">
              <b>Files</b>
              <span>{app.files.length} loaded</span>
            </div>
            <div className="spacer" />
            <button className="btn" onClick={() => importFilesRef.current?.click()}>Import</button>
            <button className="btn" onClick={() => importFolderRef.current?.click()}>Folder</button>
          </div>
          <div className="fileList">
            {app.files.map((f) => (
              <div
                key={f.id}
                className={'fileItem ' + (f.id === app.currentFileId ? 'active' : '')}
                onClick={() => app.setCurrentFile(f.id)}
              >
                <div className="fileName">{f.name}</div>
                <div className="fileMeta">
                  <span>{f.dialogCount} lines</span>
                  <span className="badge">{f.path.split('/').slice(0, -1).join('/') || 'root'}</span>
                </div>
              </div>
            ))}
            {!app.files.length ? (
              <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13, lineHeight: 1.4 }}>
                Import <b>.rpy</b> files or a folder to start.
                <br /><br />
                Translation Memory is stored locally in your browser.
              </div>
            ) : null}
          </div>
        </div>

        <div className="content">
          <div className="tableHeader">
            <div className="leftInfo">
              <span className="badge">{currentFile?.name || 'No file selected'}</span>
              <span className="counts">
                Total {counts.total} • Done {counts.done} • Remaining {counts.remaining} • Filtered {counts.filtered} • Selected {counts.selected}
              </span>
            </div>
            <div className="grow" />
            <button className="btn" onClick={() => app.clearSelection()} disabled={!counts.selected}>Clear selection</button>
            <button className="btn" onClick={() => app.translateScope('selected')} disabled={!counts.selected}>Translate selected</button>
            <button className="btn primary" onClick={() => app.translateScope('missing')} disabled={!counts.remaining}>Translate missing</button>
          </div>

          <div className="table">
            <List
              ref={listRef as any}
              height={listHeight}
              width={'100%'}
              itemCount={displayed.length}
              itemSize={170}
              itemKey={(i: number) => displayed[i]?.id || i}
              itemData={{
                items: displayed,
                selected: app.selected,
                toggle: app.toggleSelect,
                update: (id: string, text: string) => app.updateTranslation(id, text),
                copy: (id: string) => app.copyOriginalToTranslation(id),
                openEditor: (d: DialogItem) => { setEditing(d); setEditorOpen(true); },
                activeId,
              }}
            >
              {DialogRow}
            </List>
          </div>
        </div>
      </div>

      <div className="footer">
        <div className="log">{app.logs || 'Ready.'}</div>
        <div className="progressWrap">
          <div className="progressBar">
            <div style={{ width: app.progress.running && app.progress.total ? `${Math.round((app.progress.done / app.progress.total) * 100)}%` : '0%' }} />
          </div>
          <div className="small">
            {app.progress.running ? app.progress.label : 'Idle'} {app.progress.running ? <button className="btn danger" onClick={() => app.cancelTranslate()}>Cancel</button> : null}
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <TranslateModal
        open={translateOpen}
        onClose={() => setTranslateOpen(false)}
        onRun={async (scope) => {
          setTranslateOpen(false);
          await app.translateScope(scope);
        }}
      />

      <EditorModal
        open={editorOpen}
        dialog={editing}
        onClose={() => setEditorOpen(false)}
      />

      <FindReplaceModal
        open={findOpen}
        onClose={() => setFindOpen(false)}
        scopeItems={{ filtered: displayed, all: app.dialogs, selected: selectedList }}
        listRef={listRef as any}
        setActiveId={setActiveId}
        activeId={activeId}
      />

      <MemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}
