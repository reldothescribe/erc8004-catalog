#!/usr/bin/env node
/**
 * ERC-8004 D1 Sync Script
 * Syncs agents from Ethereum + Base to Cloudflare D1
 * 
 * Run locally: node scripts/sync-d1.mjs --local
 * Run remote:  node scripts/sync-d1.mjs
 */

import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet, base } from 'viem/chains';
import { execSync } from 'child_process';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const DB_NAME = 'erc8004-catalog';
const BATCH_SIZE = 50;

// RPC endpoints
const ETH_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.llamarpc.com'
];

const BASE_RPCS = [
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com'
];

const REGISTRY_ABI = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
];

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const isLocal = process.argv.includes('--local');

function d1Execute(sql) {
  const flag = isLocal ? '--local' : '';
  const escaped = sql.replace(/'/g, "'\\''");
  try {
    execSync(`wrangler d1 execute ${DB_NAME} ${flag} --command '${escaped}'`, {
      stdio: 'pipe',
      encoding: 'utf8'
    });
    return true;
  } catch (err) {
    console.error('D1 Error:', err.message);
    return false;
  }
}

function d1Query(sql) {
  const flag = isLocal ? '--local' : '';
  const escaped = sql.replace(/'/g, "'\\''");
  try {
    const result = execSync(`wrangler d1 execute ${DB_NAME} ${flag} --command '${escaped}' --json`, {
      stdio: 'pipe',
      encoding: 'utf8'
    });
    return JSON.parse(result);
  } catch (err) {
    console.error('D1 Query Error:', err.message);
    return null;
  }
}

async function fetchMetadata(uri) {
  if (!uri) return null;
  try {
    // Handle data URIs
    if (uri.startsWith('data:application/json')) {
      const base64 = uri.split(',')[1];
      return JSON.parse(Buffer.from(base64, 'base64').toString());
    }
    // Handle IPFS
    if (uri.startsWith('ipfs://')) {
      uri = `https://ipfs.io/ipfs/${uri.slice(7)}`;
    }
    const res = await fetch(uri, { 
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'ERC8004-Catalog/2.0' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function syncChain(chain, client, startBlock, blockChunk) {
  console.log(`\\nSyncing ${chain}...`);
  
  const currentBlock = await client.getBlockNumber();
  let fromBlock = startBlock;
  let agents = [];
  
  // Fetch all Transfer events (mints have from = 0x0)
  while (fromBlock < currentBlock) {
    const toBlock = fromBlock + blockChunk > currentBlock ? currentBlock : fromBlock + blockChunk;
    
    try {
      const logs = await client.getLogs({
        address: REGISTRY,
        event: TRANSFER_EVENT,
        fromBlock,
        toBlock
      });
      
      const mints = logs.filter(l => l.args.from === ZERO_ADDRESS);
      
      for (const log of mints) {
        const tokenId = log.args.tokenId.toString();
        const owner = log.args.to;
        
        // Get metadata URI
        let uri = null;
        try {
          uri = await client.readContract({
            address: REGISTRY,
            abi: REGISTRY_ABI,
            functionName: 'tokenURI',
            args: [log.args.tokenId]
          });
        } catch {}
        
        // Fetch and parse metadata
        const metadata = await fetchMetadata(uri);
        
        agents.push({
          token_id: tokenId,
          chain,
          owner,
          name: metadata?.name || null,
          description: metadata?.description || null,
          metadata_uri: uri,
          metadata_json: metadata ? JSON.stringify(metadata) : null,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000)
        });
        
        process.stdout.write(`\\r  Found ${agents.length} agents...`);
      }
    } catch (err) {
      console.error(`\\nError at block ${fromBlock}: ${err.message}`);
    }
    
    fromBlock = toBlock + 1n;
  }
  
  console.log(`\\n  Total: ${agents.length} agents from ${chain}`);
  return agents;
}

async function insertAgents(agents) {
  console.log(`\\nInserting ${agents.length} agents into D1...`);
  
  for (let i = 0; i < agents.length; i += BATCH_SIZE) {
    const batch = agents.slice(i, i + BATCH_SIZE);
    
    for (const agent of batch) {
      const sql = `
        INSERT OR REPLACE INTO agents 
        (token_id, chain, owner, name, description, metadata_uri, metadata_json, created_at, updated_at)
        VALUES (
          '${agent.token_id}',
          '${agent.chain}',
          '${agent.owner}',
          ${agent.name ? `'${agent.name.replace(/'/g, "''")}'` : 'NULL'},
          ${agent.description ? `'${agent.description.replace(/'/g, "''").slice(0, 1000)}'` : 'NULL'},
          ${agent.metadata_uri ? `'${agent.metadata_uri.replace(/'/g, "''")}'` : 'NULL'},
          ${agent.metadata_json ? `'${agent.metadata_json.replace(/'/g, "''")}'` : 'NULL'},
          ${agent.created_at},
          ${agent.updated_at}
        )
      `;
      d1Execute(sql);
    }
    
    process.stdout.write(`\\r  Inserted ${Math.min(i + BATCH_SIZE, agents.length)}/${agents.length}...`);
  }
  
  console.log('\\n✅ Done');
}

async function main() {
  console.log(`ERC-8004 D1 Sync (${isLocal ? 'local' : 'remote'})`);
  console.log('='.repeat(40));
  
  // Create clients
  const ethClient = createPublicClient({
    chain: mainnet,
    transport: http(ETH_RPCS[0])
  });
  
  const baseClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPCS[0])
  });
  
  // Sync both chains
  const ethAgents = await syncChain('ethereum', ethClient, 21000000n, 5000n);
  const baseAgents = await syncChain('base', baseClient, 41500000n, 10000n);
  
  // Insert all
  const allAgents = [...ethAgents, ...baseAgents];
  await insertAgents(allAgents);
  
  // Update sync state
  const now = new Date().toISOString();
  d1Execute(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_sync', '${now}')`);
  
  console.log(`\\n✅ Sync complete: ${allAgents.length} agents`);
}

main().catch(console.error);
