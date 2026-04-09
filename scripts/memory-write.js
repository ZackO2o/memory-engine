#!/usr/bin/env node
/**
 * memory-write.js — Write daily logs + MEMORY.md + health check
 * Usage:
 *   node memory-write.js --today "event description" [--tag decision]
 *   node memory-write.js --core "durable fact" [--section projects]
 *   node memory-write.js --status
 */
const fs = require('fs'), path = require('path');
const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');

const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE, todayText = '', coreText = '', tag = '', section = '', showStatus = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) { workspace = args[++i]; continue; }
  if (args[i] === '--today' && args[i + 1]) { todayText = args[++i]; continue; }
  if (args[i] === '--core' && args[i + 1]) { coreText = args[++i]; continue; }
  if (args[i] === '--tag' && args[i + 1]) { tag = args[++i]; continue; }
  if (args[i] === '--section' && args[i + 1]) { section = args[++i]; continue; }
  if (args[i] === '--status') { showStatus = true; continue; }
}

const MEMORY_DIR = path.join(workspace, 'memory');
const MEMORY_MD = path.join(workspace, 'MEMORY.md');
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
const { getToday: _getToday, getTime: _getTime } = require('./_timezone');
function getToday() { return _getToday(workspace); }
function getTime() { return _getTime(workspace); }

// File lock using .lock file with retry
function withLock(filePath, fn) {
  const lockPath = filePath + '.lock';
  const maxRetries = 10, retryMs = 50;
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      try { return fn(); } finally { try { fs.unlinkSync(lockPath); } catch(e) {} }
    } catch (e) {
      if (e.code === 'EEXIST') {
        // Check if lock is stale (>5s old)
        try { const s = fs.statSync(lockPath); if (Date.now() - s.mtimeMs > 5000) { fs.unlinkSync(lockPath); continue; } }
        catch(e2) { continue; }
        const jitter = Math.random() * retryMs;
        require('child_process').execSync(`sleep ${(retryMs + jitter) / 1000}`);
      } else throw e;
    }
  }
  // Fallback: just run without lock
  return fn();
}

function writeToday(text, tag) {
  ensureDir(MEMORY_DIR);
  const today = getToday(), fp = path.join(MEMORY_DIR, `${today}.md`), time = getTime(), tagStr = tag ? ` [${tag}]` : '';
  const len = withLock(fp, () => {
    let content = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : `# ${today} Daily Log\n\n`;
    content += `- ${time}${tagStr} ${text}\n`;
    fs.writeFileSync(fp, content, 'utf8');
    return content.length;
  });
  console.log(JSON.stringify({ status: 'ok', action: 'append_daily', file: `memory/${today}.md`, chars: len }));
}

function writeCore(text, section) {
  const today = getToday();
  const len = withLock(MEMORY_MD, () => {
    let content = fs.existsSync(MEMORY_MD)
      ? fs.readFileSync(MEMORY_MD, 'utf8')
      : `# Long-Term Memory\n\n_Auto-created ${today}. Curated knowledge that persists across sessions._\n\n`;
    if (section) {
      const hdr = `## ${section.charAt(0).toUpperCase() + section.slice(1)}`;
      const idx = content.indexOf(hdr);
      if (idx >= 0) {
        const after = content.indexOf('\n', idx);
        const next = content.indexOf('\n## ', after);
        const at = next >= 0 ? next : content.length;
        content = content.slice(0, at) + `\n- ${text} _(${today})_\n` + content.slice(at);
      } else {
        content += `\n${hdr}\n\n- ${text} _(${today})_\n`;
      }
    } else {
      content += `\n- ${text} _(${today})_\n`;
    }
    fs.writeFileSync(MEMORY_MD, content, 'utf8');
    return content.length;
  });
  console.log(JSON.stringify({ status: 'ok', action: 'append_core', file: 'MEMORY.md', section: section || 'root', chars: len }));
}

function healthCheck() {
  ensureDir(MEMORY_DIR);
  const today = getToday(), todayDate = new Date(today);
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/)).sort();
  const hasCore = fs.existsSync(MEMORY_MD), hasTodayLog = files.includes(`${today}.md`);
  const gaps = [];
  // Only count gaps since the earliest daily log (don't penalize days before system existed)
  const earliest = files.length > 0 ? files[0].replace('.md', '') : today;
  for (let i = 1; i < 14; i++) {
    const d = new Date(todayDate); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (ds < earliest) break; // don't count before system existed
    if (!files.includes(`${ds}.md`)) gaps.push(ds);
  }
  const totalChars = files.reduce((s, f) => s + fs.statSync(path.join(MEMORY_DIR, f)).size, 0);
  const coreChars = hasCore ? fs.statSync(MEMORY_MD).size : 0;
  const score = Math.max(0, 100 - gaps.length * 7 - (hasCore ? 0 : 20) - (hasTodayLog ? 0 : 15));
  const warnings = [];
  if (!hasCore) warnings.push('MEMORY.md missing — no long-term memory');
  if (!hasTodayLog) warnings.push(`No log for today (${today}) — session will be forgotten`);
  if (gaps.length > 3) warnings.push(`${gaps.length} gaps in last 14 days`);
  console.log(JSON.stringify({ status: 'ok', today, hasTodayLog, hasCoreMemory: hasCore, dailyFiles: files.length, totalDailyChars: totalChars, coreMemoryChars: coreChars, gapCount: gaps.length, healthScore: score, warnings }, null, 2));
}

function autoReindex() {
  const indexScript = path.join(__dirname, 'memory-index.js');
  if (fs.existsSync(indexScript)) {
    try { require('child_process').execSync(`node "${indexScript}" --workspace "${workspace}"`, { stdio: 'pipe' }); }
    catch (e) { /* index failure is non-fatal */ }
  }
}

if (showStatus) { healthCheck(); }
else if (!todayText && !coreText) { console.error('Usage:\n  --today "text" [--tag t]  Append daily log\n  --core "text" [--section s]  Append MEMORY.md\n  --status  Health check'); process.exit(1); }
else { if (todayText) writeToday(todayText, tag); if (coreText) writeCore(coreText, section); autoReindex(); }
