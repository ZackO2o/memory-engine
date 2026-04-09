#!/usr/bin/env node
/**
 * memory-search.js v2.1.0 — BM25 + CJK bigram + date filter + phrase matching
 * Usage:
 *   node memory-search.js "query" [--max 3] [--max-chars 200] [--json]
 *   node memory-search.js "query" --date 2026-04-02      # filter by exact date
 *   node memory-search.js "query" --after 2026-04-01     # after date
 *   node memory-search.js "query" --before 2026-04-08    # before date
 *   node memory-search.js "query" --recent 7             # last N days
 */
const fs = require('fs'), path = require('path');
const GLOBAL_MODULES = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
const Database = require(path.join(GLOBAL_MODULES, 'better-sqlite3'));

const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');
const HALF_LIFE_DAYS = 90; // 90-day half-life: balanced recency vs long-term recall

const args = process.argv.slice(2);
let query = '', maxResults = 3, maxChars = 200, jsonOutput = false, workspace = DEFAULT_WORKSPACE;
let dateFilter = null, afterDate = null, beforeDate = null, recentDays = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max' && args[i + 1]) { maxResults = parseInt(args[++i]); continue; }
  if (args[i] === '--max-chars' && args[i + 1]) { maxChars = parseInt(args[++i]); continue; }
  if (args[i] === '--json') { jsonOutput = true; continue; }
  if (args[i] === '--workspace' && args[i + 1]) { workspace = args[++i]; continue; }
  if (args[i] === '--date' && args[i + 1]) { dateFilter = args[++i]; continue; }
  if (args[i] === '--after' && args[i + 1]) { afterDate = args[++i]; continue; }
  if (args[i] === '--before' && args[i + 1]) { beforeDate = args[++i]; continue; }
  if (args[i] === '--recent' && args[i + 1]) { recentDays = parseInt(args[++i]); continue; }
  if (!query) query = args[i];
}
if (!query) { console.error('Usage: memory-search.js "query" [--max N] [--date YYYY-MM-DD] [--recent N] [--json]'); process.exit(1); }

const DB_PATH = path.join(workspace, '.memory', 'index.sqlite');
if (!fs.existsSync(DB_PATH)) { console.error(JSON.stringify({ status: 'error', message: 'No index. Run memory-index.js first.' })); process.exit(1); }

// Validate database integrity, auto-rebuild if corrupted
try {
  const testDb = new Database(DB_PATH, { readonly: true });
  testDb.pragma('integrity_check');
  testDb.close();
} catch (e) {
  if (e.code === 'SQLITE_NOTADB' || e.code === 'SQLITE_CORRUPT') {
    console.error(`[memory] Index corrupted (${e.code}), rebuilding...`);
    try { fs.unlinkSync(DB_PATH); } catch (_) {}
    try {
      require('child_process').execSync(`node "${path.join(__dirname, 'memory-index.js')}" --workspace "${workspace}" --force`, { stdio: 'pipe' });
      console.error('[memory] Index rebuilt successfully.');
    } catch (rebuildErr) {
      console.error(JSON.stringify({ status: 'error', message: 'Index corrupted and rebuild failed.' }));
      process.exit(1);
    }
  } else throw e;
}

// Compute date bounds
if (recentDays > 0) {
  const d = new Date(); d.setDate(d.getDate() - recentDays);
  afterDate = d.toISOString().slice(0, 10);
}

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

// Auto-detect date references in natural language queries
function extractQueryDate(q) {
  // Match patterns: 4月2日, 04-02, 2026-04-02, April 2
  const m1 = q.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return m1[0];
  const m2 = q.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (m2) {
    const year = new Date().getFullYear();
    return `${year}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
  }
  return null;
}

function matchesDateFilter(fileDate) {
  if (!fileDate) return true; // MEMORY.md (no date) always included
  if (dateFilter && fileDate !== dateFilter) return false;
  if (afterDate && fileDate < afterDate) return false;
  if (beforeDate && fileDate > beforeDate) return false;
  return true;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  // Auto-detect date in query if no explicit --date flag
  let queryForSearch = query;
  if (!dateFilter && !afterDate && !beforeDate && !recentDays) {
    const detected = extractQueryDate(query);
    if (detected) {
      dateFilter = detected;
      // Remove date tokens from search query to avoid matching date strings literally
      queryForSearch = query
        .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '')      // 2026-04-02
        .replace(/\d{1,2}月\d{1,2}[日号]/g, '')       // 4月2日
        .replace(/\s+/g, ' ').trim();
    }
  }

  const isDateOnlyQuery = queryForSearch === '' && (dateFilter || afterDate || beforeDate);
  const keywords = isDateOnlyQuery ? [] : extractKeywords(queryForSearch || query);

  let results = [];
  const hasDateConstraint = dateFilter || afterDate || beforeDate;

  // Build file filter set if date constraints exist
  let allowedFileIds = null;
  if (hasDateConstraint) {
    const files = db.prepare('SELECT id, date FROM files').all();
    allowedFileIds = new Set(files.filter(f => matchesDateFilter(f.date)).map(f => f.id));
  }

  // If query was just a date (e.g., "4月2日"), return all chunks from that date (exclude undated files like MEMORY.md)
  if (isDateOnlyQuery && allowedFileIds) {
    const datedFileIds = new Set(db.prepare('SELECT id FROM files WHERE date IS NOT NULL').all().map(f => f.id));
    const all = db.prepare('SELECT c.id, c.file_id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core FROM chunks c JOIN files f ON f.id = c.file_id').all();
    results = all.filter(c => allowedFileIds.has(c.file_id) && datedFileIds.has(c.file_id)).map(c => ({ ...c, hits: 1.0 }));
  }

  // Get candidate chunks
  let candidates;
  if (allowedFileIds) {
    const all = db.prepare('SELECT c.id, c.file_id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core FROM chunks c JOIN files f ON f.id = c.file_id').all();
    candidates = all.filter(c => allowedFileIds.has(c.file_id));
  } else {
    candidates = db.prepare('SELECT c.id, c.file_id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core FROM chunks c JOIN files f ON f.id = c.file_id').all();
  }

  // Unified search: FTS5 first (fast), then LIKE fallback (catches substrings FTS5 misses)
  const seen = new Set();

  // Step 1: Try FTS5 BM25 (only for non-CJK, no date constraint — FTS5 can't filter by file)
  if (!hasCJK(query) && !hasDateConstraint) {
    try {
      const phraseQ = `"${keywords.join(' ')}"`;
      const phraseResults = db.prepare('SELECT c.id, c.file_id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core, rank FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN files f ON f.id = c.file_id WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(phraseQ, maxResults * 2).map(r => ({ ...r, hits: (1 / (1 + Math.max(0, -r.rank))) * 2.0 }));
      for (const r of phraseResults) { seen.add(r.id); results.push(r); }

      const wordQ = keywords.map(w => `"${w}"`).join(' OR ');
      const wordResults = db.prepare('SELECT c.id, c.file_id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core, rank FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN files f ON f.id = c.file_id WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(wordQ, maxResults * 3).map(r => ({ ...r, hits: 1 / (1 + Math.max(0, -r.rank)) }));
      for (const r of wordResults) { if (!seen.has(r.id)) { seen.add(r.id); results.push(r); } }
    } catch (e) { /* FTS5 error — LIKE fallback below will catch it */ }
  }

  // Step 2: LIKE scan on all candidates — merges with FTS5 results (takes max score)
  const likeCandidates = allowedFileIds ? candidates : (candidates || db.prepare('SELECT c.id, c.file_id, c.text, c.heading, c.line_start, c.line_end, f.path, f.date, f.is_core FROM chunks c JOIN files f ON f.id = c.file_id').all());
  const resultMap = new Map(); // id → result (for dedup + max-score merge)
  for (const r of results) resultMap.set(r.id, r);

  for (const chunk of likeCandidates) {
    const combined = (chunk.text + ' ' + (chunk.heading || '')).toLowerCase();
    let totalOccurrences = 0, keywordsHit = 0;
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      let count = 0, idx = -1;
      while ((idx = combined.indexOf(kwLower, idx + 1)) !== -1) count++;
      if (count > 0) { keywordsHit++; totalOccurrences += count; }
    }
    if (keywordsHit > 0) {
      const density = (totalOccurrences / Math.max(combined.length, 1)) * 100;
      const coverage = keywordsHit / keywords.length;
      const likeScore = density * (0.5 + 0.5 * coverage);
      const existing = resultMap.get(chunk.id);
      if (existing) {
        // Take max of FTS5 score and LIKE score
        if (likeScore > existing.hits) existing.hits = likeScore;
      } else {
        const entry = { ...chunk, hits: likeScore };
        resultMap.set(chunk.id, entry);
      }
    }
  }
  results = Array.from(resultMap.values());

  const scored = results.map(r => ({ ...r, finalScore: r.hits * (r.is_core ? 1.5 : 1.0) * temporalDecay(r.date) }));
  scored.sort((a, b) => b.finalScore - a.finalScore);
  const top = scored.slice(0, maxResults);

  const dateInfo = dateFilter ? ` [date=${dateFilter}]` : afterDate ? ` [after=${afterDate}]` : beforeDate ? ` [before=${beforeDate}]` : '';

  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'ok', query, dateFilter: dateFilter || afterDate || beforeDate || null, results: top.map(r => ({ text: truncate(r.text, maxChars), source: `${r.path}#L${r.line_start}-L${r.line_end}`, heading: r.heading || null, date: r.date, score: Math.round(r.finalScore * 1000) / 1000 })) }));
  } else if (!top.length) {
    console.log(`[memory] No results for: ${query}${dateInfo}`);
  } else {
    console.log(top.map((r, i) => `[${i + 1}] ${r.path}#L${r.line_start}${r.heading ? ` (${r.heading})` : ''}\n${truncate(r.text, maxChars)}`).join('\n---\n'));
  }
  db.close();
}
main();
