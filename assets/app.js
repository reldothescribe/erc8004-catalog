/**
 * ERC-8004 Catalog Frontend
 * Fetches from /api/* endpoints with edge caching
 */

const API_BASE = '/api';
const PAGE_SIZE = 50;

let currentPage = 1;
let currentQuery = '';
let currentChain = '';
let totalPages = 1;

// DOM Elements
const agentsContainer = document.getElementById('agents');
const searchInput = document.getElementById('search');
const totalCount = document.getElementById('total-count');
const pagination = document.getElementById('pagination');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await loadAgents();
  
  // Search with debounce
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentQuery = e.target.value.trim();
      currentPage = 1;
      loadAgents();
    }, 300);
  });
  
  // Handle URL params
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) {
    searchInput.value = params.get('q');
    currentQuery = params.get('q');
  }
  if (params.get('chain')) {
    currentChain = params.get('chain');
  }
  if (params.get('page')) {
    currentPage = parseInt(params.get('page'));
  }
});

async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    const data = await res.json();
    totalCount.textContent = `${data.total.toLocaleString()} agents`;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadAgents() {
  agentsContainer.innerHTML = '<div class="loading">Loading agents...</div>';
  
  const params = new URLSearchParams();
  params.set('page', currentPage);
  params.set('limit', PAGE_SIZE);
  if (currentQuery) params.set('q', currentQuery);
  if (currentChain) params.set('chain', currentChain);
  
  // Update URL
  const url = new URL(window.location);
  url.search = params.toString();
  window.history.replaceState({}, '', url);
  
  try {
    const res = await fetch(`${API_BASE}/agents?${params}`);
    const data = await res.json();
    
    if (data.error) {
      agentsContainer.innerHTML = `<div class="error">${data.error}</div>`;
      return;
    }
    
    totalPages = data.pagination.pages;
    
    if (data.agents.length === 0) {
      agentsContainer.innerHTML = '<div class="empty">No agents found</div>';
      pagination.innerHTML = '';
      return;
    }
    
    renderAgents(data.agents);
    renderPagination(data.pagination);
  } catch (err) {
    agentsContainer.innerHTML = `<div class="error">Failed to load agents: ${err.message}</div>`;
  }
}

function renderAgents(agents) {
  agentsContainer.innerHTML = agents.map(agent => {
    const meta = agent.metadata || {};
    const name = meta.name || agent.name || `Agent #${agent.token_id}`;
    const description = meta.description || '';
    const chainLabel = agent.chain === 'base' ? '🔵 Base' : '🔷 Ethereum';
    
    return `
      <article class="agent-card" data-id="${agent.token_id}">
        <div class="agent-header">
          <h3 class="agent-name">${escapeHtml(name)}</h3>
          <span class="agent-chain">${chainLabel}</span>
        </div>
        ${description ? `<p class="agent-desc">${escapeHtml(truncate(description, 200))}</p>` : ''}
        <div class="agent-footer">
          <code class="agent-id">#${agent.token_id}</code>
          <span class="agent-owner" title="${agent.owner}">${truncateAddress(agent.owner)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderPagination({ page, pages, total }) {
  if (pages <= 1) {
    pagination.innerHTML = '';
    return;
  }
  
  let html = '<div class="pagination-inner">';
  
  // Prev
  if (page > 1) {
    html += `<button onclick="goToPage(${page - 1})">← Prev</button>`;
  }
  
  // Page numbers
  const range = getPageRange(page, pages);
  for (const p of range) {
    if (p === '...') {
      html += '<span class="ellipsis">...</span>';
    } else {
      html += `<button class="${p === page ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    }
  }
  
  // Next
  if (page < pages) {
    html += `<button onclick="goToPage(${page + 1})">Next →</button>`;
  }
  
  html += `<span class="page-info">Page ${page} of ${pages}</span>`;
  html += '</div>';
  
  pagination.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadAgents();
  window.scrollTo(0, 0);
}

function getPageRange(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  
  const range = [];
  range.push(1);
  
  if (current > 3) range.push('...');
  
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    range.push(i);
  }
  
  if (current < total - 2) range.push('...');
  
  range.push(total);
  
  return range;
}

// Utilities
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function truncateAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Expose for onclick handlers
window.goToPage = goToPage;
