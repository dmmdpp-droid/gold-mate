// 阿里云 OpenAPI RPC 签名算法（HMAC-SHA1），兼容 Cloudflare Workers
// 文档：https://help.aliyun.com/document_detail/315526.html

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function hmacSha1(key, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function callAliyunApi(endpoint, action, params, accessKeyId, accessKeySecret) {
  const commonParams = {
    Action: action,
    Version: '2017-05-25', // Dypnsapi 版本
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: randomString(16),
    Format: 'JSON',
  };

  const allParams = { ...commonParams, ...params };

  // 1. 参数按 key 排序
  const sortedKeys = Object.keys(allParams).sort();

  // 2. 构造规范化查询字符串
  const canonicalQueryString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  // 3. 构造待签名字符串
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalQueryString)}`;

  // 4. HMAC-SHA1 签名
  const signature = await hmacSha1(accessKeySecret + '&', stringToSign);

  // 5. 构造最终请求 URL
  const finalParams = { ...allParams, Signature: signature };
  const queryString = Object.keys(finalParams)
    .map(k => `${percentEncode(k)}=${percentEncode(finalParams[k])}`)
    .join('&');

  const url = `https://${endpoint}/?${queryString}`;

  const res = await fetch(url, { method: 'GET' });
  return await res.json();
}
