#!/usr/bin/env node
/**
 * memory-boot.js — Single-command session startup (replaces 3 separate calls)
 * Usage: node memory-boot.js [--workspace /path]
 * 
 * Does in one call:
 * 1. Health check
 * 2. Incremental index update (+ orphan cleanup)
 * 3. Output MEMORY.md summary (first 2000 chars)
 * 
 * Saves 2 tool calls per session startup.
 */
const fs = require('fs'), path = require('path');

const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');
const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) workspace = args[++i];
}

const MEMORY_DIR = path.join(workspace, 'memory');
const MEMORY_MD = path.join(workspace, 'MEMORY.md');

function getToday() {
  const tz = process.env.TZ || process.env.OPENCLAW_TZ || 'UTC';
  try { return new Date().toLocaleDateString('en-CA', { timeZone: tz }); }
  catch { return new Date().toISOString().slice(0, 10); }
}

// 1. Health check (inline, no separate script call)
function healthCheck() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const today = getToday();
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/)).sort();
  const hasCore = fs.existsSync(MEMORY_MD);
  const hasTodayLog = files.includes(`${today}.md`);
  const earliest = files.length > 0 ? files[0].replace('.md', '') : today;
  let gaps = 0;
  for (let i = 1; i < 14; i++) {
    const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (ds < earliest) break;
    if (!files.includes(`${ds}.md`)) gaps++;
  }
  const score = Math.max(0, 100 - gaps * 7 - (hasCore ? 0 : 20) - (hasTodayLog ? 0 : 15));
  return { today, hasTodayLog, hasCore, dailyFiles: files.length, gaps, score };
}

// 2. Index update
function updateIndex() {
  const indexScript = path.join(__dirname, 'memory-index.js');
  if (!fs.existsSync(indexScript)) return { indexed: 0, error: 'index script not found' };
  try {
    const result = require('child_process').execSync(
      `node "${indexScript}" --workspace "${workspace}"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return JSON.parse(result.trim());
  } catch (e) {
    return { indexed: 0, error: e.message };
  }
}

// 3. MEMORY.md content (truncated)
function readCore(maxChars = 2000) {
  if (!fs.existsSync(MEMORY_MD)) return null;
  const content = fs.readFileSync(MEMORY_MD, 'utf8');
  if (content.length <= maxChars) return content;
  const cut = content.slice(0, maxChars);
  const nl = cut.lastIndexOf('\n');
  return (nl > maxChars * 0.5 ? cut.slice(0, nl) : cut) + '\n…(truncated)';
}

// Run all
const health = healthCheck();
const index = updateIndex();
const core = readCore();

// Compact output
const warnings = [];
if (!health.hasCore) warnings.push('⚠️ MEMORY.md missing');
if (!health.hasTodayLog) warnings.push(`⚠️ No log for ${health.today}`);
if (health.gaps > 3) warnings.push(`⚠️ ${health.gaps} gaps in 14 days`);
if (index.cleaned > 0) warnings.push(`🧹 Cleaned ${index.cleaned} orphan(s)`);

console.log(`[boot] Health: ${health.score}/100 | Files: ${health.dailyFiles} | Index: ${index.totalChunks || '?'} chunks${index.indexed > 0 ? ` (${index.indexed} updated)` : ''}${warnings.length ? ' | ' + warnings.join(' | ') : ''}`);
if (core) {
  console.log('---');
  console.log(core);
}
