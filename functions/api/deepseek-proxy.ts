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

    const model = String(body.model || 'deepseek-chat').trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = !!body.stream;

    const payload: any = {
      model,
      messages,
      stream,
    };
    if (body.temperature != null) payload.temperature = body.temperature;
    if (body.top_p != null) payload.top_p = body.top_p;
    if (body.max_tokens != null) payload.max_tokens = body.max_tokens;

    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
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
