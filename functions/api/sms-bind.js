/**
 * 黄金换算助手 · 绑定手机号到会员记录（支付成功后调用）
 * POST /api/sms-bind  { "bindToken": "xxx", "fp": "指纹" }
 *
 * 安全说明：
 *   不再信任前端传来的 phone/plan/expiry，
 *   一切信息从 sms-verify 生成的一次性 bindToken 中读取，
 *   token 必须真实存在于 KV 且未过期（5分钟），用完即焚。
 *
 * V1.8.7 变更（会员到期时间叠加，防止二次购买覆盖缩短会员权益）：
 *   原逻辑直接用这笔新订单的 expiry 覆盖手机号原有记录，如果用户已经是
 *   会员、这次只是买错/重复购买了较短套餐，会导致到期时间被意外缩短。
 *
 *   现在改为：写入前先读取该手机号现有记录，新到期时间 =
 *   max(现有到期时间, 现在时间) + 本次购买天数。不管是"过期后重新买"、
 *   "有效期内提前续费"还是"第一次购买"，这一条公式都能正确处理：
 *     - 现有记录已过期/不存在 → max取"现在"，等价于从今天开始算，行为不变
 *     - 现有记录未过期（提前续费）→ 在原到期时间基础上完整叠加新购买天数，
 *       不会因为"还没到期"就吃亏
 *
 *   同时绑定成功后，将 order:{out_trade_no} 记录标记为 bound:true，
 *   配合 sms-verify.js 的幂等检查，防止同一笔订单被重复核验/绑定导致
 *   天数被叠加两次。
 */

/**
 * V1.8.8 变更（下发服务端会话Cookie）：
 *   绑定成功后，除了写入 phone:{phone} 记录，同时下发一个长效会话Cookie，
 *   作为比设备指纹更可靠的身份锚点（不受Safari ITP对localStorage的7天清理
 *   规则影响，详见 _session.js 顶部说明）。
 */

import { createSessionCookieForPhone } from './_session.js';

const PLAN_DAYS = { monthly: 30, yearly: 730 }; // 需与 pay.js / notify.js 的 PLANS 保持一致

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

    // 再次确认订单未过期（双重保险，expiry此处是订单面值到期时间）
    if (Date.now() > expiry) {
      return new Response(JSON.stringify({ ok: false, reason: 'expired' }), { headers: cors });
    }

    const orderKey = `order:${orderNo}`;

    // 二次防护：即使 sms-verify.js 因为用户连续点击等原因为同一笔订单签发了
    // 多个 bindToken，这里在真正叠加写入之前再确认一次订单是否已经绑定过，
    // 避免同一笔购买被并发的多个请求重复叠加天数。同时把订单数据读出来复用，
    // 避免后面标记 bound:true 时再多查一次。
    let orderData = null;
    try {
      const orderRaw = await env.GOLD_CODES.get(orderKey);
      if (orderRaw) orderData = JSON.parse(orderRaw);
    } catch {}

    if (orderData && orderData.bound) {
      const phoneRawCheck = await env.GOLD_CODES.get(`phone:${phone}`).catch(() => null);
      if (phoneRawCheck) {
        const data = JSON.parse(phoneRawCheck);
        await env.GOLD_CODES.delete(tokenKey); // token仍需作废，防止继续被使用
        const sessionCookie = await createSessionCookieForPhone(env, phone);
        const respHeaders = sessionCookie ? { ...cors, 'Set-Cookie': sessionCookie } : cors;
        return new Response(JSON.stringify({ ok: true, expiry: data.expiry, plan: data.plan }), { headers: respHeaders });
      }
    }

    const days = PLAN_DAYS[plan] || 730;
    const phoneKey = `phone:${phone}`;

    // 读取该手机号现有记录，计算叠加后的到期时间
    let existingExpiry = 0;
    try {
      const existingRaw = await env.GOLD_CODES.get(phoneKey);
      if (existingRaw) {
        const existingData = JSON.parse(existingRaw);
        existingExpiry = existingData.expiry || 0;
      }
    } catch {}

    const stackedExpiry = Math.max(existingExpiry, Date.now()) + days * 24 * 60 * 60 * 1000;

    await env.GOLD_CODES.put(phoneKey, JSON.stringify({
      plan, expiry: stackedExpiry, fp, orderNo, time: Date.now()
    }));

    // 标记这笔订单已绑定，防止重复核验/绑定导致天数被叠加两次
    try {
      if (orderData) {
        orderData.bound = true;
        await env.GOLD_CODES.put(orderKey, JSON.stringify(orderData));
      }
    } catch {}

    // 用完即焚，防止 token 被重复使用
    await env.GOLD_CODES.delete(tokenKey);

    const sessionCookie = await createSessionCookieForPhone(env, phone);
    const respHeaders = sessionCookie ? { ...cors, 'Set-Cookie': sessionCookie } : cors;
    return new Response(JSON.stringify({ ok: true, expiry: stackedExpiry, plan }), { headers: respHeaders });
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
