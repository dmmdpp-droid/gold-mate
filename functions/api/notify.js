/**
 * 黄金换算助手 · ZPay 支付回调
 * GET /api/notify
 * 验证签名 → 生成激活码 → 写入 KV → 返回 success
 */

import { createHash } from 'node:crypto';

const PID = '2026062112580447';
const KEY = 'D5fT7jP2xN9rZ4cB1kM6vQ0sH3gY6888';

const PLAN_DAYS = { monthly: 30, yearly: 730 };

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

function sign(params) {
  const sorted = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] !== null && params[k] !== undefined)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return md5(sorted + KEY);
}

function generateCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);

  // 1. 验证支付状态
  if (p.trade_status !== 'TRADE_SUCCESS') {
    return new Response('fail', { status: 200 });
  }

  // 2. 验证签名
  const expectedSign = sign(p);
  if (expectedSign !== p.sign) {
    return new Response('sign error', { status: 200 });
  }

  // 3. 防重复处理：检查订单是否已处理
  const orderKey = `order:${p.out_trade_no}`;
  const existing = await env.GOLD_CODES.get(orderKey).catch(() => null);
  if (existing) {
    return new Response('success', { status: 200 }); // 已处理，直接返回 success
  }

  // 4. 生成激活码
  const plan = p.param || 'yearly'; // param 字段存的套餐类型
  const days = PLAN_DAYS[plan] || 730;
  const until = Date.now() + 365 * 24 * 60 * 60 * 1000; // 激活码本身1年内有效

  // 生成唯一激活码（循环直到不重复）
  let code, exists;
  const prefix = plan === 'monthly' ? 'M' : 'Y';
  let attempts = 0;
  do {
    code = generateCode(prefix);
    exists = await env.GOLD_CODES.get(code).catch(() => null);
    attempts++;
  } while (exists && attempts < 10);

  // 5. 写入 KV：激活码 + 订单记录
  await env.GOLD_CODES.put(code, JSON.stringify({ days, until, used: false, order: p.out_trade_no }));
  await env.GOLD_CODES.put(orderKey, JSON.stringify({ code, plan, money: p.money, time: Date.now() }));

  // 6. 写入待取码记录（前端轮询用）
  await env.GOLD_CODES.put(`result:${p.out_trade_no}`, JSON.stringify({ code, plan, days }));

  return new Response('success', { status: 200 });
}
