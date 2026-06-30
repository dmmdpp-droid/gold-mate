/**
 * 黄金换算助手 · 发送短信验证码（阿里云短信认证服务）
 * POST /api/sms-send  { "phone": "13800138000" }
 */

import { callAliyunApi } from './_aliyun-sign.js';

const ENDPOINT = 'dypnsapi.aliyuncs.com';

export async function onRequestPost({ request, env }) {
  const ACCESS_KEY_ID = env.ALIYUN_AK_ID;
  const ACCESS_KEY_SECRET = env.ALIYUN_AK_SECRET;

  // 调试：检查环境变量是否读取到
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
    return new Response(JSON.stringify({
      ok: false, reason: 'env_missing',
      hasId: !!ACCESS_KEY_ID, hasSecret: !!ACCESS_KEY_SECRET,
      idLen: ACCESS_KEY_ID ? ACCESS_KEY_ID.length : 0
    }), { headers: { 'Content-Type': 'application/json' } });
  }
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_request' }), { status: 400, headers: cors });
  }

  const phone = (body.phone || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_phone' }), { headers: cors });
  }

  // 限流：同一手机号 60 秒内只能发一次
  const rateLimitKey = `sms_rate:${phone}`;
  try {
    const lastSent = await env.GOLD_CODES.get(rateLimitKey);
    if (lastSent) {
      return new Response(JSON.stringify({ ok: false, reason: 'rate_limited' }), { headers: cors });
    }
  } catch {}

  try {
    const result = await callAliyunApi(ENDPOINT, 'SendSmsVerifyCode', {
      PhoneNumber: phone,
      SignName: '速通互联验证码',
      TemplateCode: '100001',
      TemplateParam: JSON.stringify({ code: '', min: '5' }),
      CodeLength: '4',
      ExpireTime: '300', // 5分钟有效
    }, ACCESS_KEY_ID, ACCESS_KEY_SECRET);

    if (result.Code === 'OK') {
      // 记录限流（60秒）
      try {
        await env.GOLD_CODES.put(rateLimitKey, '1', { expirationTtl: 60 });
      } catch {}

      // VerifyCodeId 用于后续核验
      return new Response(JSON.stringify({
        ok: true,
        verifyId: result.Model?.VerifyId || result.Model?.Id,
      }), { headers: cors });
    } else {
      return new Response(JSON.stringify({
        ok: false, reason: 'send_failed', detail: result.Message || result.Code
      }), { headers: cors });
    }
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
