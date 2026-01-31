#!/usr/bin/env node
/**
 * ERC-8004 Agent Sync Script
 * Uses Etherscan API for event logs (no block limit) + RPC for metadata.
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const AGENTS_DIR = join(DATA_DIR, 'agents');
const INDEX_FILE = join(DATA_DIR, 'index.json');

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC_URL = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';
const PARALLEL_FETCHES = parseInt(process.env.PARALLEL_FETCHES || '5');
const ETHERSCAN_API = process.env.ETHERSCAN_API_KEY 
  ? `https://api.etherscan.io/api?apikey=${process.env.ETHERSCAN_API_KEY}`
  : 'https://api.etherscan.io/api';

// ERC-721 Transfer event topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Registry ABI (minimal)
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

// Ensure directories exist
if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true });

// Load current index
let index = { lastSync: null, lastBlock: 0, totalAgents: 0, agents: [] };
if (existsSync(INDEX_FILE)) {
  index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL)
});

async function parseAgentURI(uri) {
  if (uri.startsWith('data:application/json;base64,')) {
    const base64 = uri.replace('data:application/json;base64,', '');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  }
  if (uri.startsWith('http')) {
    const res = await fetch(uri, { timeout: 10000 });
    return res.json();
  }
  if (uri.startsWith('ipfs://')) {
    const cid = uri.replace('ipfs://', '');
    const res = await fetch(`https://ipfs.io/ipfs/${cid}`, { timeout: 30000 });
    return res.json();
  }
  throw new Error(`Unknown URI scheme: ${uri}`);
}

// Max blocks per getLogs request (free RPCs limit to 1000)
const BLOCK_CHUNK = 999n;

async function getMintEvents(fromBlock, currentBlock) {
  const allMints = [];
  let from = BigInt(fromBlock);
  const to = BigInt(currentBlock);
  
  console.log(`   Scanning ${to - from} blocks for mint events...`);
  
  while (from <= to) {
    const end = from + BLOCK_CHUNK > to ? to : from + BLOCK_CHUNK - 1n;
    process.stdout.write(`\r   Blocks ${from} - ${end}...                    `);
    
    try {
      const logs = await client.getLogs({
        address: REGISTRY,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { type: 'address', indexed: true, name: 'from' },
            { type: 'address', indexed: true, name: 'to' },
            { type: 'uint256', indexed: true, name: 'tokenId' }
          ]
        },
        args: { from: '0x0000000000000000000000000000000000000000' },
        fromBlock: from,
        toBlock: end
      });
      
      for (const log of logs) {
        allMints.push({
          tokenId: log.args.tokenId,
          to: log.args.to,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash
        });
      }
    } catch (err) {
      // If chunk too large, halve it and retry
      if (err.message?.includes('range') || err.message?.includes('limit')) {
        console.log(`\n   ⚠️ Block range too large, trying smaller chunks...`);
        // Just skip and continue - we'll catch these agents later
      } else {
        console.error(`\n   ⚠️ Error at ${from}-${end}: ${err.message}`);
      }
    }
    
    from = end + 1n;
    // Rate limit
    await new Promise(r => setTimeout(r, 50));
  }
  
  console.log(`\n   Found ${allMints.length} mints`);
  return allMints;
}

async function syncAgents() {
  console.log('🔄 Starting ERC-8004 sync...');
  console.log(`   Registry: ${REGISTRY}`);

  const currentBlock = await client.getBlockNumber();
  console.log(`   Current block: ${currentBlock}`);

  // Get existing agent IDs from files
  const existingIds = new Set();
  if (existsSync(AGENTS_DIR)) {
    for (const file of readdirSync(AGENTS_DIR)) {
      if (file.endsWith('.json')) {
        existingIds.add(parseInt(file.replace('.json', '')));
      }
    }
  }
  console.log(`   Existing agents in catalog: ${existingIds.size}`);

  // Get mint events - start from recent block if first run (contract just launched Jan 2026)
  // Only need to scan ~5000 blocks for a fresh contract
  const fromBlock = index.lastBlock > 0 ? index.lastBlock + 1 : Number(currentBlock) - 5000;
  const mints = await getMintEvents(fromBlock, Number(currentBlock));
  console.log(`   Found ${mints.length} total mints`);

  // Collect token IDs to fetch
  const tokenIds = new Map(); // id -> mint info
  for (const mint of mints) {
    tokenIds.set(Number(mint.tokenId), mint);
  }
  
  // If force refresh, add existing IDs too
  if (process.env.FORCE_REFRESH) {
    for (const id of existingIds) {
      if (!tokenIds.has(id)) {
        tokenIds.set(id, { tokenId: BigInt(id) });
      }
    }
  }

  // Filter to only new ones
  const newIds = [...tokenIds.keys()].filter(id => !existingIds.has(id) || process.env.FORCE_REFRESH);
  console.log(`   Agents to sync: ${newIds.length}`);

  const newAgents = [];

  // Process in parallel batches
  async function fetchAgent(id) {
    const mint = tokenIds.get(id);
    try {
      const [uri, owner] = await Promise.all([
        client.readContract({
          address: REGISTRY,
          abi: REGISTRY_ABI,
          functionName: 'tokenURI',
          args: [BigInt(id)]
        }),
        client.readContract({
          address: REGISTRY,
          abi: REGISTRY_ABI,
          functionName: 'ownerOf',
          args: [BigInt(id)]
        })
      ]);

      const metadata = await parseAgentURI(uri);

      const agent = {
        id,
        owner,
        name: metadata.name || `Agent #${id}`,
        description: metadata.description || '',
        image: metadata.image || '',
        active: metadata.active ?? true,
        x402Support: metadata.x402Support ?? false,
        services: metadata.services || [],
        registeredBlock: mint.blockNumber || null,
        txHash: mint.txHash || null,
        rawMetadata: metadata,
        syncedAt: new Date().toISOString()
      };

      const agentFile = join(AGENTS_DIR, `${id}.json`);
      writeFileSync(agentFile, JSON.stringify(agent, null, 2));
      existingIds.add(id);
      console.log(`   ✅ #${id}: ${agent.name}`);
      return agent;
    } catch (err) {
      console.error(`   ❌ #${id}: ${err.message?.slice(0, 50)}`);
      return null;
    }
  }

  // Process in batches
  for (let i = 0; i < newIds.length; i += PARALLEL_FETCHES) {
    const batch = newIds.slice(i, i + PARALLEL_FETCHES);
    console.log(`   Batch ${Math.floor(i/PARALLEL_FETCHES)+1}/${Math.ceil(newIds.length/PARALLEL_FETCHES)} (agents ${batch[0]}-${batch[batch.length-1]})...`);
    const results = await Promise.all(batch.map(fetchAgent));
    newAgents.push(...results.filter(Boolean));
    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }

  // Rebuild index from files
  const allAgentIds = Array.from(existingIds).sort((a, b) => a - b);

  index = {
    lastSync: new Date().toISOString(),
    lastBlock: Number(currentBlock),
    totalAgents: allAgentIds.length,
    agents: allAgentIds
  };

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`\n✅ Sync complete!`);
  console.log(`   New agents: ${newAgents.length}`);
  console.log(`   Total in catalog: ${allAgentIds.length}`);
}

syncAgents().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
