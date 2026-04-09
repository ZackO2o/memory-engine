#!/usr/bin/env node
/**
 * memory-boot.js — Single-command session startup (replaces 3 separate calls)
 * Usage: node memory-boot.js [--workspace /path] [--max-chars N]
 * 
 * Does in one call:
 * 1. Health check
 * 2. Incremental index update (+ orphan cleanup)
 * 3. Output MEMORY.md (smart truncation when large)
 * 
 * --max-chars N: Max chars for MEMORY.md output (default 1500, ~500 tokens)
 *   When MEMORY.md exceeds limit: outputs section headers + most recent entries
 *   This prevents token waste as memory grows over months
 */
const fs = require('fs'), path = require('path');

const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');
const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE;
let maxChars = 1500;  // ~500 tokens — safe default
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) workspace = args[++i];
  if (args[i] === '--max-chars' && args[i + 1]) maxChars = parseInt(args[++i]) || 1500;
  if (args[i] === '--full') maxChars = Infinity;  // no truncation
}

const MEMORY_DIR = path.join(workspace, 'memory');
const MEMORY_MD = path.join(workspace, 'MEMORY.md');

const { getToday: _getToday } = require('./_timezone');
function getToday() { return _getToday(workspace); }

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

// 2. Index update (auto-recovers from corrupted DB)
function updateIndex() {
  const indexScript = path.join(__dirname, 'memory-index.js');
  if (!fs.existsSync(indexScript)) return { indexed: 0, error: 'index script not found' };
  try {
    const result = require('child_process').execSync(
      `node "${indexScript}" --workspace "${workspace}"`,
      { encoding: 'utf8', stdio: 'pipe', timeout: 30000 }
    );
    return JSON.parse(result.trim());
  } catch (e) {
    // If index script crashed (e.g., corrupted DB), try force rebuild
    try {
      const result = require('child_process').execSync(
        `node "${indexScript}" --workspace "${workspace}" --force`,
        { encoding: 'utf8', stdio: 'pipe', timeout: 30000 }
      );
      return JSON.parse(result.trim());
    } catch (e2) {
      return { indexed: 0, error: 'index failed: ' + (e2.message || '').slice(0, 100) };
    }
  }
}

// 3. MEMORY.md content (smart truncation for token efficiency)
function readCore(limit) {
  if (!fs.existsSync(MEMORY_MD)) return null;
  const content = fs.readFileSync(MEMORY_MD, 'utf8');
  if (content.length <= limit) return content;

  // Smart truncation: keep section headers + most recent entries per section
  const lines = content.split('\n');
  const sections = [];
  let current = { header: '', lines: [], recentLines: [] };

  for (const line of lines) {
    if (line.match(/^##\s/)) {
      if (current.header || current.lines.length) sections.push(current);
      current = { header: line, lines: [], recentLines: [] };
    } else if (line.match(/^#\s/)) {
      // Keep top-level heading always
      if (current.header || current.lines.length) sections.push(current);
      current = { header: line, lines: [], recentLines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.header || current.lines.length) sections.push(current);

  // Build output: headers + last N entries per section to fit budget
  let result = '';
  const headerBudget = sections.reduce((s, sec) => s + sec.header.length + 1, 0);
  const contentBudget = limit - headerBudget - 50; // 50 chars for truncation notice
  const perSection = Math.max(100, Math.floor(contentBudget / Math.max(1, sections.length)));

  for (const sec of sections) {
    result += sec.header + '\n';
    const content = sec.lines.join('\n').trim();
    if (content.length <= perSection) {
      result += content + '\n\n';
    } else {
      // Take last N chars (most recent entries)
      const tail = content.slice(-perSection);
      const firstNl = tail.indexOf('\n');
      result += '…\n' + (firstNl >= 0 ? tail.slice(firstNl + 1) : tail) + '\n\n';
    }
  }

  return result.trimEnd() + `\n\n_(truncated: ${content.length} chars → ${result.length} chars)_`;
}

// Run all
const health = healthCheck();
const index = updateIndex();
const core = readCore(maxChars);

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
