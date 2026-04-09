---
name: memory-engine
description: "Persistent memory system for OpenClaw with three-layer anti-amnesia protection. Layer 1 (system): cron job auto-rebuilds index every 6h + auto-creates daily logs. Layer 2 (platform): works with OpenClaw's built-in memory-flush (auto-triggered before compaction). Layer 3 (agent): write/search/maintain scripts for the AI to call. Uses SQLite FTS5, BM25 + CJK bigram search, temporal decay ranking. Search costs 0 tokens, returns ~300 tokens of compact snippets. No embedding API needed. Use when: recalling past conversations, writing memory entries, checking memory health, maintaining search index. Triggers: 'remember', 'recall', 'what did we discuss', 'memory status', 'search memory', 'reindex'."
---

# Memory Engine 🧠⚡

**Persistent memory that survives session restarts — with three layers of protection against amnesia.**

## The Problem

AI agents wake up blank every session. Existing solutions either:
- Need embedding APIs (cost money, need keys)
- Only search (useless if nothing was written)
- Rely on the AI "remembering" to save (it won't)

Memory Engine solves all three.

## Three-Layer Anti-Amnesia Architecture

```
Layer 1: SYSTEM (runs without AI)     Layer 2: PLATFORM (OpenClaw built-in)
┌─────────────────────────┐           ┌──────────────────────────┐
│ cron job (every 6h)     │           │ memory-flush             │
│ • rebuild search index  │           │ • auto-triggers before   │
│ • health check          │           │   context compaction     │
│ • auto-create daily log │           │ • forces AI to write     │
│   if missing            │           │   memory/YYYY-MM-DD.md   │
│                         │           │ • user-invisible         │
│ ⚙️ Pure shell script,   │           │                          │
│   no AI involvement     │           │ ⚙️ Built into OpenClaw,  │
└─────────────────────────┘           │   just needs config      │
                                      └──────────────────────────┘
Layer 3: AGENT (AI calls these)
┌──────────────────────────────────────────────────┐
│ memory-write.js    → append daily log / MEMORY.md│
│ memory-search.js   → BM25 search (0 token cost) │
│ memory-index.js    → build/update FTS5 index     │
│ memory-maintain.js → stats / rebuild / prune     │
│                                                  │
│ 📋 Governed by AGENTS.md rules:                  │
│   Session start → health check + read MEMORY.md  │
│   During conversation → log key events           │
│   Session end → summarize + promote to MEMORY.md │
└──────────────────────────────────────────────────┘
```

**Why three layers?** Any single layer can fail:
- AI forgets to write → cron + memory-flush still capture data
- Cron stops → AI + memory-flush still work
- Memory-flush doesn't trigger (short session) → AI + cron still work

All three failing simultaneously = near zero probability.

## Setup (2 minutes)

### Step 1: Install dependency
```bash
npm install -g better-sqlite3
```

### Step 2: Install cron job
```bash
# Auto-rebuilds index + creates daily logs every 6 hours
(crontab -l 2>/dev/null; echo "0 */6 * * * $(pwd)/scripts/memory-cron.sh") | crontab -
```

### Step 3: Enable memory-flush (add to openclaw.json)
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000
        },
        "reserveTokensFloor": 20000
      },
      "heartbeat": {
        "every": "30m"
      }
    }
  }
}
```

### Step 4: Add rules to AGENTS.md
```markdown
## Session Startup (MANDATORY)
1. Read MEMORY.md (curated long-term memory, small file)
2. Run: node skills/memory-engine/scripts/memory-write.js --status
3. Run: node skills/memory-engine/scripts/memory-index.js
4. Use memory-search.js for specific recall (NOT full file reads)

## During Conversation (MANDATORY)
- Key decisions: node skills/memory-engine/scripts/memory-write.js --today "decision" --tag decision
- Task completion: node skills/memory-engine/scripts/memory-write.js --today "done" --tag done

## Session End (MANDATORY)
1. node skills/memory-engine/scripts/memory-write.js --today "Session summary"
2. node skills/memory-engine/scripts/memory-write.js --core "durable fact" --section category
3. node skills/memory-engine/scripts/memory-index.js
```

## Commands

### Write (most important!)
```bash
# Daily log (auto-creates memory/YYYY-MM-DD.md)
node scripts/memory-write.js --today "Deployed v2.0 to production"
node scripts/memory-write.js --today "User prefers dark mode" --tag preference

# Long-term memory (appends to MEMORY.md, never decays)
node scripts/memory-write.js --core "Stack: Next.js + PostgreSQL + Redis"
node scripts/memory-write.js --core "Deploy via Docker Compose" --section infrastructure

# Health check
node scripts/memory-write.js --status
```

Health output:
```json
{
  "hasTodayLog": true,
  "hasCoreMemory": true,
  "gapCount": 2,
  "healthScore": 71,
  "warnings": ["2 gaps in last 14 days"]
}
```

### Search (0 tokens, ~300 token results)
```bash
node scripts/memory-search.js "deployment plan"          # top 3, 200 chars
node scripts/memory-search.js "API重构" --json --max 5   # CJK support
node scripts/memory-search.js "query" --max 1 --max-chars 100  # ultra-minimal

# Date filtering (auto-detects "4月2日" / "April 2" in queries)
node scripts/memory-search.js "4月2日完成了什么"          # auto date filter
node scripts/memory-search.js "tasks" --date 2026-04-02  # exact date
node scripts/memory-search.js "progress" --recent 7      # last 7 days
node scripts/memory-search.js "bugs" --after 2026-04-01 --before 2026-04-08
```

### Index
```bash
node scripts/memory-index.js          # incremental (skips unchanged)
node scripts/memory-index.js --force  # full rebuild
```

### Maintain
```bash
node scripts/memory-maintain.js              # show stats
node scripts/memory-maintain.js --reindex    # force rebuild
node scripts/memory-maintain.js --prune-days 90  # trim old entries
```

### Compact (compress old logs)
```bash
node scripts/memory-compact.js --stats                  # show candidates
node scripts/memory-compact.js --older-than 30 --dry-run  # preview
node scripts/memory-compact.js --older-than 30          # execute (originals → memory/archive/)
```

Compaction extracts headings + key bullets (✅/🔴/重要), saves originals to `memory/archive/`. Typical savings: 60-70%.

## How Search Works

1. **Chunking**: ~300 chars per chunk, 60 char overlap, split at headings
2. **Indexing**: SQLite FTS5 full-text index + file metadata
3. **Search**: BM25 + phrase matching for English; TF-density bigram for CJK
4. **Date filtering**: Auto-detects dates in queries (4月2日, April 2, 2026-04-02)
5. **Ranking**: TF_density × coverage × core_boost(1.5×) × temporal_decay(30-day half-life)
5. **Output**: truncated snippets with `file#line` citations

## Token Budget

| Operation | Tokens |
|-----------|--------|
| Search (SQLite) | 0 |
| Results (3 × 200 chars) | ~300 |
| Read full daily file | ~2000 |
| Read 4 daily files | ~8000 |
| **Savings** | **~95%** |

## Requirements

- Node.js 18+
- `better-sqlite3` (for search/index)
- Write + health check: zero dependencies
- No API keys, no cloud, no Docker
