export const config = { runtime: 'nodejs' };

function json(res: any, status: number, body: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end();
    return;
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const apiKey = String(body.apiKey || '').trim();
    if (!apiKey) return json(res, 400, { error: 'Missing apiKey' });

    const text = Array.isArray(body.text) ? body.text.map((x: any) => String(x ?? '')) : [];
    if (!text.length) return json(res, 400, { error: 'Missing text[]' });

    const target_lang = String(body.target_lang || '').trim();
    if (!target_lang) return json(res, 400, { error: 'Missing target_lang' });

    const endpoint = (process.env.DEEPL_ENDPOINT || '').trim()
      || (apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');

    const url = endpoint.replace(/\/$/, '') + '/v2/translate';

    const payload: any = {
      text,
      target_lang,
      preserve_formatting: body.preserve_formatting ?? 1,
      split_sentences: body.split_sentences ?? 0,
    };
    if (body.source_lang) payload.source_lang = String(body.source_lang).trim();
    if (body.formality) payload.formality = body.formality;
    if (body.model_type) payload.model_type = body.model_type;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.text().catch(() => '');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = upstream.status;

    const ct = upstream.headers.get('content-type') || '';
    res.setHeader('Content-Type', ct.includes('application/json') ? ct : 'application/json; charset=utf-8');

    if (ct.includes('application/json')) {
      res.end(raw);
    } else {
      res.end(JSON.stringify({ error: raw }));
    }
  } catch (e: any) {
    json(res, 500, { error: String(e?.message || e) });
  }
}
