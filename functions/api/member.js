/**
 * 黄金换算助手 · 查询会员状态
 * POST /api/member  { "fp": "设备指纹" }
 */

export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false }), { headers: cors });
  }

  const fp = (body.fp || '').trim();
  if (!fp) return new Response(JSON.stringify({ ok: false }), { headers: cors });

  try {
    const raw = await env.GOLD_CODES.get(`member:${fp}`);
    if (!raw) return new Response(JSON.stringify({ ok: false }), { headers: cors });

    const data = JSON.parse(raw);
    // 检查是否过期
    if (Date.now() > data.expiry) {
      return new Response(JSON.stringify({ ok: false, reason: 'expired' }), { headers: cors });
    }

    return new Response(JSON.stringify({
      ok: true,
      expiry: data.expiry,
      plan: data.plan,
    }), { headers: cors });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
