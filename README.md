# Memory Engine 🧠⚡

**Persistent memory for [OpenClaw](https://github.com/openclaw/openclaw) agents — with three layers of protection against amnesia.**

[![ClawHub](https://img.shields.io/badge/ClawHub-memory--engine--3layer-blue)](https://clawhub.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.9.0-orange)](https://github.com/ZackO2o/memory-engine/releases)

## The Problem

AI agents wake up blank every session. Existing solutions either:
- 💸 Need embedding APIs (cost money, need keys)
- 🔍 Only search (useless if nothing was written)
- 🧠 Rely on the AI "remembering" to save (it won't)

**Memory Engine solves all three.**

## Three-Layer Anti-Amnesia Architecture

```
Layer 1: SYSTEM                        Layer 2: PLATFORM
┌─────────────────────────┐           ┌──────────────────────────┐
│ cron job (every 6h)     │           │ memory-flush             │
│ • rebuild search index  │           │ • auto-triggers before   │
│ • health check          │           │   context compaction     │
│ • auto-create daily log │           │ • forces AI to write     │
│ • auto-compact old logs │           │   memory/YYYY-MM-DD.md   │
│ • rotate cron.log       │           │                          │
│                         │           │ ⚙️ Built into OpenClaw,  │
│ ⚙️ Pure shell, no AI    │           │   just needs config      │
└─────────────────────────┘           └──────────────────────────┘

Layer 3: AGENT (7 scripts)
┌──────────────────────────────────────────────────┐
│ memory-write.js    → daily log + MEMORY.md       │
│ memory-search.js   → BM25/CJK search + date     │
│ memory-index.js    → FTS5 index build            │
│ memory-maintain.js → stats / rebuild / prune     │
│ memory-compact.js  → compress old logs           │
│ memory-cron.sh     → system auto-maintenance     │
│                                                  │
│ 📋 Session start: health check + read MEMORY.md  │
│ 📝 During: log key events                        │
│ 💾 Session end: summarize + promote + reindex    │
└──────────────────────────────────────────────────┘
```

**Why three layers?** Any single layer can fail:
- AI forgets → cron + memory-flush still capture data
- Cron stops → AI + memory-flush still work
- Short session → AI + cron still work
- All three failing simultaneously ≈ 0%

## Features

- **Write-then-search**: Every write auto-triggers reindex — instant search, no waiting
- **Date filtering**: Auto-detects dates in queries (`4月2日完成了什么` → filters to April 2)
- **CJK support**: TF-density bigram scoring for Chinese/Japanese/Korean
- **English phrase matching**: `"hotel translation"` matched as phrase (2x boost)
- **Temporal decay**: 30-day half-life — recent memories rank higher
- **Core memory boost**: MEMORY.md gets 1.5× relevance score (never decays)
- **Concurrent-safe writes**: File locking prevents data loss from parallel writes
- **Auto-compact**: Compress old daily logs, originals saved to archive
- **Smart health scoring**: Only counts gaps since system install
- **Log rotation**: cron.log auto-rotates at 100KB
- **Zero external deps**: No embedding API, no cloud, no Docker

## Token Budget

| Operation | Tokens |
|-----------|--------|
| Search (SQLite, local) | **0** |
| Results (3 snippets) | **~300** |
| Read full daily file | ~2,000 |
| Read 4 daily files | ~8,000 |
| **Savings** | **~95%** |

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
chmod +x scripts/memory-cron.sh
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
# Daily log (auto-creates memory/YYYY-MM-DD.md)
node scripts/memory-write.js --today "Deployed v2.0 to production"
node scripts/memory-write.js --today "User prefers dark mode" --tag preference

# Long-term memory (MEMORY.md, never decays)
node scripts/memory-write.js --core "Stack: Next.js + PostgreSQL" --section infrastructure

# Health check
node scripts/memory-write.js --status
```

### Search
```bash
# Basic
node scripts/memory-search.js "deployment plan"          # English
node scripts/memory-search.js "API重构" --json --max 5   # CJK

# Date filtering
node scripts/memory-search.js "4月2日完成了什么"          # auto-detect
node scripts/memory-search.js "tasks" --date 2026-04-02  # exact date
node scripts/memory-search.js "progress" --recent 7      # last 7 days
node scripts/memory-search.js "bugs" --after 2026-04-01 --before 2026-04-08

# Minimal output
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

### Compact
```bash
node scripts/memory-compact.js --stats                    # show candidates
node scripts/memory-compact.js --older-than 30 --dry-run  # preview
node scripts/memory-compact.js --older-than 30            # execute
```

Compaction extracts headings + key bullets (✅/🔴/重要), saves originals to `memory/archive/`. Typical savings: **60-70%**.

## How It Works

1. **Chunking** — ~300 chars/chunk, 60 char overlap, split at markdown headings
2. **Indexing** — SQLite FTS5 full-text index + file metadata
3. **Search** — BM25 + phrase matching for English; TF-density bigram for CJK
4. **Date filter** — Auto-detects `4月2日`, `April 2`, `2026-04-02` in queries
5. **Ranking** — `TF_density × coverage × core_boost(1.5×) × temporal_decay(30d half-life)`
6. **Output** — Truncated snippets with `file#line` source citations

## Scripts Overview

| Script | Purpose | Auto-runs |
|--------|---------|-----------|
| `memory-write.js` | Append daily log / MEMORY.md | — |
| `memory-search.js` | BM25 + CJK search with date filter | — |
| `memory-index.js` | Build/update FTS5 index | After each write |
| `memory-maintain.js` | Stats / rebuild / prune index | — |
| `memory-compact.js` | Compress old logs (60-70% savings) | Monthly via cron |
| `memory-cron.sh` | System-level auto-maintenance | Every 6 hours |
| `SKILL.md` | Full documentation for AI agents | — |

## Requirements

- OpenClaw (any version)
- Node.js 18+
- `better-sqlite3` (npm install -g)
- No API keys, no cloud, no Docker

## Changelog

### v2.2.0
- File locking for concurrent-safe writes
- Cron auto-compact (monthly, 60+ day old files)
- Cron log rotation (>100KB)

### v2.1.0
- Date filtering: `--date`, `--after`, `--before`, `--recent`
- Auto-detect dates in natural language queries
- English phrase matching (2x boost)
- `memory-compact.js` for old log compression

### v2.0.2
- Finer chunks (300 chars) for better CJK precision
- TF-density scoring replaces binary hit counting

### v2.0.1
- Write-then-search: auto-reindex after every write
- Smart gap counting (only since system install)

### v2.0.0
- Initial release: three-layer anti-amnesia architecture
- SQLite FTS5 + BM25 + CJK bigram search + temporal decay

## License

MIT

### v2.2.1 (2026-04-09)
- **FIX**: `heartbeat` config: `enabled`+`intervalMinutes` → `every: "30m"` (matches OpenClaw schema)
- **FIX**: Timezone-aware dates in all scripts (`TZ` env variable support, `en-CA` locale for YYYY-MM-DD)
- **FIX**: `memory-compact.js` skips already-compacted files, won't overwrite archive originals
- **FIX**: `memory-cron.sh` inherits system timezone via `/etc/timezone`

### v2.3.0 (2026-04-09)
- **FIX (critical)**: Search now uses unified FTS5 + LIKE fallback — previously FTS5 missed substrings like `XYZ789`, alphanumeric tokens, and CJK-mixed queries
- **FIX**: Removed redundant code paths (CJK-only vs English-only vs date-filtered) — single unified search logic handles all cases
- **FIX**: `memory-compact.js` uses timezone-aware date comparison (`getToday()`)
- **IMPROVE**: LIKE fallback uses case-insensitive matching for both CJK and English
- **IMPROVE**: All search paths now use TF-density scoring for consistent ranking

### v2.4.0 (2026-04-09)
- **FIX (critical)**: Search score merging — FTS5 and LIKE scores now take max instead of skipping, fixing cases where FTS5 found a chunk but scored it lower than LIKE would have
- **FIX**: Orphan cleanup — `memory-index.js` now removes entries for deleted files (previously accumulated stale records pointing to non-existent files)
- **IMPROVE**: Temporal decay half-life: 30d → 90d (old memories no longer vanish from search results)
- **IMPROVE**: Search precision — "Entry 499" now correctly ranks the chunk containing "499" first (was ranking random chunks higher due to score mismatch)

### v2.5.0 (2026-04-09)
- **FIX (critical)**: memory-flush prompt no longer instructs writing to MEMORY.md (OpenClaw marks it read-only during flush) or running exec commands (may be restricted)
- **NEW**: `memory-boot.js` — single-command session startup (health + index + MEMORY.md output), saves 2 tool calls per session
- **NEW**: `postIndexSync: "async"` config — OpenClaw auto-syncs memory index after compaction
- **IMPROVE**: Cron now detects stale index (files changed but not reindexed) and auto-rebuilds — catches memory-flush writes that didn't trigger reindex
- **IMPROVE**: SKILL.md now includes warning about memory-flush write restrictions

### v2.6.0 (2026-04-09)
- **FIX**: Corrupted database auto-recovery — search/index/boot now detect `SQLITE_NOTADB`/`SQLITE_CORRUPT` and auto-rebuild instead of crashing
- **FIX**: Date-only queries (e.g., "4月2日") now return all chunks from that date instead of empty results. Date tokens are stripped from search keywords to avoid literal matching.
- **FIX**: Date-only queries exclude undated files (MEMORY.md) to focus on the requested day's content
- **IMPROVE**: `memory-boot.js` retries with `--force` if initial index update fails
- **IMPROVE**: SKILL.md now documents `memory-boot.js` in Commands section

### v2.7.0 (2026-04-09)
- **FIX (critical)**: Unified timezone resolution across all scripts — now reads `userTimezone` from `openclaw.json` automatically, matching OpenClaw's memory-flush date calculation. Previously scripts used `TZ` env var (often UTC in cron), causing date mismatches where flush writes `memory/2026-04-10.md` but our scripts think today is `2026-04-09`.
- **NEW**: `_timezone.js` shared module — single source of truth for timezone resolution
- **NEW**: Resolution order: `OPENCLAW_TZ` > `openclaw.json userTimezone` > `TZ` > `/etc/timezone` > `/etc/localtime` > `UTC`
- **IMPROVE**: `memory-cron.sh` reads timezone from `openclaw.json` instead of relying on system TZ

### v2.8.0 (2026-04-09)
- **NEW**: `memory-backup.sh` — Auto-backup workspace to GitHub private repo (runs every 6h via cron, only pushes if changes exist)
- **NEW**: `memory-restore.sh` — One-command disaster recovery after reinstall (restores memories, config, skills, crontab, rebuilds search index)
- **NEW**: Cron Step 6 automatically triggers backup after memory maintenance
- **IMPROVE**: SKILL.md documents full backup & disaster recovery workflow

### v2.9.0 (2026-04-09)
- **OPTIMIZE**: `boot.js` smart MEMORY.md truncation — keeps section headers + most recent entries per section. Default 1500 chars (~500 tokens). Prevents unbounded token growth (saves 94% at 18KB MEMORY.md).
- **OPTIMIZE**: Search results use keyword-context extraction — truncates around the matching keyword instead of from the start, showing more relevant snippets
- **NEW**: `boot.js --max-chars N` to control token budget; `--full` for no truncation
- **NEW**: `search.js --max-chars N` for per-result truncation control
