// ERC-8004 Agent Catalog - Enhanced Frontend

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const BASESCAN = 'https://basescan.org';
const ETHERSCAN = 'https://etherscan.io';
const AGENTS_PER_PAGE = 24;

let allAgents = [];
let filteredAgents = [];
let currentPage = 1;
let currentFilter = 'all';
let currentSort = 'newest';
let index = null;
let pagefind = null;

// DOM elements
const grid = document.getElementById('agents-grid');
const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sort');
const pagination = document.getElementById('pagination');
const modal = document.getElementById('modal');

async function loadIndex() {
  const res = await fetch('data/index.json');
  return res.json();
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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function truncateAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getAvatarContent(agent) {
  if (agent.image) {
    // Handle IPFS
    let src = agent.image;
    if (src.startsWith('ipfs://')) {
      src = `https://ipfs.io/ipfs/${src.replace('ipfs://', '')}`;
    }
    return `<img src="${src}" alt="${escapeHtml(agent.name)}" onerror="this.parentElement.innerHTML='🤖'" />`;
  }
  return '🤖';
}

function renderAgent(agent) {
  if (agent.error) return ''; // Skip errored agents
  
  const services = (agent.services || []).slice(0, 3).map(s => 
    `<span class="tag tag-service">${escapeHtml(s.name || s.type || 'Service')}</span>`
  ).join('');
  
  const extraServices = (agent.services || []).length > 3 
    ? `<span class="tag tag-service">+${agent.services.length - 3}</span>` 
    : '';

  return `
    <article class="agent-card" data-id="${agent.id}" onclick="showAgentModal(${agent.id})">
      <div class="agent-header">
        <div class="agent-avatar">${getAvatarContent(agent)}</div>
        <div class="agent-info">
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-meta">
            <span class="agent-id">#${agent.id}</span>
            <span>${truncateAddress(agent.owner)}</span>
          </div>
        </div>
      </div>
      <p class="agent-description">${escapeHtml(agent.description || 'No description provided.')}</p>
      <div class="agent-tags">
        ${services}${extraServices}
        ${agent.x402Support ? '<span class="tag tag-x402">x402</span>' : ''}
      </div>
      <div class="agent-footer">
        <span class="status-badge ${agent.active !== false ? 'status-active' : 'status-inactive'}">
          <span class="status-dot"></span>
          ${agent.active !== false ? 'Active' : 'Inactive'}
        </span>
        <div class="agent-links">
          <a href="${BASESCAN}/nft/${REGISTRY}/${agent.id}" target="_blank" onclick="event.stopPropagation()">Basescan</a>
          <a href="data/agents/${agent.id}.json" target="_blank" onclick="event.stopPropagation()">JSON</a>
        </div>
      </div>
    </article>
  `;
}

function renderAgents(agents) {
  if (agents.length === 0) {
    grid.innerHTML = '<div class="empty"><p>No agents found matching your criteria.</p></div>';
    return;
  }
  
  const start = (currentPage - 1) * AGENTS_PER_PAGE;
  const pageAgents = agents.slice(start, start + AGENTS_PER_PAGE);
  
  grid.innerHTML = pageAgents.map(renderAgent).join('');
}

function renderPagination(totalAgents) {
  const totalPages = Math.ceil(totalAgents / AGENTS_PER_PAGE);
  
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // Previous
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">← Prev</button>`;
  
  // Page numbers
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  
  if (startPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) html += '<span class="page-info">...</span>';
  }
  
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="page-info">...</span>';
    html += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }
  
  // Next
  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">Next →</button>`;
  
  // Info
  const start = (currentPage - 1) * AGENTS_PER_PAGE + 1;
  const end = Math.min(currentPage * AGENTS_PER_PAGE, totalAgents);
  html += `<span class="page-info">${start}-${end} of ${totalAgents}</span>`;
  
  pagination.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderAgents(filteredAgents);
  renderPagination(filteredAgents.length);
  window.scrollTo({ top: grid.offsetTop - 100, behavior: 'smooth' });
}

async function applyFilters() {
  const query = searchInput.value.toLowerCase().trim();
  
  // Use Pagefind for search if available and query exists
  if (pagefind && query && query.length >= 2) {
    grid.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Searching...</p></div>';
    
    const searchResults = await searchWithPagefind(query);
    if (searchResults && searchResults.length > 0) {
      // Map search results to full agent data
      const resultIds = new Set(searchResults.map(r => r.id));
      filteredAgents = allAgents.filter(a => resultIds.has(a.id));
      
      // If we have results not in loaded agents, show search results directly
      if (filteredAgents.length === 0) {
        filteredAgents = searchResults;
      }
      
      currentPage = 1;
      renderAgents(filteredAgents);
      renderPagination(filteredAgents.length);
      return;
    }
  }
  
  // Fallback to local filtering
  filteredAgents = allAgents.filter(agent => {
    // Skip errored agents
    if (agent.error) return false;
    
    // Search filter
    if (query) {
      const searchable = [
        agent.name,
        agent.description,
        agent.owner,
        agent.id.toString()
      ].join(' ').toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    
    // Category filter
    switch (currentFilter) {
      case 'active':
        if (agent.active === false) return false;
        break;
      case 'x402':
        if (!agent.x402Support) return false;
        break;
      case 'services':
        if (!agent.services || agent.services.length === 0) return false;
        break;
    }
    
    return true;
  });
  
  // Apply sort
  filteredAgents.sort((a, b) => {
    switch (currentSort) {
      case 'newest':
        return b.id - a.id;
      case 'oldest':
        return a.id - b.id;
      case 'name':
        return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '');
      default:
        return 0;
    }
  });
  
  currentPage = 1;
  renderAgents(filteredAgents);
  renderPagination(filteredAgents.length);
}

function showAgentModal(id) {
  const agent = allAgents.find(a => a.id === id);
  if (!agent) return;
  
  document.getElementById('modal-title').textContent = agent.name || `Agent #${id}`;
  
  const services = (agent.services || []).map(s => `
    <div style="background: var(--border); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem;">
      <strong>${escapeHtml(s.name || s.type || 'Service')}</strong>
      ${s.version ? `<span style="color: var(--text-muted);"> v${s.version}</span>` : ''}
      ${s.endpoint ? `<br><code style="font-size: 0.8rem; color: var(--accent);">${escapeHtml(s.endpoint)}</code>` : ''}
    </div>
  `).join('') || '<p style="color: var(--text-muted);">No services registered.</p>';
  
  document.getElementById('modal-body').innerHTML = `
    <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: center;">
      <div class="agent-avatar" style="width: 80px; height: 80px; font-size: 2.5rem;">${getAvatarContent(agent)}</div>
      <div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">Token ID</div>
        <div style="font-family: monospace; font-size: 1.1rem;">#${agent.id}</div>
      </div>
    </div>
    
    <div style="margin-bottom: 1.5rem;">
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">Description</div>
      <p>${escapeHtml(agent.description || 'No description provided.')}</p>
    </div>
    
    <div style="margin-bottom: 1.5rem;">
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">Owner</div>
      <a href="${BASESCAN}/address/${agent.owner}" target="_blank" style="font-family: monospace;">${agent.owner}</a>
    </div>
    
    <div style="display: flex; gap: 2rem; margin-bottom: 1.5rem;">
      <div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">Status</div>
        <span class="status-badge ${agent.active !== false ? 'status-active' : 'status-inactive'}">
          <span class="status-dot"></span>
          ${agent.active !== false ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">x402 Support</div>
        <span>${agent.x402Support ? '✅ Yes' : '❌ No'}</span>
      </div>
    </div>
    
    <div style="margin-bottom: 1.5rem;">
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">Services</div>
      ${services}
    </div>
    
    <div style="display: flex; gap: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
      <a href="${BASESCAN}/nft/${REGISTRY}/${agent.id}" target="_blank" class="filter-btn" style="text-decoration: none;">View on Basescan</a>
      <a href="data/agents/${agent.id}.json" target="_blank" class="filter-btn" style="text-decoration: none;">Raw JSON</a>
    </div>
  `;
  
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// Close modal on overlay click
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

async function initPagefind() {
  try {
    pagefind = await import('/pagefind/pagefind.js');
    await pagefind.init();
    console.log('Pagefind initialized');
  } catch (err) {
    console.warn('Pagefind not available:', err);
  }
}

async function searchWithPagefind(query) {
  if (!pagefind || !query.trim()) return null;
  
  const results = await pagefind.search(query);
  const agents = await Promise.all(results.results.slice(0, 50).map(async r => {
    const data = await r.data();
    return {
      id: parseInt(data.meta?.tokenId || '0'),
      name: data.meta?.name || 'Unnamed',
      owner: data.meta?.owner,
      chain: data.meta?.chain || 'ethereum',
      excerpt: data.excerpt
    };
  }));
  
  return agents;
}

async function init() {
  // Initialize Pagefind in parallel
  initPagefind();
  
  try {
    index = await loadIndex();
    
    // Update stats
    document.getElementById('stat-total').textContent = index.totalAgents?.toLocaleString() || 0;
    document.getElementById('stat-active').textContent = index.stats?.active?.toLocaleString() || '-';
    document.getElementById('stat-x402').textContent = index.stats?.x402Support?.toLocaleString() || '-';
    document.getElementById('stat-services').textContent = index.stats?.withServices?.toLocaleString() || '-';
    document.getElementById('last-sync').textContent = formatRelativeTime(index.lastSync);
    
    // Load all agents
    if (index.agents && index.agents.length > 0) {
      grid.innerHTML = `
        <div class="loading">
          <div class="loading-spinner"></div>
          <p>Loading ${index.agents.length.toLocaleString()} agents...</p>
        </div>
      `;
      
      // Load in batches for better UX
      const batchSize = 50;
      for (let i = 0; i < index.agents.length; i += batchSize) {
        const batch = index.agents.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(id => loadAgent(id).catch(() => ({ id, error: true }))));
        allAgents.push(...results);
        
        // Update loading progress
        const pct = Math.round((i + batch.length) / index.agents.length * 100);
        grid.querySelector('p').textContent = `Loading agents... ${pct}%`;
      }
      
      applyFilters();
    } else {
      grid.innerHTML = '<div class="empty"><p>No agents registered yet. <a href="https://howto8004.com" target="_blank">Be the first!</a></p></div>';
    }
    
    // Setup event listeners
    searchInput.addEventListener('input', debounce(applyFilters, 300));
    
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      applyFilters();
    });
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        applyFilters();
      });
    });
    
  } catch (err) {
    console.error('Failed to load agents:', err);
    grid.innerHTML = '<div class="empty"><p>Failed to load agents. Please try again later.</p></div>';
  }
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

// Make functions globally available
window.goToPage = goToPage;
window.showAgentModal = showAgentModal;
window.closeModal = closeModal;

init();
