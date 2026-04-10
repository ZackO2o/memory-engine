#!/usr/bin/env node
/**
 * memory-maintain.js v2.1.0 — Index stats, rebuild, prune, and GC
 * Usage:
 *   node memory-maintain.js [--stats] [--reindex] [--prune-days 90]
 *   node memory-maintain.js --gc                # Analyze MEMORY.md for stale entries
 *   node memory-maintain.js --gc --apply        # Actually remove stale entries
 */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const GLOBAL_MODULES = execSync('npm root -g', { encoding: 'utf8' }).trim();
const Database = require(path.join(GLOBAL_MODULES, 'better-sqlite3'));
const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');

const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE, showStats = false, reindex = false, pruneDays = 0, gc = false, gcApply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) workspace = args[++i];
  if (args[i] === '--stats') showStats = true;
  if (args[i] === '--reindex') reindex = true;
  if (args[i] === '--prune-days' && args[i + 1]) pruneDays = parseInt(args[++i]);
  if (args[i] === '--gc') gc = true;
  if (args[i] === '--apply') gcApply = true;
}

const DB_PATH = path.join(workspace, '.memory', 'index.sqlite');
const SCRIPT_DIR = __dirname;

if (reindex) {
  console.log('[maintain] Full reindex...');
  console.log(execSync(`node "${path.join(SCRIPT_DIR, 'memory-index.js')}" --workspace "${workspace}" --force`, { encoding: 'utf8' }));
  process.exit(0);
}

if (!fs.existsSync(DB_PATH)) {
  console.log('[maintain] No index. Building...');
  console.log(execSync(`node "${path.join(SCRIPT_DIR, 'memory-index.js')}" --workspace "${workspace}"`, { encoding: 'utf8' }));
  process.exit(0);
}

const db = new Database(DB_PATH);

if (showStats || !pruneDays) {
  const total = db.prepare('SELECT COUNT(*) as c FROM files').get().c;
  const chunks = db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  const core = db.prepare('SELECT COUNT(*) as c FROM files WHERE is_core = 1').get().c;
  const oldest = db.prepare('SELECT MIN(date) as d FROM files WHERE date IS NOT NULL').get().d;
  const newest = db.prepare('SELECT MAX(date) as d FROM files WHERE date IS NOT NULL').get().d;
  const memDir = path.join(workspace, 'memory');
  let disk = fs.existsSync(memDir) ? fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length : 0;
  if (fs.existsSync(path.join(workspace, 'MEMORY.md'))) disk++;
  console.log(JSON.stringify({ status: 'ok', files: { total, core, daily: total - core, onDisk: disk }, chunks, dateRange: oldest && newest ? `${oldest} → ${newest}` : 'none', dbSizeKB: Math.round(fs.statSync(DB_PATH).size / 1024), needsSync: disk > total }));
}

// ── GC: analyze MEMORY.md for stale entries ──
if (gc) {
  const MEMORY_MD = path.join(workspace, 'MEMORY.md');
  if (!fs.existsSync(MEMORY_MD)) { console.log('[gc] No MEMORY.md found.'); process.exit(0); }
  const content = fs.readFileSync(MEMORY_MD, 'utf8');
  const lines = content.split('\n');
  
  // Detect stale patterns
  const stalePatterns = [
    // "当前版本" / "current version" entries older than 14 days
    { regex: /当前.*版本|current.*version|commit [a-f0-9]{7}/i, maxAgeDays: 14, reason: '版本信息可能过时' },
    // Completed TODOs still in memory
    { regex: /^\s*-\s*\[x\]/i, maxAgeDays: 0, reason: '已完成待办' },
    // Very old entries (>60 days)
    { regex: /_\((\d{4}-\d{2}-\d{2})\)_/, maxAgeDays: 60, reason: '超过60天的条目' },
  ];
  
  const { getToday: _gt } = require('./_timezone');
  const today = _gt(workspace);
  const todayMs = new Date(today + 'T00:00:00').getTime();
  
  const staleLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.match(/^- /)) continue; // Only check list entries
    
    for (const pat of stalePatterns) {
      if (pat.regex.test(line)) {
        // Extract date if present
        const dateMatch = line.match(/_\((\d{4}-\d{2}-\d{2})\)_/);
        if (dateMatch && pat.maxAgeDays > 0) {
          const entryMs = new Date(dateMatch[1] + 'T00:00:00').getTime();
          const ageDays = Math.floor((todayMs - entryMs) / 86400000);
          if (ageDays > pat.maxAgeDays) {
            staleLines.push({ lineNum: i + 1, text: line.trim(), reason: pat.reason, ageDays });
          }
        } else if (pat.maxAgeDays === 0) {
          staleLines.push({ lineNum: i + 1, text: line.trim(), reason: pat.reason, ageDays: 0 });
        }
      }
    }
  }

  // Detect duplicate entries (>80% similarity by simple char overlap)
  const listLines = lines.map((l, i) => ({ i, text: l })).filter(x => x.text.match(/^- /));
  for (let a = 0; a < listLines.length; a++) {
    for (let b = a + 1; b < listLines.length; b++) {
      const ta = listLines[a].text.replace(/\s*_\(\d{4}-\d{2}-\d{2}\)_\s*$/, '').toLowerCase();
      const tb = listLines[b].text.replace(/\s*_\(\d{4}-\d{2}-\d{2}\)_\s*$/, '').toLowerCase();
      if (ta === tb || (ta.length > 20 && tb.length > 20 && ta.includes(tb.slice(2, -2)))) {
        // b is the duplicate (later line), mark for removal
        if (!staleLines.find(s => s.lineNum === listLines[b].i + 1)) {
          staleLines.push({ lineNum: listLines[b].i + 1, text: listLines[b].text.trim(), reason: '重复条目', ageDays: 0 });
        }
      }
    }
  }

  if (staleLines.length === 0) {
    console.log(`[gc] MEMORY.md clean (${content.length} chars, ${listLines.length} entries). No stale entries.`);
  } else {
    console.log(`[gc] Found ${staleLines.length} potentially stale entries:`);
    for (const s of staleLines) {
      console.log(`  L${s.lineNum}: ${s.reason}${s.ageDays ? ` (${s.ageDays}d old)` : ''} → ${s.text.slice(0, 80)}`);
    }
    
    if (gcApply) {
      const removeSet = new Set(staleLines.map(s => s.lineNum - 1));
      const cleaned = lines.filter((_, i) => !removeSet.has(i)).join('\n');
      // Remove consecutive blank lines
      const tidied = cleaned.replace(/\n{3,}/g, '\n\n');
      fs.writeFileSync(MEMORY_MD, tidied, 'utf8');
      console.log(`[gc] Removed ${staleLines.length} entries. ${content.length} → ${tidied.length} chars.`);
    } else {
      console.log(`[gc] Run with --apply to remove. Preview only.`);
    }
  }
  process.exit(0);
}

if (pruneDays > 0) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - pruneDays);
  const old = db.prepare('SELECT id, path FROM files WHERE date IS NOT NULL AND date < ? AND is_core = 0').all(cutoff.toISOString().slice(0, 10));
  if (!old.length) { console.log(`[maintain] Nothing older than ${pruneDays} days.`); }
  else {
    const dc = db.prepare('DELETE FROM chunks WHERE file_id = ?'), df = db.prepare('DELETE FROM files WHERE id = ?');
    db.transaction(() => { for (const f of old) { dc.run(f.id); df.run(f.id); } })();
    console.log(`[maintain] Pruned ${old.length} file(s).`);
  }
}
db.close();
