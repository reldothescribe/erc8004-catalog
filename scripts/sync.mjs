#!/usr/bin/env node
/**
 * ERC-8004 Agent Sync Script
 * Syncs agents from BOTH Ethereum mainnet and Base
 */

import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet, base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const AGENTS_DIR = join(DATA_DIR, 'agents');
const INDEX_FILE = join(DATA_DIR, 'index.json');

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Ethereum: Contract around block 24340000
const ETH_START_BLOCK = 21000000n; // Earlier to catch all mints
const ETH_BLOCK_CHUNK = 5000n;

// Base: Contract around block 41500000
const BASE_START_BLOCK = 41500000n;
const BASE_BLOCK_CHUNK = 10000n;

// RPC endpoints
const ETH_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.llamarpc.com',
  'https://1rpc.io/eth',
  'https://eth.drpc.org'
];

const BASE_RPCS = [
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com', 
  'https://base.drpc.org',
  'https://1rpc.io/base',
  'https://base.meowrpc.com'
];

const PARALLEL_FETCHES = parseInt(process.env.PARALLEL_FETCHES || '10');

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

if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true });

let index = { lastSync: null, ethLastBlock: 0, baseLastBlock: 0, totalAgents: 0, agents: [], stats: {} };
if (existsSync(INDEX_FILE)) {
  index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
}

let ethRpcIndex = 0;
let baseRpcIndex = 0;

function createEthClient() {
  return createPublicClient({
    chain: mainnet,
    transport: http(ETH_RPCS[ethRpcIndex % ETH_RPCS.length], {
      timeout: 30_000,
      retryCount: 0,
    })
  });
}

function createBaseClient() {
  return createPublicClient({
    chain: base,
    transport: http(BASE_RPCS[baseRpcIndex % BASE_RPCS.length], {
      timeout: 30_000,
      retryCount: 0,
    })
  });
}

let ethClient = createEthClient();
let baseClient = createBaseClient();

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      ethRpcIndex++;
      baseRpcIndex++;
      ethClient = createEthClient();
      baseClient = createBaseClient();
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function parseAgentURI(uri) {
  if (!uri) return {};
  try {
    if (uri.startsWith('data:application/json;base64,')) {
      const base64 = uri.replace('data:application/json;base64,', '');
      return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    }
    if (uri.startsWith('data:application/json,')) {
      return JSON.parse(decodeURIComponent(uri.replace('data:application/json,', '')));
    }
    if (uri.startsWith('http')) {
      const res = await fetch(uri, { signal: AbortSignal.timeout(10000) });
      return res.json();
    }
    if (uri.startsWith('ipfs://')) {
      const cid = uri.replace('ipfs://', '');
      const gateways = [
        `https://ipfs.io/ipfs/${cid}`,
        `https://cloudflare-ipfs.com/ipfs/${cid}`,
        `https://gateway.pinata.cloud/ipfs/${cid}`
      ];
      for (const gw of gateways) {
        try {
          const res = await fetch(gw, { signal: AbortSignal.timeout(15000) });
          if (res.ok) return res.json();
        } catch {}
      }
    }
  } catch (e) {
    return {};
  }
}

async function getMintEvents(client, fromBlock, toBlock, label, indexRef, indexFile) {
  const totalBlocks = BigInt(toBlock) - BigInt(fromBlock);
  console.log(`📥 Scanning ${label} blocks ${fromBlock} to ${toBlock} (${totalBlocks.toLocaleString()} blocks)...`);
  
  const allMints = new Map();
  let current = BigInt(fromBlock);
  const end = BigInt(toBlock);
  const chunk = label.includes('Base') ? BASE_BLOCK_CHUNK : ETH_BLOCK_CHUNK;
  const isEth = label.includes('Ethereum');
  let chunksProcessed = 0;
  const totalChunks = Number((end - current) / chunk) + 1;
  
  while (current <= end) {
    const chunkEnd = current + chunk > end ? end : current + chunk - 1n;
    
    try {
      const logs = await withRetry(() => 
        client.getLogs({
          address: REGISTRY,
          event: TRANSFER_EVENT,
          args: { from: ZERO_ADDRESS },
          fromBlock: current,
          toBlock: chunkEnd
        })
      );
      
      for (const log of logs) {
        const tokenId = Number(log.args.tokenId);
        if (!allMints.has(tokenId)) {
          allMints.set(tokenId, {
            tokenId,
            to: log.args.to,
            blockNumber: Number(log.blockNumber),
            txHash: log.transactionHash
          });
        }
      }
    } catch (err) {
      console.error(`   ⚠️  Error at ${current}-${chunkEnd}: ${err.message?.slice(0, 80)}`);
    }
    
    chunksProcessed++;
    
    // Log progress every 50 chunks or on the last chunk
    if (chunksProcessed % 50 === 0 || chunkEnd >= end) {
      const pct = Math.round(Number(chunkEnd - BigInt(fromBlock)) / Number(totalBlocks) * 100);
      console.log(`   ${label}: block ${chunkEnd} (${pct}%) — found ${allMints.size} mints`);
    }

    // Save checkpoint every 200 chunks so progress survives cancellation
    if (chunksProcessed % 200 === 0 && indexRef && indexFile) {
      if (isEth) {
        indexRef.ethLastBlock = Number(chunkEnd);
      } else {
        indexRef.baseLastBlock = Number(chunkEnd);
      }
      try {
        writeFileSync(indexFile, JSON.stringify(indexRef, null, 2));
        console.log(`   💾 Checkpoint saved at block ${chunkEnd}`);
      } catch (e) {
        console.error(`   ⚠️  Checkpoint write failed: ${e.message}`);
      }
    }
    
    current = chunkEnd + 1n;
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`   ✅ ${label}: total mints found = ${allMints.size}`);
  return allMints;
}

async function fetchAgent(client, id, mintInfo) {
  try {
    const [uri, owner] = await Promise.all([
      withRetry(() => client.readContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'tokenURI',
        args: [BigInt(id)]
      })),
      withRetry(() => client.readContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'ownerOf',
        args: [BigInt(id)]
      }))
    ]);

    const metadata = await parseAgentURI(uri);

    return {
      id,
      owner,
      chain: client === ethClient ? 'ethereum' : 'base',
      name: metadata.name || `Agent #${id}`,
      description: metadata.description || '',
      image: metadata.image || '',
      active: metadata.active ?? true,
      x402Support: metadata.x402Support ?? false,
      services: metadata.services || [],
      registeredBlock: mintInfo?.blockNumber || null,
      txHash: mintInfo?.txHash || null,
      rawMetadata: metadata,
      syncedAt: new Date().toISOString()
    };
  } catch (err) {
    return { id, error: err.message?.slice(0, 100), chain: 'unknown', syncedAt: new Date().toISOString() };
  }
}

async function syncAgents() {
  console.log('🔄 Starting ERC-8004 sync (Ethereum + Base)...');
  console.log(`   Registry: ${REGISTRY}`);
  
  const forceRefresh = process.env.FORCE_REFRESH === 'true';
  
  const [ethBlock, baseBlock] = await Promise.all([
    ethClient.getBlockNumber(),
    baseClient.getBlockNumber()
  ]);
  
  console.log(`   ETH block: ${ethBlock}`);
  console.log(`   Base block: ${baseBlock}`);

  const existingIds = new Set();
  if (existsSync(AGENTS_DIR)) {
    for (const file of readdirSync(AGENTS_DIR)) {
      if (file.endsWith('.json')) {
        existingIds.add(parseInt(file.replace('.json', '')));
      }
    }
  }
  console.log(`   Existing: ${existingIds.size}`);

  const ethFromBlock = forceRefresh || !index.ethLastBlock
    ? ETH_START_BLOCK 
    : BigInt(index.ethLastBlock + 1);
  
  const baseFromBlock = forceRefresh || !index.baseLastBlock
    ? BASE_START_BLOCK 
    : BigInt(index.baseLastBlock + 1);
  
  // Run sequentially (not in parallel) so checkpoints don't conflict
  const ethMints = await getMintEvents(ethClient, ethFromBlock, ethBlock, 'Ethereum', index, INDEX_FILE);
  const baseMints = await getMintEvents(baseClient, baseFromBlock, baseBlock, 'Base', index, INDEX_FILE);
  
  console.log(`\n   ETH mints: ${ethMints.size}`);
  console.log(`   Base mints: ${baseMints.size}`);
  console.log(`   Total new: ${ethMints.size + baseMints.size}`);

  const idsToSync = [];
  for (const [tokenId, mintInfo] of [...ethMints, ...baseMints]) {
    if (forceRefresh || !existingIds.has(tokenId)) {
      const chain = mintInfo === ethMints.get(tokenId) ? 'ethereum' : 'base';
      idsToSync.push({ id: tokenId, mintInfo, chain });
    }
  }
  
  console.log(`   Syncing: ${idsToSync.length}`);

  const stats = { 
    ethereum: { active: 0, inactive: 0, errors: 0 },
    base: { active: 0, inactive: 0, errors: 0 }
  };

  for (let i = 0; i < idsToSync.length; i += PARALLEL_FETCHES) {
    const batch = idsToSync.slice(i, i + PARALLEL_FETCHES);
    const client = batch[0].chain === 'ethereum' ? ethClient : baseClient;
    const results = await Promise.all(batch.map(({ id, mintInfo, chain }) => 
      fetchAgent(client, id, mintInfo)
    ));
    
    for (const agent of results) {
      const chainStats = agent.chain === 'ethereum' ? stats.ethereum : stats.base;
      if (agent.error) {
        chainStats.errors++;
      } else {
        if (agent.active) chainStats.active++;
        else chainStats.inactive++;
        if (agent.x402Support) (agent.chain === 'ethereum' ? stats.ethereum : stats.base).x402++;
        if (agent.services?.length > 0) (agent.chain === 'ethereum' ? stats.ethereum : stats.base).withServices++;
        existingIds.add(agent.id);
      }
      
      const agentFile = join(AGENTS_DIR, `${agent.id}.json`);
      writeFileSync(agentFile, JSON.stringify(agent, null, 2));
    }
    
    const pct = Math.round((i + batch.length) / idsToSync.length * 100);
    if (pct % 10 === 0 || i + batch.length === idsToSync.length) {
      console.log(`   Syncing agents: ${i + batch.length}/${idsToSync.length} (${pct}%)`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  for (const id of existingIds) {
    if (!idsToSync.find(x => x.id === id)) {
      try {
        const agent = JSON.parse(readFileSync(join(AGENTS_DIR, `${id}.json`), 'utf8'));
        if (!agent.error) {
          const chainStats = agent.chain === 'ethereum' ? stats.ethereum : stats.base;
          if (agent.active) chainStats.active++;
          else chainStats.inactive++;
          if (agent.x402Support) chainStats.x402++;
          if (agent.services?.length > 0) chainStats.withServices++;
        }
      } catch {}
    }
  }

  const allIds = Array.from(existingIds).sort((a, b) => b - a);
  
  index = {
    lastSync: new Date().toISOString(),
    ethLastBlock: Number(ethBlock),
    baseLastBlock: Number(baseBlock),
    totalAgents: allIds.length,
    agents: allIds,
    stats: {
      ethereum: { ...stats.ethereum },
      base: { ...stats.base },
      totalErrors: stats.ethereum.errors + stats.base.errors
    }
  };

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  
  console.log('\n✅ Sync complete!');
  console.log(`   Total: ${allIds.length}`);
  console.log(`   Ethereum: ${stats.ethereum.active}/${stats.ethereum.active + stats.ethereum.inactive} | x402: ${stats.ethereum.x402}`);
  console.log(`   Base: ${stats.base.active}/${stats.base.active + stats.base.inactive} | x402: ${stats.base.x402}`);
}

syncAgents().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
