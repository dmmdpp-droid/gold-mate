/**
 * 黄金换算助手 · 核验短信验证码 + 查询/绑定会员
 * POST /api/sms-verify  { "phone": "13800138000", "code": "1234", "verifyId": "xxx", "orderNo": "xxx"(可选) }
 *
 * 安全说明：
 *   核验通过后，如果带了 orderNo（支付成功后首次登录场景），
 *   会生成一个一次性 bindToken（5分钟有效，关联手机号+订单号），
 *   前端必须用这个 token 才能调用 /api/sms-bind 完成绑定。
 *   防止任何人绕过短信验证直接调用 sms-bind 伪造会员记录。
 *
 * V1.8.7 变更（修复：带新订单的老用户被误判"已过期"、新购买被静默丢弃）：
 *   原逻辑先查手机号是否已有记录，只要有记录（不管有效还是过期）就直接
 *   返回，orderNo 完全不会被检查——导致老用户续费后走"手机号登录"想激活
 *   新买的套餐，却被直接拦截返回"expired"，新订单白买了。
 *
 *   现在改为：只要请求带了 orderNo（说明这次一定是支付成功后的登录），
 *   就优先核验这笔新订单、生成bindToken，不管手机号原来有没有记录、有没
 *   有过期。只有"普通登录"（没有orderNo）才走"查手机号记录"这条老逻辑。
 *
 *   同时增加订单幂等保护：如果这笔订单在 order 记录里已经标记为 bound
 *   （说明之前已经成功绑定过一次），不再重复生成bindToken（防止用户反复
 *   点击"获取验证码/登录"导致同一笔购买被叠加绑定多次），而是直接返回
 *   该手机号当前的真实会员状态。
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

    const phoneKey = `phone:${phone}`;

    // 1. 优先处理"带了新订单号"的场景——不管手机号原来有没有记录、有没有过期，
    //    这次一定是支付成功后想要激活/叠加这笔新购买，必须先处理这个订单。
    if (orderNo) {
      const orderKey = `order:${orderNo}`;
      const orderRaw = await env.GOLD_CODES.get(orderKey).catch(() => null);
      if (!orderRaw) {
        return new Response(JSON.stringify({ ok: false, reason: 'order_not_found' }), { headers: cors });
      }
      const order = JSON.parse(orderRaw);
      if (Date.now() > order.expiry) {
        return new Response(JSON.stringify({ ok: false, reason: 'order_expired' }), { headers: cors });
      }

      if (order.bound) {
        // 这笔订单之前已经成功绑定过，不再重复生成token叠加天数，
        // 直接把手机号当前的真实状态返回给前端展示即可。
        const phoneRaw = await env.GOLD_CODES.get(phoneKey).catch(() => null);
        if (phoneRaw) {
          const data = JSON.parse(phoneRaw);
          return new Response(JSON.stringify({
            ok: true, found: true, expiry: data.expiry, plan: data.plan,
          }), { headers: cors });
        }
        // 理论上不应出现"订单已绑定但手机号查无记录"，兜底按已绑定处理
        return new Response(JSON.stringify({ ok: false, reason: 'already_bound' }), { headers: cors });
      }

      const bindToken = randomToken(32);
      await env.GOLD_CODES.put(`bindtoken:${bindToken}`, JSON.stringify({
        phone, orderNo, plan: order.plan, expiry: order.expiry,
      }), { expirationTtl: 300 }); // 5分钟有效

      return new Response(JSON.stringify({ ok: true, found: false, bindToken }), { headers: cors });
    }

    // 2. 普通登录场景（没有orderNo）：查该手机号是否已有会员记录
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

    // 普通登录场景，未找到记录，也没有订单号
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
