/**
 * 黄金换算助手 · 绑定手机号到会员记录（支付成功后调用）
 * POST /api/sms-bind  { "phone": "13800138000", "plan": "yearly", "expiry": 时间戳, "fp": "指纹" }
 */

export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_request' }), { status: 400, headers: cors });
  }

  const phone = (body.phone || '').trim();
  const plan = body.plan;
  const expiry = body.expiry;
  const fp = body.fp || '';

  if (!/^1[3-9]\d{9}$/.test(phone) || !plan || !expiry) {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_params' }), { headers: cors });
  }

  const phoneKey = `phone:${phone}`;

  try {
    await env.GOLD_CODES.put(phoneKey, JSON.stringify({
      plan, expiry, fp, time: Date.now()
    }));
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: 'kv_error' }), { headers: cors });
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
