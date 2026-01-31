// ERC-8004 Agent Catalog Frontend

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

let agents = [];
let index = null;

async function loadIndex() {
  const res = await fetch('data/index.json');
  index = await res.json();
  return index;
}

async function loadAgent(id) {
  const res = await fetch(`data/agents/${id}.json`);
  return res.json();
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function truncateAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function renderAgent(agent) {
  const services = (agent.services || []).map(s => 
    `<span class="service-badge">${s.name}${s.version ? ` v${s.version}` : ''}</span>`
  ).join('');

  const avatar = agent.image 
    ? `<img src="${agent.image}" alt="${agent.name}" />`
    : '🤖';

  return `
    <article class="agent-card" data-id="${agent.id}">
      <div class="agent-header">
        <div class="agent-avatar">${avatar}</div>
        <div>
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-id">#${agent.id} · ${truncateAddress(agent.owner)}</div>
        </div>
      </div>
      <p class="agent-description">${escapeHtml(agent.description || 'No description provided.')}</p>
      ${services ? `<div class="agent-services">${services}</div>` : ''}
      <div class="agent-status ${agent.active ? 'status-active' : 'status-inactive'}">
        <span class="status-dot"></span>
        ${agent.active ? 'Active' : 'Inactive'}
        ${agent.x402Support ? ' · x402' : ''}
      </div>
      <div class="agent-links">
        <a href="https://etherscan.io/nft/${REGISTRY}/${agent.id}" target="_blank">Etherscan</a>
        <a href="data/agents/${agent.id}.json" target="_blank">JSON</a>
      </div>
    </article>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderAgents(agentList) {
  const grid = document.getElementById('agents-grid');
  
  if (agentList.length === 0) {
    grid.innerHTML = '<p class="empty">No agents found.</p>';
    return;
  }
  
  grid.innerHTML = agentList.map(renderAgent).join('');
}

function filterAgents(query) {
  if (!query) return agents;
  const q = query.toLowerCase();
  return agents.filter(a => 
    a.name?.toLowerCase().includes(q) ||
    a.description?.toLowerCase().includes(q) ||
    a.owner?.toLowerCase().includes(q)
  );
}

async function init() {
  try {
    const idx = await loadIndex();
    
    // Update stats
    document.getElementById('total-agents').textContent = idx.totalAgents || 0;
    document.getElementById('last-sync').textContent = formatDate(idx.lastSync);
    
    // Load all agents
    if (idx.agents && idx.agents.length > 0) {
      const agentPromises = idx.agents.map(id => loadAgent(id).catch(() => null));
      agents = (await Promise.all(agentPromises)).filter(Boolean);
      renderAgents(agents);
    } else {
      document.getElementById('agents-grid').innerHTML = 
        '<p class="empty">No agents registered yet. <a href="https://howto8004.com" target="_blank">Be the first!</a></p>';
    }
    
    // Setup search
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', (e) => {
      const filtered = filterAgents(e.target.value);
      renderAgents(filtered);
    });
    
  } catch (err) {
    console.error('Failed to load agents:', err);
    document.getElementById('agents-grid').innerHTML = 
      '<p class="empty">Failed to load agents. Please try again later.</p>';
  }
}

init();
