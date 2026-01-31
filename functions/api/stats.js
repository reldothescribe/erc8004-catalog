/**
 * GET /api/stats - Registry statistics
 */

const CACHE_TTL = 300; // 5 minutes for stats
const STALE_TTL = 3600; // 1 hour stale-while-revalidate

export async function onRequest(context) {
  const { request, env } = context;
  
  // Check cache first
  const cacheKey = new Request(request.url, request);
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  
  if (response) {
    return response;
  }
  
  try {
    // Get counts by chain
    const stats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN chain = 'ethereum' THEN 1 ELSE 0 END) as ethereum,
        SUM(CASE WHEN chain = 'base' THEN 1 ELSE 0 END) as base
      FROM agents
    `).first();
    
    // Get last sync time
    const syncState = await env.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'last_sync'"
    ).first();
    
    // Get recent agents
    const recent = await env.DB.prepare(`
      SELECT token_id, name, chain, created_at 
      FROM agents 
      ORDER BY created_at DESC 
      LIMIT 10
    `).all();
    
    const data = {
      total: stats?.total || 0,
      byChain: {
        ethereum: stats?.ethereum || 0,
        base: stats?.base || 0
      },
      lastSync: syncState?.value || null,
      recent: recent.results
    };
    
    response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}, stale-while-revalidate=${STALE_TTL}`,
        'CDN-Cache-Control': `public, max-age=${CACHE_TTL}`,
        'Vary': 'Accept-Encoding'
      }
    });
    
    context.waitUntil(cache.put(cacheKey, response.clone()));
    
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
