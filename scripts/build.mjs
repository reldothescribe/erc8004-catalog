#!/usr/bin/env node
/**
 * Build script for Cloudflare Pages
 * Copies static assets to dist/
 */

import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

// Clean dist
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true });
}
mkdirSync(DIST, { recursive: true });

// Copy static files
console.log('Building static assets...');

cpSync(join(ROOT, 'index.html'), join(DIST, 'index.html'));
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
cpSync(join(ROOT, '_headers'), join(DIST, '_headers'));

// Note: functions/ stays at root level for Pages Functions

console.log('✅ Build complete: dist/');
