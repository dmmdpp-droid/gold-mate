/**
 * 黄金换算助手 · 激活码验证接口
 * POST /api/activate  { "code": "Y-2026-XXXXX" }
 *
 * KV namespace: GOLD_CODES
 * KV key   = 激活码（大写）
 * KV value = JSON { days: number, until: number, used: boolean }
 *
 * 验证逻辑：
 *   1. 激活码是否存在
 *   2. 激活码自身截止日期（until）是否已过
 *   3. 激活码是否已被使用（used === true）
 *   4. 通过 → 把 used 置为 true 写回 KV，返回 days
 *
 * 返回格式：
 *   成功 → { ok: true, days: number }
 *   失败 → { ok: false, reason: string }
 */

export async function onRequestPost({ request, env }) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  };

  // 解析请求体
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_request' }), {
      status: 400, headers: cors,
    });
  }

  const code = (body.code || '').trim().toUpperCase();
  if (!code) {
    return new Response(JSON.stringify({ ok: false, reason: 'empty_code' }), {
      status: 400, headers: cors,
    });
  }

  // KV 查询
  const raw = await env.GOLD_CODES.get(code);
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, reason: 'not_found' }), {
      headers: cors,
    });
  }

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'data_error' }), {
      headers: cors,
    });
  }

  // 检查截止日期
  if (Date.now() > entry.until) {
    return new Response(JSON.stringify({ ok: false, reason: 'expired' }), {
      headers: cors,
    });
  }

  // 检查是否已使用
  if (entry.used) {
    return new Response(JSON.stringify({ ok: false, reason: 'already_used' }), {
      headers: cors,
    });
  }

  // 标记已使用，写回 KV
  entry.used = true;
  await env.GOLD_CODES.put(code, JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true, days: entry.days }), {
    headers: cors,
  });
}

// 处理 CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
