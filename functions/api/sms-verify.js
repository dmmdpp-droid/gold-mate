/**
 * 黄金换算助手 · 核验短信验证码 + 查询/绑定会员
 * POST /api/sms-verify  { "phone": "13800138000", "code": "1234", "verifyId": "xxx", "orderNo": "xxx"(可选) }
 *
 * 安全说明：
 *   核验通过后，如果带了 orderNo（支付成功后首次登录场景），
 *   会生成一个一次性 bindToken（5分钟有效，关联手机号+订单号），
 *   前端必须用这个 token 才能调用 /api/sms-bind 完成绑定。
 *   防止任何人绕过短信验证直接调用 sms-bind 伪造会员记录。
 */

import { callAliyunApi } from './_aliyun-sign.js';

const ENDPOINT = 'dypnsapi.aliyuncs.com';

function randomToken(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function onRequestPost({ request, env }) {
  const ACCESS_KEY_ID = env.ALIYUN_AK_ID;
  const ACCESS_KEY_SECRET = env.ALIYUN_AK_SECRET;
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_request' }), { status: 400, headers: cors });
  }

  const phone = (body.phone || '').trim();
  const code = (body.code || '').trim();
  const verifyId = body.verifyId || '';
  const fp = (body.fp || '').trim();
  const orderNo = (body.orderNo || '').trim(); // 支付成功后首次登录场景才会传

  if (!/^1[3-9]\d{9}$/.test(phone) || !code) {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_params' }), { headers: cors });
  }

  try {
    const result = await callAliyunApi(ENDPOINT, 'CheckSmsVerifyCode', {
      PhoneNumber: phone,
      VerifyCode: code,
      VerifyId: verifyId,
    }, ACCESS_KEY_ID, ACCESS_KEY_SECRET);

    if (result.Code !== 'OK') {
      return new Response(JSON.stringify({ ok: false, reason: 'api_error', detail: result.Message }), { headers: cors });
    }

    const verifyResult = result.Model?.VerifyResult;
    if (verifyResult !== 'PASS') {
      return new Response(JSON.stringify({ ok: false, reason: 'code_mismatch' }), { headers: cors });
    }

    // 验证码核验通过，查询该手机号是否有会员记录
    const phoneKey = `phone:${phone}`;
    const existing = await env.GOLD_CODES.get(phoneKey).catch(() => null);

    if (existing) {
      const data = JSON.parse(existing);
      if (Date.now() > data.expiry) {
        return new Response(JSON.stringify({ ok: false, reason: 'expired' }), { headers: cors });
      }
      if (fp) {
        data.fp = fp;
        await env.GOLD_CODES.put(phoneKey, JSON.stringify(data));
      }
      return new Response(JSON.stringify({
        ok: true, found: true, expiry: data.expiry, plan: data.plan,
      }), { headers: cors });
    }

    // 没有会员记录的情况
    if (orderNo) {
      // 支付成功后首次登录场景：核验真实订单，生成一次性绑定token
      const orderRaw = await env.GOLD_CODES.get(`order:${orderNo}`).catch(() => null);
      if (!orderRaw) {
        return new Response(JSON.stringify({ ok: false, reason: 'order_not_found' }), { headers: cors });
      }
      const order = JSON.parse(orderRaw);
      if (Date.now() > order.expiry) {
        return new Response(JSON.stringify({ ok: false, reason: 'order_expired' }), { headers: cors });
      }

      const bindToken = randomToken(32);
      await env.GOLD_CODES.put(`bindtoken:${bindToken}`, JSON.stringify({
        phone, orderNo, plan: order.plan, expiry: order.expiry,
      }), { expirationTtl: 300 }); // 5分钟有效

      return new Response(JSON.stringify({ ok: true, found: false, bindToken }), { headers: cors });
    }

    // 普通登录场景，未找到记录，无需绑定token
    return new Response(JSON.stringify({ ok: true, found: false }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: 'api_error', detail: e.message }), { headers: cors });
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
