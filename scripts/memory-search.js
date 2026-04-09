#!/usr/bin/env node
/**
 * memory-search.js — BM25 + CJK bigram search with temporal decay
 * Usage: node memory-search.js "query" [--max 3] [--max-chars 200] [--json]
 * Token cost: ~300 tokens for 3 results (vs 6000+ reading full files)
 */
const fs = require('fs'), path = require('path');
const GLOBAL_MODULES = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
const Database = require(path.join(GLOBAL_MODULES, 'better-sqlite3'));

const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');
const HALF_LIFE_DAYS = 30;

const args = process.argv.slice(2);
let query = '', maxResults = 3, maxChars = 200, jsonOutput = false, workspace = DEFAULT_WORKSPACE;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max' && args[i + 1]) { maxResults = parseInt(args[++i]); continue; }
  if (args[i] === '--max-chars' && args[i + 1]) { maxChars = parseInt(args[++i]); continue; }
  if (args[i] === '--json') { jsonOutput = true; continue; }
  if (args[i] === '--workspace' && args[i + 1]) { workspace = args[++i]; continue; }
  if (!query) query = args[i];
}
if (!query) { console.error('Usage: memory-search.js "query" [--max N] [--max-chars N] [--json]'); process.exit(1); }

const DB_PATH = path.join(workspace, '.memory', 'index.sqlite');
if (!fs.existsSync(DB_PATH)) { console.error(JSON.stringify({ status: 'error', message: 'No index. Run memory-index.js first.' })); process.exit(1); }

function temporalDecay(dateStr) {
  if (!dateStr) return 1.0;
  const days = (Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000;
  return days < 0 ? 1.0 : Math.exp(-(Math.LN2 / HALF_LIFE_DAYS) * days);
}
function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max), nl = cut.lastIndexOf('\n');
  return (nl > max * 0.5 ? cut.slice(0, nl) : cut) + '…';
}
function hasCJK(s) { return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(s); }
function extractKeywords(q) {
  const words = [];
  for (const part of q.split(/\s+/).filter(Boolean)) {
    if (hasCJK(part)) {
      if (part.length >= 2) for (let i = 0; i < part.length - 1; i++) { const bi = part.slice(i, i + 2); if (hasCJK(bi)) words.push(bi); }
      words.push(part);
    } else words.push(part.toLowerCase());
  }
  return [...new Set(words)];
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const keywords = extractKeywords(query);
  let results = [];

  if (hasCJK(query)) {
    // v2.0.2: TF-density scoring — count ALL occurrences, not just binary hit
    const all = db.prepare('SELECT c.id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core FROM chunks c JOIN files f ON f.id = c.file_id').all();
    for (const chunk of all) {
      const combined = (chunk.text + ' ' + (chunk.heading || ''));
      let totalOccurrences = 0, keywordsHit = 0;
      for (const kw of keywords) {
        let count = 0, idx = -1;
        while ((idx = combined.indexOf(kw, idx + 1)) !== -1) count++;
        if (count > 0) { keywordsHit++; totalOccurrences += count; }
      }
      if (keywordsHit > 0) {
        // density = occurrences per 100 chars, boosted by keyword coverage
        const density = (totalOccurrences / Math.max(combined.length, 1)) * 100;
        const coverage = keywordsHit / keywords.length; // 0-1
        results.push({ ...chunk, hits: density * (0.5 + 0.5 * coverage) });
      }
    }
  } else {
    try {
      const ftsQ = keywords.map(w => `"${w}"`).join(' OR ');
      results = db.prepare('SELECT c.id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core, rank FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN files f ON f.id = c.file_id WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(ftsQ, maxResults * 3).map(r => ({ ...r, hits: 1 / (1 + Math.max(0, -r.rank)) }));
    } catch (e) {
      const all = db.prepare('SELECT c.id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core FROM chunks c JOIN files f ON f.id = c.file_id').all();
      for (const chunk of all) {
        const combined = (chunk.text + ' ' + (chunk.heading || '')).toLowerCase();
        let hits = 0;
        for (const kw of keywords) if (combined.includes(kw)) hits++;
        if (hits > 0) results.push({ ...chunk, hits });
      }
    }
  }

  const scored = results.map(r => ({ ...r, finalScore: r.hits * (r.is_core ? 1.5 : 1.0) * temporalDecay(r.date) }));
  scored.sort((a, b) => b.finalScore - a.finalScore);
  const top = scored.slice(0, maxResults);

  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'ok', query, results: top.map(r => ({ text: truncate(r.text, maxChars), source: `${r.path}#L${r.line_start}-L${r.line_end}`, heading: r.heading || null, date: r.date, score: Math.round(r.finalScore * 1000) / 1000 })) }));
  } else if (!top.length) {
    console.log(`[memory] No results for: ${query}`);
  } else {
    console.log(top.map((r, i) => `[${i + 1}] ${r.path}#L${r.line_start}${r.heading ? ` (${r.heading})` : ''}\n${truncate(r.text, maxChars)}`).join('\n---\n'));
  }
  db.close();
}
main();
