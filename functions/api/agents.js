/**
 * GET /api/agents - List agents with pagination and search
 * 
 * Query params:
 *   page (default: 1)
 *   limit (default: 50, max: 100)
 *   q (search query)
 *   chain (filter: ethereum, base)
 */

const CACHE_TTL = 3600; // 1 hour
const STALE_TTL = 86400; // 24 hours for stale-while-revalidate

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Check cache first
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  
  if (response) {
    return response;
  }
  
  // Parse query params
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;
  const query = url.searchParams.get('q')?.trim();
  const chain = url.searchParams.get('chain');
  
  let sql, params;
  
  if (query) {
    // Full-text search
    sql = `
      SELECT a.* FROM agents a
      JOIN agents_fts fts ON a.token_id = fts.token_id
      WHERE agents_fts MATCH ?
      ${chain ? 'AND a.chain = ?' : ''}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    params = chain ? [query, chain, limit, offset] : [query, limit, offset];
  } else {
    // Regular listing
    sql = `
      SELECT * FROM agents
      ${chain ? 'WHERE chain = ?' : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    params = chain ? [chain, limit, offset] : [limit, offset];
  }
  
  try {
    const results = await env.DB.prepare(sql).bind(...params).all();
    
    // Get total count
    let countSql = query 
      ? `SELECT COUNT(*) as total FROM agents_fts WHERE agents_fts MATCH ?`
      : `SELECT COUNT(*) as total FROM agents ${chain ? 'WHERE chain = ?' : ''}`;
    let countParams = query ? [query] : (chain ? [chain] : []);
    
    const countResult = await env.DB.prepare(countSql).bind(...countParams).first();
    const total = countResult?.total || 0;
    
    const data = {
      agents: results.results.map(a => ({
        ...a,
        metadata: a.metadata_json ? JSON.parse(a.metadata_json) : null
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
    
    response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}, stale-while-revalidate=${STALE_TTL}`,
        'CDN-Cache-Control': `public, max-age=${CACHE_TTL}`,
        'Vary': 'Accept-Encoding'
      }
    });
    
    // Store in cache
    context.waitUntil(cache.put(cacheKey, response.clone()));
    
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
