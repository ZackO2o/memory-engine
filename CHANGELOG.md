# Changelog

## v5.0.0 — Memory Guardian (2026-04-12)

**Architecture shift**: Memory Engine evolves from "full-stack memory system" to "memory guardian" — handling everything OpenClaw native memory doesn't do.

### 🆕 New
- **`memory-migrate.js`** — One-command upgrade/rollback tool
  - Auto-detects OpenClaw capabilities (native memorySearch, session-memory hook, QMD)
  - Configures optimal memory setup with zero data loss
  - Automatic config backup before any changes
  - `--rollback --apply` to revert to FTS5-only mode
  - `--status` for JSON capability report

### ✨ Enhanced
- **`memory-boot.js`** — Auto-detects native memorySearch mode
  - Skips FTS5 indexing when native is active (faster startup)
  - Shows search mode in boot output: `🔍 Native search` or `🔍 FTS5`
- **`memory-search.js`** — Dual-mode search header
  - FTS5 remains as full-featured fallback
  - All existing flags (`--last`, `--tag`, `--today`, `--date`, etc.) unchanged
- **SKILL.md** — Complete rewrite for v5.0 architecture
  - New comparison table: native vs memory-engine capabilities
  - Dual setup guide (Quick Setup for native + Classic Setup for FTS5)
  - Upgrade instructions with zero-data-loss guarantee

### 🔄 Migration
The migrate tool enables:
1. Native `memorySearch` with hybrid search + temporal decay
2. `session-memory` hook (auto-save on /new and /reset)
3. `forceFlushTranscriptBytes` for large sessions
4. Cron frequency update (6h → 1h) if needed

### ⚠️ Zero Breaking Changes
- All v3/v4 commands work identically
- FTS5 search available as fallback when native isn't configured
- `better-sqlite3` now optional (only for FTS5 mode)
- Existing memory files, indices, daily logs all preserved

---

## v4.0.0 — Session Reset Watcher (2026-04-12)

Based on real-world failure analysis: 15 session resets, 0 memory-flush triggers.

### 🆕 New
- **`memory-watcher.sh`** (P0) — Daemon that polls every 30s for session resets
  - Detects new `.reset.` files and immediately extracts memory
  - Auto-started and maintained by cron via PID file
  - Eliminates the reset→amnesia window: from 6h to <30s
- **`--active` mode** for `memory-auto-extract.js` (P1)
  - Incremental extraction from active sessions (offset-based)
  - Reads only new bytes since last extraction, safe for frequent runs

### ✨ Enhanced
- **Cron frequency** 6h → 1h (P1)
- **`memory-resume.js`** — Auto-detects and extracts unprocessed reset sessions before resuming (P1)
- **`memory-auto-extract.js`** — 11 new extraction patterns (P2):
  - Test results, API responses, config changes, version releases
  - Bug fixes, assistant summaries, feature completions
- **`memory-cron.sh`** — Ensures watcher daemon is always running

---

## v3.0.0 — Session Recovery & Smart Tools (2026-04-10)

All 6 user feedback items implemented.

### 🆕 New
- **`memory-resume.js`** — Zero-latency session recovery (<2000 tokens)
- **`memory-auto-extract.js`** — Auto-extract from session transcripts
- **`--last N`** for `memory-search.js` — Time-ordered recent entries
- **`--gc`** for `memory-maintain.js` — MEMORY.md auto-cleanup

### ✨ Enhanced
- Write deduplication (skip near-identical entries)
- Memory-flush prompt fix (no MEMORY.md writes during flush)
- `memory-boot.js` — Single-command startup (replaces 3 calls)
- Session size warning in cron
- `postIndexSync: async` support

---

## v2.0.0 — Three-Layer Anti-Amnesia (2026-04-09)

Initial public release.

- Three-layer architecture: System (cron) + Platform (memory-flush) + Agent (scripts)
- SQLite FTS5 with BM25 + CJK bigram search
- Temporal decay ranking (90-day half-life)
- 6 scripts: write, search, index, maintain, backup, restore
- Unified timezone handling
- GitHub disaster recovery (auto-backup + one-click restore)
- Token-optimized: search 0 tokens, results ~300 tokens
