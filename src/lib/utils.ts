export function uid(prefix = 'id') {
  const a = crypto.getRandomValues(new Uint32Array(4));
  return `${prefix}_${a[0].toString(16)}${a[1].toString(16)}${a[2].toString(16)}${a[3].toString(16)}`;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function safeParseJsonArray(text: string): string[] | null {
  const s = String(text ?? '').trim();
  if (!s) return null;

  const unwrapped = s
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(unwrapped);
    if (Array.isArray(parsed)) return parsed.map(x => (typeof x === 'string' ? x : String(x ?? '')));
  } catch {}

  const match = unwrapped.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed.map(x => (typeof x === 'string' ? x : String(x ?? '')));
    } catch {}
  }

  return null;
}

export async function fetchJson(input: RequestInfo | URL, init: RequestInit, signal?: AbortSignal) {
  const res = await fetch(input, { ...init, signal });
  const text = await res.text().catch(() => '');
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: res.ok, status: res.status, text, json };
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries: number; baseMs: number; maxMs: number; signal?: AbortSignal; onRetry?: (e: any, attempt: number) => void }
) {
  const { retries, baseMs, maxMs, signal, onRetry } = opts;
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      onRetry?.(e, attempt);
      const wait = Math.min(maxMs, baseMs * Math.pow(2, attempt) + Math.random() * 250);
      await sleep(wait, signal);
    }
  }
  throw lastErr;
}
