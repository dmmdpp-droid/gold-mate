/**
 * 黄金换算助手 · ZPay 支付回调（指纹方案）
 * GET /api/notify
 * param 字段格式：plan|fingerprint
 */

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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);

  // 记录回调（调试用）
  try {
    await env.GOLD_CODES.put('debug:last_notify', JSON.stringify({
      time: new Date().toISOString(), params: p
    }));
  } catch {}

  if (p.trade_status !== 'TRADE_SUCCESS') return new Response('fail');

  // 签名验证（暂时跳过）
  // const expectedSign = makeSign(p);
  // if (expectedSign !== p.sign) return new Response('sign error');

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
  const days = PLAN_DAYS[plan] || 730;
  const expiry = Date.now() + days * 24 * 60 * 60 * 1000;

  // 写入会员记录（按指纹）
  if (fp) {
    await env.GOLD_CODES.put(`member:${fp}`, JSON.stringify({
      plan, days, expiry,
      order: p.out_trade_no,
      time: Date.now(),
    }));
  }

  // 写入订单记录
  await env.GOLD_CODES.put(orderKey, JSON.stringify({
    fp, plan, money: p.money, expiry, time: Date.now()
  }));

  // 写入轮询结果（前端查询用）
  await env.GOLD_CODES.put(`result:${p.out_trade_no}`, JSON.stringify({
    fp, plan, days, expiry
  }));

  return new Response('success');
}
