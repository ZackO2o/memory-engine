#!/bin/bash
# memory-cron.sh — System-level memory maintenance (runs independently of AI)
# Install: (crontab -l; echo "0 */6 * * * /path/to/memory-cron.sh") | crontab -

WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$WORKSPACE/.memory/cron.log"

# Inherit timezone from system or use fallback
export TZ="${TZ:-$(cat /etc/timezone 2>/dev/null || echo UTC)}"

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

# 5. Verify index is in sync (catches memory-flush writes that didn't trigger reindex)
SYNC_CHECK=$(node -e "
const fs=require('fs'),p=require('path'),c=require('crypto');
const ws='$WORKSPACE',mdir=p.join(ws,'memory'),db_path=p.join(ws,'.memory','index.sqlite');
if(!fs.existsSync(db_path)){console.log('no_index');process.exit(0);}
const GM=require('child_process').execSync('npm root -g',{encoding:'utf8'}).trim();
const D=require(p.join(GM,'better-sqlite3'));
const db=new D(db_path,{readonly:true});
const dbFiles=db.prepare('SELECT path,hash FROM files').all();
const dbMap=new Map(dbFiles.map(f=>[f.path,f.hash]));
let stale=0;
const hash=c=>require('crypto').createHash('sha256').update(c).digest('hex').slice(0,16);
if(fs.existsSync(p.join(ws,'MEMORY.md'))){const h=hash(fs.readFileSync(p.join(ws,'MEMORY.md'),'utf8'));if(dbMap.get('MEMORY.md')!==h)stale++;}
if(fs.existsSync(mdir))fs.readdirSync(mdir).filter(f=>f.endsWith('.md')).forEach(f=>{const h=hash(fs.readFileSync(p.join(mdir,f),'utf8'));if(dbMap.get('memory/'+f)!==h)stale++;});
console.log(stale?'stale:'+stale:'ok');
db.close();
" 2>&1)
if echo "$SYNC_CHECK" | grep -q "stale"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] index stale ($SYNC_CHECK), forcing reindex" >> "$LOG"
    node "$SCRIPT_DIR/memory-index.js" --workspace "$WORKSPACE" --force >> "$LOG" 2>&1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron completed" >> "$LOG"
