export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestPost(context: any) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const apiKey = String(body.apiKey || '').trim();
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing apiKey' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

    const text = Array.isArray(body.text) ? body.text.map((x: any) => String(x ?? '')) : [];
    if (!text.length) return new Response(JSON.stringify({ error: 'Missing text[]' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

    const target_lang = String(body.target_lang || '').trim();
    if (!target_lang) return new Response(JSON.stringify({ error: 'Missing target_lang' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

    const envEndpoint = String(context.env?.DEEPL_ENDPOINT || '').trim();
    const endpoint = envEndpoint || (apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');
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

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type')?.includes('application/json')
        ? (upstream.headers.get('content-type') || 'application/json')
        : 'application/json; charset=utf-8',
    };

    return new Response(upstream.headers.get('content-type')?.includes('application/json') ? raw : JSON.stringify({ error: raw }), {
      status: upstream.status,
      headers,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  }
}
