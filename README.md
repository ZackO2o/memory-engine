# Memory Engine 🧠⚡

**Memory guardian for [OpenClaw](https://github.com/openclaw/openclaw) — three layers of protection against AI amnesia.**

[![ClawHub](https://img.shields.io/badge/ClawHub-memory--engine--3layer-blue)](https://clawhub.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Version](https://img.shields.io/badge/version-5.0.0-orange)](https://github.com/ZackO2o/memory-engine/releases)

## What's New in v5.0

**Architecture shift**: Memory Engine is now a **memory guardian** — it works alongside OpenClaw's native `memorySearch` when available, and handles everything native doesn't do:

| Feature | Native memorySearch | Memory Engine |
|---------|:------------------:|:-------------:|
| Vector semantic search | ✅ | — (deferred) |
| BM25 hybrid search | ✅ | ✅ (fallback) |
| Auto-write daily logs | — | ✅ |
| Session reset detection (<30s) | — | ✅ |
| Active session extraction | — | ✅ |
| Health check + GC | — | ✅ |
| Session resume context | — | ✅ |
| GitHub backup/restore | — | ✅ |
| Zero-dependency writing | — | ✅ |

**Upgrade from v3/v4**: `node scripts/memory-migrate.js --apply` (zero data loss, auto-backup).

## The Problem

AI agents wake up blank every session. Existing solutions either:
- 💸 Need embedding APIs (cost money, need keys)
- 🔍 Only search (useless if nothing was written)
- 🧠 Rely on the AI "remembering" to save (it won't)

Memory Engine solves all three — and now plays nicely with OpenClaw native memory too.

## Three-Layer Anti-Amnesia Architecture

```
Layer 1: SYSTEM (runs without AI)
┌─────────────────────────┐
│ cron job (every 1h)     │
│ • rebuild search index  │
│ • health check          │
│ • auto-create daily log │
│ • active session extract│
│ • ensure watcher alive  │
│                         │
│ 🔴 watcher daemon       │
│ • polls every 30s       │
│ • detects session reset │
│ • extracts memory <30s  │
│ • auto-started by cron  │
└─────────────────────────┘

Layer 2: PLATFORM (OpenClaw built-in)
┌──────────────────────────┐
│ memory-flush             │
│ • pre-compaction write   │
│                          │
│ session-memory hook      │
│ • saves on /new & /reset │
└──────────────────────────┘

Layer 3: AGENT (AI calls these)
┌──────────────────────────────────────────────────┐
│ memory-write.js    → daily log + MEMORY.md       │
│ memory-search.js   → FTS5 search (native fallbk) │
│ memory-boot.js     → single-command startup      │
│ memory-resume.js   → session recovery            │
│ memory-migrate.js  → upgrade/rollback        NEW │
│ memory-maintain.js → stats / GC / rebuild        │
│ memory-auto-extract.js → session transcript mine │
└──────────────────────────────────────────────────┘
```

## Quick Start

### For OpenClaw ≥ 2026.4 (recommended)
```bash
# Install
clawhub install memory-engine-3layer
# Or: git clone https://github.com/ZackO2o/memory-engine.git ~/.openclaw/workspace/skills/memory-engine

# Setup (1 minute)
cd ~/.openclaw/workspace/skills/memory-engine
chmod +x scripts/*.sh
(crontab -l 2>/dev/null; echo "0 * * * * $(pwd)/scripts/memory-cron.sh") | crontab -
node scripts/memory-migrate.js --apply
openclaw gateway restart
```

### For older OpenClaw (FTS5 mode)
```bash
npm install -g better-sqlite3
cd ~/.openclaw/workspace/skills/memory-engine
chmod +x scripts/*.sh
(crontab -l 2>/dev/null; echo "0 * * * * $(pwd)/scripts/memory-cron.sh") | crontab -
```

## Usage

### Boot (session startup — one command does it all)
```bash
node scripts/memory-boot.js           # health + index + MEMORY.md
```

### Write (most important!)
```bash
node scripts/memory-write.js --today "Deployed v2.0" --tag done
node scripts/memory-write.js --core "Stack: Next.js" --section infrastructure
node scripts/memory-write.js --status
```

### Search
```bash
node scripts/memory-search.js "deployment plan"
node scripts/memory-search.js "API重构" --json --max 5
node scripts/memory-search.js --last 5 --tag done
node scripts/memory-search.js "tasks" --recent 7
```

### Migrate (v5.0)
```bash
node scripts/memory-migrate.js              # preview
node scripts/memory-migrate.js --apply      # upgrade (auto-backup)
node scripts/memory-migrate.js --rollback --apply  # revert
node scripts/memory-migrate.js --status     # JSON report
```

### Resume (after session reset)
```bash
node scripts/memory-resume.js              # recovery summary (<2000 tokens)
```

### Maintain
```bash
node scripts/memory-maintain.js --gc        # preview stale MEMORY.md entries
node scripts/memory-maintain.js --gc --apply  # clean them up
```

## Token Budget

| Operation | Tokens |
|-----------|--------|
| Search (SQLite) | **0** |
| Results (3 snippets) | **~300** |
| Boot (health + MEMORY.md) | **~600** |
| Read full daily file | ~2,000 |
| **Savings vs reading files** | **~95%** |

## Scripts

| Script | Purpose |
|--------|---------|
| `memory-write.js` | Daily log + MEMORY.md (zero deps) |
| `memory-search.js` | FTS5 search + native fallback |
| `memory-boot.js` | One-command startup |
| `memory-resume.js` | Session recovery context |
| `memory-migrate.js` | Upgrade/rollback helper **NEW** |
| `memory-index.js` | Build FTS5 index |
| `memory-maintain.js` | Stats, GC, rebuild |
| `memory-auto-extract.js` | Session transcript mining |
| `memory-compact.js` | Compress old logs |
| `memory-watcher.sh` | Real-time reset detector |
| `memory-cron.sh` | System maintenance |
| `memory-backup.sh` | GitHub auto-backup |
| `memory-restore.sh` | Disaster recovery |

## Requirements

- Node.js 18+
- OpenClaw (any version)
- `better-sqlite3` — optional in v5.0 (only for FTS5 fallback)
- No API keys, no cloud, no Docker

## License

MIT

See [CHANGELOG.md](CHANGELOG.md) for full version history.
