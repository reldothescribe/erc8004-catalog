#!/usr/bin/env node
// Build Pagefind search index from agent data

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const dataDir = join(import.meta.dirname, '..', 'data');
const agentsDir = join(dataDir, 'agents');

// Generate minimal HTML pages for Pagefind to index
const pagesDir = join(import.meta.dirname, '..', '_pages');
mkdirSync(pagesDir, { recursive: true });

console.log('Generating searchable pages...');

const files = readdirSync(agentsDir).filter(f => f.endsWith('.json'));
let count = 0;

for (const file of files) {
  const agent = JSON.parse(readFileSync(join(agentsDir, file), 'utf8'));
  const tokenId = file.replace('.json', '');
  
  // Generate minimal HTML page for Pagefind
  const html = `<!DOCTYPE html>
<html>
<head><title>${agent.name || `Agent #${tokenId}`}</title></head>
<body>
<article data-pagefind-body>
  <h1 data-pagefind-meta="name">${agent.name || 'Unnamed Agent'}</h1>
  <p data-pagefind-meta="tokenId">${tokenId}</p>
  <p data-pagefind-meta="address">${agent.address || ''}</p>
  <p data-pagefind-meta="chain">${agent.chain || 'ethereum'}</p>
  <p data-pagefind-meta="owner">${agent.owner || ''}</p>
  <p>${agent.description || ''}</p>
  ${agent.systemPrompt ? `<div>${agent.systemPrompt.slice(0, 500)}</div>` : ''}
</article>
</body>
</html>`;

  writeFileSync(join(pagesDir, `${tokenId}.html`), html);
  count++;
  
  if (count % 1000 === 0) {
    console.log(`Generated ${count} pages...`);
  }
}

console.log(`Generated ${count} pages total`);

// Run Pagefind
console.log('Building Pagefind index...');
execSync('npx pagefind --site . --output-path pagefind', {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'inherit'
});

console.log('Done!');
