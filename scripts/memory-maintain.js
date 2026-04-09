#!/usr/bin/env node
/**
 * memory-maintain.js — Index stats, rebuild, and prune
 * Usage: node memory-maintain.js [--stats] [--reindex] [--prune-days 90]
 */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const GLOBAL_MODULES = execSync('npm root -g', { encoding: 'utf8' }).trim();
const Database = require(path.join(GLOBAL_MODULES, 'better-sqlite3'));
const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');

const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE, showStats = false, reindex = false, pruneDays = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) workspace = args[++i];
  if (args[i] === '--stats') showStats = true;
  if (args[i] === '--reindex') reindex = true;
  if (args[i] === '--prune-days' && args[i + 1]) pruneDays = parseInt(args[++i]);
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
