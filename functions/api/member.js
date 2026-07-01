/**
 * 黄金换算助手 · 查询会员状态
 * POST /api/member  { "fp": "设备指纹" }
 *
 * V1.8.8 变更（服务端Cookie会话优先，设备指纹降级为兜底）：
 *   原先只靠设备指纹判断会员身份，但指纹依赖Canvas渲染等信号拼接，部分浏览器
 *   出于隐私保护会给渲染结果加噪声，导致指纹不稳定；同时localStorage本身会被
 *   Safari的ITP机制在7天无访问后自动清空，两者叠加导致老会员经常被误判为
 *   "查无记录"。
 *
 *   现在优先读取服务端下发的会话Cookie（不受localStorage的ITP清理规则影响，
 *   详见 _session.js 顶部说明）。只有在没有Cookie，或Cookie对应的会话查无
 *   记录/已过期时，才回退到原有的设备指纹查询逻辑（覆盖用户刚支付成功、还
 *   没走手机号登录绑定这一步的过渡场景）。
 */

import { parseCookies, SESSION_COOKIE_NAME, buildSessionCookie } from './_session.js';

/**
 * V1.8.13 变更：reason:'expired' 的响应里附带 expiry 字段（具体到期时间戳），
 * 供前端区分"老会员到期"和"全新用户试用到期"，展示带具体日期的续费提示，
 * 而不是笼统的"试用已到期"。见《会员收费与登录逻辑全面自查报告.md》发现3。
 */

export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json; charset=utf-8' };

  let body;
  try { body = await request.json(); } catch {
    body = {};
  }

  const fp = (body.fp || '').trim();

  // 1. 优先尝试服务端会话Cookie
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (sessionId) {
    try {
      const sessionRaw = await env.GOLD_CODES.get(`session:${sessionId}`);
      if (sessionRaw) {
        const { phone } = JSON.parse(sessionRaw);
        const phoneRaw = await env.GOLD_CODES.get(`phone:${phone}`);
        if (phoneRaw) {
          const data = JSON.parse(phoneRaw);
          if (Date.now() <= data.expiry) {
            // 会话有效：续期Cookie（滑动过期，每次成功查询都往后延长有效期）
            return new Response(JSON.stringify({
              ok: true, expiry: data.expiry, plan: data.plan,
            }), { headers: { ...cors, 'Set-Cookie': buildSessionCookie(sessionId) } });
          }
          return new Response(JSON.stringify({ ok: false, reason: 'expired', expiry: data.expiry }), { headers: cors });
        }
      }
    } catch {}
    // Cookie存在但会话/手机号记录查无结果，不直接判失败，继续走指纹兜底
  }

  // 2. 兜底：设备指纹（覆盖尚未完成手机号登录绑定的过渡场景）
  if (!fp) return new Response(JSON.stringify({ ok: false }), { headers: cors });

  try {
    const raw = await env.GOLD_CODES.get(`member:${fp}`);
    if (!raw) return new Response(JSON.stringify({ ok: false }), { headers: cors });

    const data = JSON.parse(raw);
    if (Date.now() > data.expiry) {
      return new Response(JSON.stringify({ ok: false, reason: 'expired', expiry: data.expiry }), { headers: cors });
    }

    return new Response(JSON.stringify({
      ok: true,
      expiry: data.expiry,
      plan: data.plan,
    }), { headers: cors });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { headers: cors });
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
