// ERC-8004 Registry
const PER_PAGE = 50;
let agents = [];
let filtered = [];
let page = 1;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

async function loadAgents() {
  const agentsEl = $('#agents');
  
  try {
    // Load all agent files from the data directory
    const indexRes = await fetch('data/index.json');
    const index = await indexRes.json();
    
    // Update count
    $('#total-count').textContent = `${index.agents?.length || 0} agents`;
    
    if (!index.agents?.length) {
      agentsEl.innerHTML = '<div class="empty">No agents found.</div>';
      return;
    }
    
    // Load agents in batches
    agentsEl.innerHTML = '<div class="loading">Loading...</div>';
    
    const batchSize = 100;
    for (let i = 0; i < index.agents.length; i += batchSize) {
      const batch = index.agents.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(id => 
          fetch(`data/agents/${id}.json`)
            .then(r => r.json())
            .catch(() => null)
        )
      );
      agents.push(...results.filter(Boolean));
      
      // Update loading progress
      const pct = Math.round((agents.length / index.agents.length) * 100);
      agentsEl.innerHTML = `<div class="loading">Loading ${agents.length}/${index.agents.length} (${pct}%)</div>`;
    }
    
    filtered = [...agents];
    render();
    
  } catch (err) {
    console.error(err);
    agentsEl.innerHTML = '<div class="empty">Failed to load agents.</div>';
  }
}

function render() {
  const agentsEl = $('#agents');
  const start = (page - 1) * PER_PAGE;
  const pageAgents = filtered.slice(start, start + PER_PAGE);
  
  if (pageAgents.length === 0) {
    agentsEl.innerHTML = '<div class="empty">No agents match your search.</div>';
    $('#pagination').innerHTML = '';
    return;
  }
  
  agentsEl.innerHTML = pageAgents.map(a => `
    <div class="agent" data-id="${a.id}">
      <div class="agent-main">
        <div class="agent-name">
          ${esc(a.name || 'Unnamed')}
          <code>#${a.id}</code>
        </div>
        <div class="agent-desc">${esc(a.description || '—')}</div>
      </div>
      <div class="agent-meta">
        <span class="agent-chain">${a.chain || 'eth'}</span>
        <span>${truncAddr(a.owner)}</span>
      </div>
    </div>
  `).join('');
  
  // Add click handlers
  $$('.agent').forEach(el => {
    el.addEventListener('click', () => showModal(el.dataset.id));
  });
  
  renderPagination();
}

function renderPagination() {
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  if (totalPages <= 1) {
    $('#pagination').innerHTML = '';
    return;
  }
  
  $('#pagination').innerHTML = `
    <button ${page === 1 ? 'disabled' : ''} onclick="goPage(${page - 1})">← Prev</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button ${page === totalPages ? 'disabled' : ''} onclick="goPage(${page + 1})">Next →</button>
  `;
}

function goPage(p) {
  page = p;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function search(q) {
  q = q.toLowerCase().trim();
  if (!q) {
    filtered = [...agents];
  } else {
    filtered = agents.filter(a => {
      const searchable = [a.name, a.description, a.owner, a.id?.toString()].join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }
  page = 1;
  render();
}

function showModal(id) {
  const agent = agents.find(a => a.id == id);
  if (!agent) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>${esc(agent.name || 'Unnamed')} #${agent.id}</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <dl>
          <dt>Owner</dt>
          <dd><a href="https://etherscan.io/address/${agent.owner}" target="_blank">${agent.owner}</a></dd>
          <dt>Description</dt>
          <dd>${esc(agent.description || '—')}</dd>
          ${agent.services?.length ? `
            <dt>Services</dt>
            <dd>${agent.services.map(s => esc(s.name || s.type)).join(', ')}</dd>
          ` : ''}
        </dl>
        <h3 style="margin: 1rem 0 0.5rem; font-size: 0.875rem;">Raw</h3>
        <pre>${esc(JSON.stringify(agent, null, 2))}</pre>
      </div>
    </div>
  `;
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function truncAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

// Debounce helper
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Init
$('#search').addEventListener('input', debounce(e => search(e.target.value), 200));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelector('.modal-overlay')?.remove();
  }
});

window.goPage = goPage;
loadAgents();
