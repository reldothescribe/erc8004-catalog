#!/usr/bin/env node
/**
 * ERC-8004 Agent Sync Script
 * Fetches registered agents from the blockchain and updates local JSON files.
 */

import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const AGENTS_DIR = join(DATA_DIR, 'agents');
const INDEX_FILE = join(DATA_DIR, 'index.json');

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com';

// ERC-721 Transfer event (used for minting detection)
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

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
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
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
    const res = await fetch(uri);
    return res.json();
  }
  if (uri.startsWith('ipfs://')) {
    const cid = uri.replace('ipfs://', '');
    const res = await fetch(`https://ipfs.io/ipfs/${cid}`);
    return res.json();
  }
  throw new Error(`Unknown URI scheme: ${uri}`);
}

async function syncAgents() {
  console.log('🔄 Starting ERC-8004 sync...');
  console.log(`   RPC: ${RPC_URL}`);
  console.log(`   Last synced block: ${index.lastBlock}`);

  const currentBlock = await client.getBlockNumber();
  console.log(`   Current block: ${currentBlock}`);

  // Get total supply to know how many agents exist
  const totalSupply = await client.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'totalSupply'
  });
  console.log(`   Total registered agents: ${totalSupply}`);

  // Fetch Transfer events (mints are from address(0))
  const fromBlock = index.lastBlock > 0 ? BigInt(index.lastBlock + 1) : 0n;
  
  // If starting fresh, iterate through all token IDs
  const newAgents = [];
  
  for (let tokenId = 1n; tokenId <= totalSupply; tokenId++) {
    const agentFile = join(AGENTS_DIR, `${tokenId}.json`);
    
    // Skip if we already have this agent (unless forcing refresh)
    if (existsSync(agentFile) && !process.env.FORCE_REFRESH) {
      continue;
    }

    console.log(`   Fetching agent #${tokenId}...`);
    
    try {
      const [uri, owner] = await Promise.all([
        client.readContract({
          address: REGISTRY,
          abi: REGISTRY_ABI,
          functionName: 'tokenURI',
          args: [tokenId]
        }),
        client.readContract({
          address: REGISTRY,
          abi: REGISTRY_ABI,
          functionName: 'ownerOf',
          args: [tokenId]
        })
      ]);

      const metadata = await parseAgentURI(uri);
      
      const agent = {
        id: Number(tokenId),
        owner,
        name: metadata.name || `Agent #${tokenId}`,
        description: metadata.description || '',
        image: metadata.image || '',
        active: metadata.active ?? true,
        x402Support: metadata.x402Support ?? false,
        services: metadata.services || [],
        rawMetadata: metadata,
        syncedAt: new Date().toISOString()
      };

      writeFileSync(agentFile, JSON.stringify(agent, null, 2));
      newAgents.push(agent);
      console.log(`   ✅ Saved agent #${tokenId}: ${agent.name}`);
    } catch (err) {
      console.error(`   ❌ Error fetching agent #${tokenId}:`, err.message);
    }
  }

  // Rebuild index
  const allAgentIds = [];
  for (let i = 1n; i <= totalSupply; i++) {
    allAgentIds.push(Number(i));
  }

  index = {
    lastSync: new Date().toISOString(),
    lastBlock: Number(currentBlock),
    totalAgents: Number(totalSupply),
    agents: allAgentIds
  };

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`\n✅ Sync complete! ${newAgents.length} new agents indexed.`);
}

syncAgents().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
