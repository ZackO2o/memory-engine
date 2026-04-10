#!/usr/bin/env node
/**
 * memory-auto-extract.js v1.0.0 — Auto-extract key events from session transcripts
 * Scans session JSONL files for tool calls and extracts:
 *   - git commit messages (from exec tool output)
 *   - file create/modify records (from write/edit tool calls)
 *   - deployment events (keywords: deploy, 部署)
 *   - API errors (HTTP 4xx/5xx, error keywords)
 *   - user explicit instructions (记住, remember, 部署, 回滚)
 * 
 * Usage:
 *   node memory-auto-extract.js                          # extract from active session
 *   node memory-auto-extract.js <path-to-session.jsonl>  # extract from specific file
 *   node memory-auto-extract.js --scan                   # scan all reset sessions not yet extracted
 */
const fs = require('fs'), path = require('path');

const DEFAULT_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');
const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw/agents/main/sessions');

const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE, targetFile = '', scanAll = false, dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) { workspace = args[++i]; continue; }
  if (args[i] === '--scan') { scanAll = true; continue; }
  if (args[i] === '--dry-run') { dryRun = true; continue; }
  if (!targetFile && !args[i].startsWith('--')) targetFile = args[i];
}

const MEMORY_DIR = path.join(workspace, 'memory');
const { getToday: _getToday, getTime: _getTime } = require('./_timezone');
function getToday() { return _getToday(workspace); }
function getTime() { return _getTime(workspace); }

// Patterns to extract from exec tool output
const EXTRACT_PATTERNS = [
  { regex: /(?:git\s+)?commit\s+([a-f0-9]{7,40})\s+(.{5,80})/i, tag: 'auto-extract', fmt: (m) => `git commit ${m[1].slice(0,7)}: ${m[2].trim().replace(/[\n\r].*/,'').slice(0,80)}` },
  { regex: /(?:PM2|pm2).*restart/i, tag: 'auto-extract', fmt: () => '后端服务重启 (PM2)' },
  { regex: /deploy.*成功|发布成功|部署完成|deployed/i, tag: 'auto-extract', fmt: (m) => `部署: ${m[0].slice(0,80)}` },
  { regex: /npm\s+(?:install|add)\s+(?:-[gDSE]\s+)*(\S+)/i, tag: 'auto-extract', fmt: (m) => m[1] && !m[1].startsWith('-') ? `安装依赖: ${m[1]}` : null },
];

// Patterns for user messages
const USER_PATTERNS = [
  { regex: /记住|remember|别忘/i, tag: 'auto-extract', fmt: (m, full) => `用户要求记住: ${full.slice(0,100)}` },
  { regex: /部署|deploy|上线/i, tag: 'auto-extract', fmt: (m, full) => `用户指令: ${full.slice(0,80)}` },
  { regex: /回滚|rollback|撤回/i, tag: 'auto-extract', fmt: (m, full) => `用户指令: ${full.slice(0,80)}` },
];

function extractFromSessionFile(filePath) {
  if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); return []; }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const extracted = [];
  const seen = new Set(); // dedup
  
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    
    // OpenClaw session format: entries wrapped in {type:'message', message:{role, content}}
    const msg = entry.message || entry;
    const role = msg.role || '';
    const content = msg.content || '';
    const contentList = Array.isArray(content) ? content : [];
    const contentText = typeof content === 'string' ? content
      : contentList.filter(c => c.type === 'text').map(c => c.text).join(' ');

    // Extract from toolResult messages (exec output, etc.)
    if (role === 'toolResult' || role === 'tool') {
      for (const pat of EXTRACT_PATTERNS) {
        const match = contentText.match(pat.regex);
        if (match) {
          const desc = pat.fmt(match);
          if (desc && typeof desc === 'string' && desc.length > 2 && !seen.has(desc)) {
            seen.add(desc);
            extracted.push({ tag: pat.tag, text: desc });
          }
        }
      }
    }
    
    // Extract from assistant messages with toolCall blocks (OpenClaw format)
    if (role === 'assistant') {
      for (const block of contentList) {
        if (!block || typeof block !== 'object') continue;
        // OpenClaw uses 'toolCall' type with 'arguments' (not 'input')
        if ((block.type === 'toolCall' || block.type === 'tool_use') && 
            (block.name === 'write' || block.name === 'edit')) {
          const args = block.arguments || block.input || {};
          const fp = args.path || args.file_path || '';
          if (fp && !seen.has(fp)) {
            seen.add(fp);
            extracted.push({ tag: 'auto-extract', text: `文件${block.name === 'write' ? '写入' : '编辑'}: ${fp}` });
          }
        }
      }
    }
    
    // Extract from user messages (limited — only explicit instructions)
    if (role === 'user') {
      if (contentText.length > 5 && contentText.length < 500) {
        for (const pat of USER_PATTERNS) {
          const match = contentText.match(pat.regex);
          if (match) {
            const desc = pat.fmt(match, contentText);
            if (desc && !seen.has(desc)) {
              seen.add(desc);
              extracted.push({ tag: pat.tag, text: desc });
            }
            break; // one match per message
          }
        }
      }
    }
  }
  
  return extracted;
}

function writeExtractedToLog(entries) {
  if (entries.length === 0) return;
  if (dryRun) {
    console.log(`[dry-run] Would write ${entries.length} entries:`);
    entries.forEach(e => console.log(`  - [${e.tag}] ${e.text}`));
    return;
  }
  
  const today = getToday();
  const fp = path.join(MEMORY_DIR, `${today}.md`);
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  
  let content = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : `# ${today} Daily Log\n\n`;
  const time = getTime();
  
  // Deduplicate against existing content
  const existingLower = content.toLowerCase();
  let added = 0;
  for (const e of entries) {
    const normText = e.text.toLowerCase().slice(0, 50);
    if (existingLower.includes(normText)) continue;
    content += `- ${time} [${e.tag}] ${e.text}\n`;
    added++;
  }
  
  if (added > 0) {
    fs.writeFileSync(fp, content, 'utf8');
    console.log(`[auto-extract] Wrote ${added} entries to memory/${today}.md (${entries.length - added} deduped)`);
  } else {
    console.log(`[auto-extract] All ${entries.length} entries already exist in log.`);
  }
}

// ── Main ──
if (targetFile) {
  const entries = extractFromSessionFile(targetFile);
  console.log(`[auto-extract] Found ${entries.length} events in ${path.basename(targetFile)}`);
  writeExtractedToLog(entries);
} else if (scanAll) {
  // Scan all .reset. files that haven't been extracted yet
  if (!fs.existsSync(SESSIONS_DIR)) { console.log('[auto-extract] No sessions directory.'); process.exit(0); }
  const trackFile = path.join(workspace, '.memory', 'extracted-sessions.json');
  const tracked = fs.existsSync(trackFile) ? JSON.parse(fs.readFileSync(trackFile, 'utf8')) : {};
  
  const resetFiles = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.includes('.reset.') && f.endsWith('.jsonl.reset.' + f.split('.reset.').pop()))
    .concat(fs.readdirSync(SESSIONS_DIR).filter(f => f.match(/\.jsonl\.reset\.\d{4}/)));
  
  // Actually just get all reset files properly
  const allFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.includes('.reset.'));
  let totalExtracted = 0;
  
  for (const f of allFiles) {
    if (tracked[f]) continue;
    const fp = path.join(SESSIONS_DIR, f);
    const entries = extractFromSessionFile(fp);
    if (entries.length > 0) {
      console.log(`[auto-extract] ${f}: ${entries.length} events`);
      writeExtractedToLog(entries);
      totalExtracted += entries.length;
    }
    tracked[f] = { extractedAt: new Date().toISOString(), count: entries.length };
  }
  
  if (!fs.existsSync(path.join(workspace, '.memory'))) fs.mkdirSync(path.join(workspace, '.memory'), { recursive: true });
  fs.writeFileSync(trackFile, JSON.stringify(tracked, null, 2), 'utf8');
  console.log(`[auto-extract] Scan complete. ${totalExtracted} new events from ${allFiles.filter(f => !tracked[f] || tracked[f].extractedAt === new Date().toISOString().slice(0,10)).length} sessions.`);
} else {
  // Extract from active (non-reset) session
  if (!fs.existsSync(SESSIONS_DIR)) { console.log('[auto-extract] No sessions directory.'); process.exit(0); }
  const active = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl') && !f.includes('.reset.') && !f.includes('.deleted.') && !f.includes('.lock'))
    .map(f => ({ name: f, size: fs.statSync(path.join(SESSIONS_DIR, f)).size }))
    .sort((a, b) => b.size - a.size);
  
  if (active.length === 0) { console.log('[auto-extract] No active sessions.'); process.exit(0); }
  
  const fp = path.join(SESSIONS_DIR, active[0].name);
  console.log(`[auto-extract] Scanning active session: ${active[0].name} (${(active[0].size/1024).toFixed(0)}KB)`);
  const entries = extractFromSessionFile(fp);
  console.log(`[auto-extract] Found ${entries.length} events`);
  writeExtractedToLog(entries);
}
