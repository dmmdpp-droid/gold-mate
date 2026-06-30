/**
 * 黄金换算助手 · ZPay 支付回调（双轨方案：指纹+激活码）
 * GET /api/notify
 *
 * 安全说明：
 *   1. 签名验证：只用ZPay文档列出的官方回调字段子集参与签名计算
 *      （而非对收到的全部query参数签名），避免额外字段导致签名误判。
 *   2. 金额校验：与创建订单时记录的金额比对，防止「假通知」攻击。
 */

import { md5 } from './_md5.js';

const PLAN_DAYS = { monthly: 30, yearly: 730 };
const PLAN_MONEY = { monthly: '0.01', yearly: '0.02' }; // 需与 pay.js 的 PLANS 保持一致

// ZPay 文档列出的回调官方字段（仅这些参与签名）
const NOTIFY_SIGN_FIELDS = ['pid', 'name', 'money', 'out_trade_no', 'trade_no', 'param', 'trade_status', 'type'];

function makeSign(params, key) {
  const sorted = NOTIFY_SIGN_FIELDS
    .filter(k => params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return md5(sorted + key);
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

  const KEY = env.ZPAY_KEY;
  if (!KEY) return new Response('config missing');

  if (p.trade_status !== 'TRADE_SUCCESS') return new Response('fail');

  // 1. 签名验证
  const expectedSign = makeSign(p, KEY);
  if (expectedSign !== p.sign) {
    // 记录异常回调，便于排查（不写入会员数据）
    try {
      await env.GOLD_CODES.put(`debug:bad_sign:${Date.now()}`, JSON.stringify({
        time: new Date().toISOString(), params: p, expectedSign
      }), { expirationTtl: 86400 });
    } catch {}
    return new Response('sign error');
  }

  // 防重复处理
  const orderKey = `order:${p.out_trade_no}`;
  try {
    const existing = await env.GOLD_CODES.get(orderKey);
    if (existing) return new Response('success');
  } catch {}

  // 解析 param：格式为 "plan|fingerprint"
  const paramParts = (p.param || '').split('|');
  const plan = paramParts[0] || 'yearly';
  const fp = paramParts[1] || '';

  // 2. 金额校验：防止篡改 plan/money 导致以小钱开通大会员
  const expectedMoney = PLAN_MONEY[plan];
  if (!expectedMoney || p.money !== expectedMoney) {
    try {
      await env.GOLD_CODES.put(`debug:money_mismatch:${Date.now()}`, JSON.stringify({
        time: new Date().toISOString(), params: p, expectedMoney
      }), { expirationTtl: 86400 });
    } catch {}
    return new Response('money mismatch');
  }

  const days = PLAN_DAYS[plan] || 730;
  const expiry = Date.now() + days * 24 * 60 * 60 * 1000;
  const until = Date.now() + 365 * 24 * 60 * 60 * 1000; // 激活码1年内有效
  const prefix = plan === 'monthly' ? 'M' : 'Y';

  // 生成唯一激活码
  let code, exists, attempts = 0;
  do {
    code = generateCode(prefix);
    try { exists = await env.GOLD_CODES.get(code); } catch { exists = null; }
    attempts++;
  } while (exists && attempts < 10);

  // 1. 写入激活码记录
  await env.GOLD_CODES.put(code, JSON.stringify({
    days, until, used: false, order: p.out_trade_no
  }));

  // 2. 写入指纹会员记录
  if (fp) {
    await env.GOLD_CODES.put(`member:${fp}`, JSON.stringify({
      plan, days, expiry, order: p.out_trade_no, time: Date.now()
    }));
  }

  // 3. 写入订单记录
  await env.GOLD_CODES.put(orderKey, JSON.stringify({
    fp, plan, money: p.money, expiry, code, time: Date.now()
  }));

  // 4. 写入轮询结果（同时包含激活码和到期时间）
  await env.GOLD_CODES.put(`result:${p.out_trade_no}`, JSON.stringify({
    fp, plan, days, expiry, code
  }));

  return new Response('success');
}
