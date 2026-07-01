/**
 * 黄金换算助手 · ZPay 支付回调（双轨方案：指纹+激活码）
 * GET /api/notify
 *
 * 安全说明：
 *   1. 签名验证：只用ZPay文档列出的官方回调字段子集参与签名计算
 *      （而非对收到的全部query参数签名），避免额外字段导致签名误判。
 *   2. 金额校验：与创建订单时记录的金额比对，防止「假通知」攻击。
 *
 * V1.8.4 变更：
 *   整个处理逻辑包裹了全局 try-catch。此前写入激活码/会员/订单/结果这几步
 *   KV操作没有异常保护，一旦任意一步抛出未捕获异常，Cloudflare会直接返回
 *   通用错误页而不是字符串"success"，导致ZPay判定"未通知成功"并持续重试。
 *   现在任何异常都会被捕获并写入 debug:crash:{timestamp}，方便直接在KV
 *   面板里看到完整报错堆栈，而不必依赖 Cloudflare Observability（该功能
 *   需要额外在 wrangler 配置里开启，本项目未启用）。
 *
 * V1.8.7 变更（会员到期时间叠加，防止二次购买覆盖缩短会员权益）：
 *   写入 member:{fp} 指纹会员记录时，改为在"现有到期时间"（若已过期则从
 *   "现在"算起）之上叠加本次购买的天数，而不是无条件用本次购买的到期时间
 *   覆盖。例如用户还剩700天，又买了一张30天月卡，新到期时间是"700天后+30
 *   天"，而不是被直接覆盖成30天后。
 *
 *   order:{out_trade_no} 记录里的 expiry 字段保持不变，仍然是"仅这一笔
 *   购买本身对应的到期时间"（面值），作为这笔订单的历史/审计信息，不代表
 *   用户实际叠加后的到期时间——真正生效的叠加结果只体现在 member:{fp} 和
 *   （后续手机号绑定环节的）phone:{phone} 记录里。
 *   新增 bound:false 字段，标记这笔订单是否已经被 sms-bind.js 用于手机号
 *   绑定，防止同一笔订单被重复核验/绑定导致天数被叠加两次（见 sms-verify.js
 *   / sms-bind.js 的对应改动）。
 *
 *   result:{out_trade_no}（供前端支付成功后轮询展示）里的 expiry 改为使用
 *   叠加后的指纹会员到期时间，让用户支付成功页看到的是"我现在实际到期时间"，
 *   而不是单纯这一笔购买的面值到期时间，避免用户以为自己"只买到了这么多天"。
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

  try {
    const KEY = env.ZPAY_KEY;
    if (!KEY) return new Response('config missing');

    if (p.trade_status !== 'TRADE_SUCCESS') return new Response('fail');

    // 1. 签名验证
    const expectedSign = makeSign(p, KEY);
    if (expectedSign !== p.sign) {
      // 安全诊断：只记录KEY的长度和首尾各2位（掩码），排查是否因复制粘贴带入
      // 了多余空格/换行符导致密钥与ZPay后台实际值不一致，但不暴露完整密钥。
      const keyDiag = {
        length: KEY.length,
        head: KEY.slice(0, 2),
        tail: KEY.slice(-2),
        hasLeadingSpace: /^\s/.test(KEY),
        hasTrailingSpace: /\s$/.test(KEY),
      };
      const signedString = NOTIFY_SIGN_FIELDS
        .filter(k => p[k] !== '' && p[k] != null)
        .sort()
        .map(k => `${k}=${p[k]}`)
        .join('&');
      try {
        await env.GOLD_CODES.put(`debug:bad_sign:${Date.now()}`, JSON.stringify({
          time: new Date().toISOString(), params: p, expectedSign, keyDiag, signedString
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
    // rawExpiry：仅这一笔购买本身对应的到期时间（面值），写入 order 记录用于审计展示
    const rawExpiry = Date.now() + days * 24 * 60 * 60 * 1000;
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

    // 2. 写入指纹会员记录（叠加：在现有到期时间/现在两者取更晚的基础上，加上本次购买天数）
    let fpStackedExpiry = rawExpiry;
    if (fp) {
      const memberKey = `member:${fp}`;
      let existingExpiry = 0;
      try {
        const existingMemberRaw = await env.GOLD_CODES.get(memberKey);
        if (existingMemberRaw) {
          const existingMember = JSON.parse(existingMemberRaw);
          existingExpiry = existingMember.expiry || 0;
        }
      } catch {}
      fpStackedExpiry = Math.max(existingExpiry, Date.now()) + days * 24 * 60 * 60 * 1000;

      await env.GOLD_CODES.put(memberKey, JSON.stringify({
        plan, days, expiry: fpStackedExpiry, order: p.out_trade_no, time: Date.now()
      }));
    }

    // 3. 写入订单记录（expiry保持为本次购买面值，bound标记是否已被手机号绑定使用过）
    await env.GOLD_CODES.put(orderKey, JSON.stringify({
      fp, plan, money: p.money, expiry: rawExpiry, code, time: Date.now(), bound: false
    }));

    // 4. 写入轮询结果（展示叠加后的指纹会员到期时间，而不是单笔购买面值）
    await env.GOLD_CODES.put(`result:${p.out_trade_no}`, JSON.stringify({
      fp, plan, days, expiry: fpStackedExpiry, code
    }));

    return new Response('success');

  } catch (err) {
    // 全局兜底：任何未预料的异常都记录下来，而不是让Cloudflare返回通用错误页
    try {
      await env.GOLD_CODES.put(`debug:crash:${Date.now()}`, JSON.stringify({
        time: new Date().toISOString(),
        message: err && err.message,
        stack: err && err.stack,
        params: p,
      }), { expirationTtl: 86400 });
    } catch {}
    return new Response('internal error: ' + (err && err.message));
  }
}
