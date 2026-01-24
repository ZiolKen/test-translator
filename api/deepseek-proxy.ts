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

    const model = String(body.model || 'deepseek-chat').trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = !!body.stream;

    const payload = {
      model,
      messages,
      stream,
      temperature: body.temperature ?? undefined,
      top_p: body.top_p ?? undefined,
      max_tokens: body.max_tokens ?? undefined,
    };

    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
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
