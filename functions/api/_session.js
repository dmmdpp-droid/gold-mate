/**
 * 黄金换算助手 · 会话Cookie辅助模块
 *
 * 背景：Safari的ITP机制会在网站7天无访问时自动清空localStorage等非Cookie数据，
 * 但只针对localStorage和"用前端JS写入的Cookie"（document.cookie）。服务端通过
 * HTTP响应头 Set-Cookie 直接下发的Cookie不受此限制，可以设置长达400天有效期
 * （浏览器本身的硬上限）。这是WebKit工程师官方澄清过的规则。
 *
 * 本项目Cloudflare Pages Functions与前端页面完全同源，不存在"CNAME指向第三方
 * 服务商导致被降级到7天"的例外情况，属于真正的第一方服务端Cookie。
 *
 * 用途：手机号登录/绑定成功后，下发一个长效会话Cookie，作为比"设备指纹"更可靠
 * 的身份锚点——指纹依赖Canvas渲染等信号拼接，部分浏览器出于隐私保护会给渲染
 * 结果加噪声，导致指纹漂移；服务端Cookie不存在这个问题。
 *
 * 数据结构：
 *   Cookie本身只存一个随机会话ID，不直接存手机号/会员信息（避免客户端能读到
 *   业务数据，且Cookie设为HttpOnly，前端JS也读不到，只有随请求自动带上）。
 *   session:{sessionId} → { phone, time }  只是一个指向手机号的轻量指针
 *   phone:{phone} → 仍然是会员信息的唯一真实来源（到期时间、套餐等），
 *   查会话时先查session拿到phone，再查phone拿到真实会员状态，避免出现
 *   两份会员数据源不一致的问题。
 */

export const SESSION_COOKIE_NAME = 'gm_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 365天，单位秒

export function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function buildSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// 手机号确认身份后（登录成功/绑定成功）调用，创建一个新会话并返回Cookie字符串
export async function createSessionCookieForPhone(env, phone) {
  const sessionId = generateSessionId();
  try {
    await env.GOLD_CODES.put(
      `session:${sessionId}`,
      JSON.stringify({ phone, time: Date.now() }),
      { expirationTtl: SESSION_MAX_AGE }
    );
  } catch {
    return null;
  }
  return buildSessionCookie(sessionId);
}
