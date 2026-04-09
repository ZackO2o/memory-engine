# Memory Engine 🧠⚡

**Persistent memory for [OpenClaw](https://github.com/openclaw/openclaw) agents — with three layers of protection against amnesia.**

[![ClawHub](https://img.shields.io/badge/ClawHub-memory--engine--3layer-blue)](https://clawhub.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## The Problem

AI agents wake up blank every session. Existing solutions either:
- 💸 Need embedding APIs (cost money, need keys)
- 🔍 Only search (useless if nothing was written)
- 🧠 Rely on the AI "remembering" to save (it won't)

**Memory Engine solves all three.**

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

Layer 3: AGENT (AI calls these scripts)
┌──────────────────────────────────────────────────┐
│ memory-write.js    → append daily log / MEMORY.md│
│ memory-search.js   → BM25 search (0 token cost) │
│ memory-index.js    → build/update FTS5 index     │
│ memory-maintain.js → stats / rebuild / prune     │
│ memory-cron.sh     → system-level auto-maintain  │
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

All three failing simultaneously ≈ 0%.

## Token Budget

| Operation | Tokens |
|-----------|--------|
| Search (SQLite, local) | **0** |
| Results (3 snippets) | **~300** |
| Read full daily file | ~2,000 |
| Read 4 daily files | ~8,000 |
| **Savings** | **~95%** |

## Features

- **Write-then-search**: Every write auto-triggers incremental reindex — no 6-hour wait, search works instantly
- **Smart health scoring**: Gap count only starts from when the system was first installed, not from the beginning of time
- **Three-layer protection**: System cron + OpenClaw memory-flush + agent behavior rules
- **CJK support**: BM25 for English, LIKE bigram fallback for Chinese/Japanese/Korean
- **Temporal decay**: 30-day half-life — recent memories rank higher, MEMORY.md never decays (1.5× boost)
- **Zero external deps**: No embedding API, no cloud, no Docker — just SQLite

## Quick Start

### Install via ClawHub
```bash
clawhub install memory-engine-3layer
```

### Or clone this repo
```bash
git clone https://github.com/ZackO2o/memory-engine.git
cp -r memory-engine ~/.openclaw/workspace/skills/
```

### Dependencies
```bash
npm install -g better-sqlite3
```

### Setup cron (Layer 1)
```bash
cd ~/.openclaw/workspace/skills/memory-engine
(crontab -l 2>/dev/null; echo "0 */6 * * * $(pwd)/scripts/memory-cron.sh") | crontab -
```

### Enable memory-flush (Layer 2)

Add to `~/.openclaw/openclaw.json`:
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000
        }
      },
      "heartbeat": {
        "enabled": true,
        "intervalMinutes": 30
      }
    }
  }
}
```

### Add AGENTS.md rules (Layer 3)
```markdown
## Session Startup (MANDATORY)
1. Read MEMORY.md
2. Run: node skills/memory-engine/scripts/memory-write.js --status
3. Run: node skills/memory-engine/scripts/memory-index.js
4. Use memory-search.js for recall (NOT full file reads)

## During Conversation
- node skills/memory-engine/scripts/memory-write.js --today "event" --tag decision

## Session End
1. node skills/memory-engine/scripts/memory-write.js --today "Session summary"
2. node skills/memory-engine/scripts/memory-write.js --core "durable fact" --section category
3. node skills/memory-engine/scripts/memory-index.js
```

## Usage

### Write memories
```bash
# Daily log
node scripts/memory-write.js --today "Deployed v2.0 to production"
node scripts/memory-write.js --today "User prefers dark mode" --tag preference

# Long-term memory (MEMORY.md, never decays)
node scripts/memory-write.js --core "Stack: Next.js + PostgreSQL" --section infrastructure

# Health check
node scripts/memory-write.js --status
```

### Search (0 tokens!)
```bash
node scripts/memory-search.js "deployment plan"          # English
node scripts/memory-search.js "API重构" --json --max 5   # Chinese/CJK
node scripts/memory-search.js "query" --max 1 --max-chars 100
```

### Index
```bash
node scripts/memory-index.js          # incremental
node scripts/memory-index.js --force  # full rebuild
```

### Maintain
```bash
node scripts/memory-maintain.js              # stats
node scripts/memory-maintain.js --reindex    # rebuild
node scripts/memory-maintain.js --prune-days 90  # trim old
```

## How It Works

1. **Chunking** — ~600 chars/chunk, 100 char overlap, split at headings
2. **Indexing** — SQLite FTS5 full-text index + file metadata
3. **Search** — BM25 for English; LIKE bigram fallback for CJK
4. **Ranking** — `hit_count × core_boost(1.5×) × temporal_decay(30-day half-life)`
5. **Output** — Truncated snippets with `file#line` citations

## Requirements

- OpenClaw (any version)
- Node.js 18+
- `better-sqlite3`
- No API keys, no cloud, no Docker

## License

MIT
