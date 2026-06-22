import { md5 } from './_md5.js';

const KEY = 'D5fT7jP2xN9rZ4cB1kM6vQ0sH3gY6888';
const PLAN_DAYS = { monthly: 30, yearly: 730 };

function makeSign(params) {
  const sorted = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return md5(sorted + KEY);
}

function generateCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${code}`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);

  // 记录所有回调（调试用）
  try {
    await env.GOLD_CODES.put('debug:last_notify', JSON.stringify({
      time: new Date().toISOString(),
      params: p
    }));
  } catch(e) {}

  if (p.trade_status !== 'TRADE_SUCCESS') return new Response('fail');

  const expectedSign = makeSign(p);
  if (expectedSign !== p.sign) return new Response('sign error');

  const orderKey = `order:${p.out_trade_no}`;
  try {
    const existing = await env.GOLD_CODES.get(orderKey);
    if (existing) return new Response('success');
  } catch {}

  const plan = p.param || 'yearly';
  const days = PLAN_DAYS[plan] || 730;
  const until = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const prefix = plan === 'monthly' ? 'M' : 'Y';

  let code, exists, attempts = 0;
  do {
    code = generateCode(prefix);
    try { exists = await env.GOLD_CODES.get(code); } catch { exists = null; }
    attempts++;
  } while (exists && attempts < 10);

  await env.GOLD_CODES.put(code, JSON.stringify({ days, until, used: false, order: p.out_trade_no }));
  await env.GOLD_CODES.put(orderKey, JSON.stringify({ code, plan, money: p.money, time: Date.now() }));
  await env.GOLD_CODES.put(`result:${p.out_trade_no}`, JSON.stringify({ code, plan, days }));

  return new Response('success');
}
