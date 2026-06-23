import { md5 } from './_md5.js';

const PID = '2026062112580447';
const KEY = 'D5fT7jP2xN9rZ4cB1kM6vQ0sH3gY6888';
const ZPAY_URL = 'https://zpayz.cn/mapi.php';

const PLANS = {
  monthly: { name: '黄金换算助手会员月卡', money: '5.00', days: 30 },
  yearly:  { name: '黄金换算助手会员两年卡', money: '20.00', days: 730 },
};

function makeSign(params) {
  const sorted = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return md5(sorted + KEY);
}

export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_request' }), { status: 400, headers: cors });
  }

  const plan = PLANS[body.plan];
  if (!plan) {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_plan' }), { status: 400, headers: cors });
  }

  const type = 'wxpay';
  const out_trade_no = Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const notify_url = 'https://gold-mate.pages.dev/api/notify';
  const clientip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const fp = (body.fp || '').slice(0, 64); // 设备指纹，最多64位

  const params = {
    pid: PID,
    type,
    out_trade_no,
    notify_url,
    return_url: 'https://gold-mate.pages.dev',
    name: plan.name,
    money: plan.money,
    clientip,
    device: 'h5',
    param: body.plan + '|' + fp, // 格式：plan|fingerprint
    sign_type: 'MD5',
  };
  params.sign = makeSign(params);

  const form = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => form.append(k, v));

  let zpay;
  try {
    const res = await fetch(ZPAY_URL, { method: 'POST', body: form });
    zpay = await res.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: 'zpay_error', detail: e.message }), { headers: cors });
  }

  if (zpay.code !== 1) {
    return new Response(JSON.stringify({ ok: false, reason: 'zpay_failed', msg: zpay.msg }), { headers: cors });
  }

  const payurl = zpay.payurl2 || zpay.payurl;

  return new Response(JSON.stringify({ ok: true, payurl, out_trade_no, plan: body.plan }), { headers: cors });
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
