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

// Exit gracefully after this many ms so the commit step can save progress.
// Default: 5.5 hours (GitHub Actions max is 6h).
const DEADLINE_MS = parseFloat(process.env.MAX_RUNTIME_HOURS || '5.5') * 60 * 60 * 1000;

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
    transport: http(ETH_RPCS[ethRpcIndex % ETH_RPCS.length])
  });
}

function createBaseClient() {
  return createPublicClient({
    chain: base,
    transport: http(BASE_RPCS[baseRpcIndex % BASE_RPCS.length])
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
      // Race all gateways in parallel instead of trying them sequentially.
      // This cuts worst-case IPFS wait from 45s (3×15s) down to 15s.
      const result = await Promise.any(
        gateways.map(gw =>
          fetch(gw, { signal: AbortSignal.timeout(15000) })
            .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
        )
      ).catch(() => ({}));
      return result || {};
    }
  } catch (e) {
    return {};
  }
}

async function getMintEvents(client, fromBlock, toBlock, label) {
  console.log(`📥 Scanning ${label} blocks ${fromBlock} to ${toBlock}...`);
  
  const allMints = new Map();
  let current = BigInt(fromBlock);
  const end = BigInt(toBlock);
  const chunk = label.includes('Base') ? BASE_BLOCK_CHUNK : ETH_BLOCK_CHUNK;
  
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
      
      process.stdout.write(`\r   ${label}: block ${chunkEnd} - found ${allMints.size}`);
    } catch (err) {
      console.error(`     Error at ${current}-${chunkEnd}: ${err.message?.slice(0, 40)}`);
    }
    
    current = chunkEnd + 1n;
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`   Total mints: ${allMints.size}`);
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
  const startTime = Date.now();
  console.log('🔄 Starting ERC-8004 sync (Ethereum + Base)...');
  console.log(`   Registry: ${REGISTRY}`);
  console.log(`   Deadline: ${DEADLINE_MS / 3600000}h`);
  
  const forceRefresh = process.env.FORCE_REFRESH === 'true';

  const existingIds = new Set();
  if (existsSync(AGENTS_DIR)) {
    for (const file of readdirSync(AGENTS_DIR)) {
      if (file.endsWith('.json')) {
        existingIds.add(parseInt(file.replace('.json', '')));
      }
    }
  }
  console.log(`   Existing: ${existingIds.size}`);

  // --- Determine what to sync ---
  // If there's a pending queue from a previous interrupted run, resume it.
  // Otherwise, scan the blockchain for new mints.
  let idsToSync = [];
  let ethBlock, baseBlock;

  const hasPending = !forceRefresh && Array.isArray(index.pendingAgentIds) && index.pendingAgentIds.length > 0;

  if (hasPending) {
    console.log(`\n⏩ Resuming ${index.pendingAgentIds.length} pending agents from previous interrupted run...`);
    idsToSync = index.pendingAgentIds;
    // Use the block numbers already saved from the previous scan
    ethBlock = BigInt(index.ethLastBlock);
    baseBlock = BigInt(index.baseLastBlock);
  } else {
    [ethBlock, baseBlock] = await Promise.all([
      ethClient.getBlockNumber(),
      baseClient.getBlockNumber()
    ]);

    console.log(`   ETH block: ${ethBlock}`);
    console.log(`   Base block: ${baseBlock}`);

    const ethFromBlock = forceRefresh || !index.ethLastBlock
      ? ETH_START_BLOCK
      : BigInt(index.ethLastBlock + 1);

    const baseFromBlock = forceRefresh || !index.baseLastBlock
      ? BASE_START_BLOCK
      : BigInt(index.baseLastBlock + 1);

    const [ethMints, baseMints] = await Promise.all([
      getMintEvents(ethClient, ethFromBlock, ethBlock, 'Ethereum'),
      getMintEvents(baseClient, baseFromBlock, baseBlock, 'Base')
    ]);

    console.log(`\n   ETH mints: ${ethMints.size}`);
    console.log(`   Base mints: ${baseMints.size}`);
    console.log(`   Total new: ${ethMints.size + baseMints.size}`);

    for (const [tokenId, mintInfo] of [...ethMints, ...baseMints]) {
      if (forceRefresh || !existingIds.has(tokenId)) {
        const chain = ethMints.has(tokenId) ? 'ethereum' : 'base';
        idsToSync.push({ id: tokenId, mintInfo, chain });
      }
    }

    console.log(`   Syncing: ${idsToSync.length}`);

    // Save the pending queue + new block pointers NOW, before we start fetching.
    // This means even if the job is cancelled mid-fetch, next run resumes from here.
    if (idsToSync.length > 0) {
      index.pendingAgentIds = idsToSync;
      index.ethLastBlock = Number(ethBlock);
      index.baseLastBlock = Number(baseBlock);
      writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
      console.log(`   📌 Checkpointed ${idsToSync.length} pending agents to index.json`);
    }
  }

  // --- Fetch agent metadata ---
  const stats = {
    ethereum: { active: 0, inactive: 0, errors: 0, x402: 0, withServices: 0 },
    base: { active: 0, inactive: 0, errors: 0, x402: 0, withServices: 0 }
  };

  let timedOut = false;

  for (let i = 0; i < idsToSync.length; i += PARALLEL_FETCHES) {
    // Check deadline before each batch
    if (Date.now() - startTime > DEADLINE_MS) {
      const remaining = idsToSync.length - i;
      console.log(`\n⏱️  Deadline reached. ${i} processed, ${remaining} remaining. Saving checkpoint...`);
      index.pendingAgentIds = idsToSync.slice(i);
      writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
      timedOut = true;
      break;
    }

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
        if (agent.x402Support) chainStats.x402++;
        if (agent.services?.length > 0) chainStats.withServices++;
        existingIds.add(agent.id);
      }

      const agentFile = join(AGENTS_DIR, `${agent.id}.json`);
      writeFileSync(agentFile, JSON.stringify(agent, null, 2));
    }

    const processed = i + batch.length;
    const pct = Math.round(processed / idsToSync.length * 100);
    process.stdout.write(`\r   Syncing: ${processed}/${idsToSync.length} (${pct}%)`);

    // Save incremental progress after each batch
    index.pendingAgentIds = idsToSync.slice(processed);
    writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));

    await new Promise(r => setTimeout(r, 150));
  }

  if (timedOut) {
    console.log('\n⚠️  Sync incomplete — will resume next run.');
    return;
  }

  // --- Finalize: tally stats for already-existing agents ---
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
    // pendingAgentIds is intentionally omitted — queue is clear
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
