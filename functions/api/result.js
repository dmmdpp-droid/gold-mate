/**
 * 黄金换算助手 · 查询支付结果
 * GET /api/result?order=xxx
 * 前端支付完成后轮询，直到拿到激活码
 */

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const order = url.searchParams.get('order');
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  if (!order) {
    return new Response(JSON.stringify({ ok: false }), { headers: cors });
  }

  const raw = await env.GOLD_CODES.get(`result:${order}`).catch(() => null);
  if (!raw) {
    return new Response(JSON.stringify({ ok: false }), { headers: cors });
  }

  return new Response(JSON.stringify({ ok: true, ...JSON.parse(raw) }), { headers: cors });
}
