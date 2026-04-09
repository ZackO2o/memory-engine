#!/bin/bash
# memory-cron.sh — System-level memory maintenance (runs independently of AI)
# Install: (crontab -l; echo "0 */6 * * * /path/to/memory-cron.sh") | crontab -

WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$WORKSPACE/.memory/cron.log"

mkdir -p "$(dirname "$LOG")"

# Rotate log if > 100KB
[ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 102400 ] && mv "$LOG" "$LOG.old"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron started" >> "$LOG"

# 1. Rebuild index (incremental, skips unchanged files)
RESULT=$(node "$SCRIPT_DIR/memory-index.js" --workspace "$WORKSPACE" 2>&1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] index: $RESULT" >> "$LOG"

# 2. Health check
HEALTH=$(node "$SCRIPT_DIR/memory-write.js" --workspace "$WORKSPACE" --status 2>&1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] health: $HEALTH" >> "$LOG"

# 3. Auto-create daily log if missing
HAS_TODAY=$(echo "$HEALTH" | grep -o '"hasTodayLog": *[a-z]*' | grep -o '[a-z]*$')
if [ "$HAS_TODAY" = "false" ]; then
    node "$SCRIPT_DIR/memory-write.js" --workspace "$WORKSPACE" --today "[auto] No activity logged today" --tag system
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] auto-created daily log" >> "$LOG"
fi

# 4. Auto-compact files older than 60 days (monthly, on the 1st)
if [ "$(date '+%d')" = "01" ]; then
    COMPACT=$(node "$SCRIPT_DIR/memory-compact.js" --workspace "$WORKSPACE" --older-than 60 2>&1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] compact: $COMPACT" >> "$LOG"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron completed" >> "$LOG"
