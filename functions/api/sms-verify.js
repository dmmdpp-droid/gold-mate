/**
 * 黄金换算助手 · 核验短信验证码 + 查询/绑定会员
 * POST /api/sms-verify  { "phone": "13800138000", "code": "1234", "verifyId": "xxx" }
 */

import { callAliyunApi } from './_aliyun-sign.js';

const ENDPOINT = 'dypnsapi.aliyuncs.com';

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
  const fp = (body.fp || '').trim(); // 当前设备指纹，用于绑定

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
      // 更新绑定的设备指纹
      if (fp) {
        data.fp = fp;
        await env.GOLD_CODES.put(phoneKey, JSON.stringify(data));
      }
      return new Response(JSON.stringify({
        ok: true, found: true, expiry: data.expiry, plan: data.plan,
      }), { headers: cors });
    } else {
      // 没有会员记录：仅验证手机号成功，等待绑定（支付后调用 bind）
      return new Response(JSON.stringify({ ok: true, found: false }), { headers: cors });
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
