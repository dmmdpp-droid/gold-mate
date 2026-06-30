/**
 * 黄金换算助手 · 绑定手机号到会员记录（支付成功后调用）
 * POST /api/sms-bind  { "bindToken": "xxx", "fp": "指纹" }
 *
 * 安全说明：
 *   不再信任前端传来的 phone/plan/expiry，
 *   一切信息从 sms-verify 生成的一次性 bindToken 中读取，
 *   token 必须真实存在于 KV 且未过期（5分钟），用完即焚。
 */

export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_request' }), { status: 400, headers: cors });
  }

  const bindToken = (body.bindToken || '').trim();
  const fp = body.fp || '';

  if (!bindToken) {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_params' }), { headers: cors });
  }

  const tokenKey = `bindtoken:${bindToken}`;

  try {
    const raw = await env.GOLD_CODES.get(tokenKey);
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, reason: 'token_invalid_or_expired' }), { headers: cors });
    }

    const { phone, plan, expiry, orderNo } = JSON.parse(raw);

    // 再次确认订单未过期（双重保险）
    if (Date.now() > expiry) {
      return new Response(JSON.stringify({ ok: false, reason: 'expired' }), { headers: cors });
    }

    const phoneKey = `phone:${phone}`;
    await env.GOLD_CODES.put(phoneKey, JSON.stringify({
      plan, expiry, fp, orderNo, time: Date.now()
    }));

    // 用完即焚，防止 token 被重复使用
    await env.GOLD_CODES.delete(tokenKey);

    return new Response(JSON.stringify({ ok: true, expiry, plan }), { headers: cors });
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
