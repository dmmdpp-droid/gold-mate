const CACHE_TTL = 12 * 60 * 60;

export async function onRequest(context) {
  const { request, env } = context;
  const API_KEY = env.GOLDAPI_KEY;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'config missing', price: null }), { status: 500, headers: corsHeaders });
  }

  try {
    const cache    = caches.default;
    const cacheReq = new Request('https://gold-cache.internal/price');
    let cached     = await cache.match(cacheReq);

    if (cached) {
      const data = await cached.json();
      return new Response(JSON.stringify({ ...data, from_cache: true }), {
        headers: corsHeaders,
      });
    }

    const res  = await fetch('https://www.goldapi.io/api/XAU/USD', {
      headers: {
        'x-access-token': API_KEY,
        'Content-Type': 'application/json',
      },
    });
    const json = await res.json();

    const price = json.price ? Math.round(json.price) : null;
    const result = {
      price,
      high: json.high_price,
      low: json.low_price,
      change: json.ch,
      change_pct: json.chp,
      updated_at: new Date().toISOString(),
      from_cache: false,
    };

    const cacheRes = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });
    await cache.put(cacheReq, cacheRes);

    return new Response(JSON.stringify(result), { headers: corsHeaders });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, price: null }),
      { status: 500, headers: corsHeaders }
    );
  }
}
