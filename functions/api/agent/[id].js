/**
 * GET /api/agent/:id - Get single agent by token ID
 */

const CACHE_TTL = 86400; // 24 hours - agent data rarely changes
const STALE_TTL = 604800; // 7 days stale-while-revalidate

export async function onRequest(context) {
  const { request, env, params } = context;
  const tokenId = params.id;
  
  // Check cache first
  const cacheKey = new Request(request.url, request);
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  
  if (response) {
    return response;
  }
  
  try {
    const agent = await env.DB.prepare(
      'SELECT * FROM agents WHERE token_id = ?'
    ).bind(tokenId).first();
    
    if (!agent) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const data = {
      ...agent,
      metadata: agent.metadata_json ? JSON.parse(agent.metadata_json) : null
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
