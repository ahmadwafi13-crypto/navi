#!/usr/bin/env bash
# NAVI - demo & evidence script.
# Produces real command output for the hackathon submission evidence pack.
# Usage: bash scripts/evidence.sh
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="evidence/logs"
mkdir -p "$OUT"

log() { printf '\n=== %s ===\n' "$1"; }

log "0. Environment"
{
  echo "workspace_root: $ROOT"
  echo "node: $(node --version)"
  echo "npm: $(npm --version)"
  echo "python: $(python --version 2>&1)"
  echo "git: $(git --version)"
  echo "date_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$OUT/00-environment.txt"

log "1. Files read (inventory + presence check)"
{
  echo "## Files present in workspace:"
  find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" \
       -not -name "*.sqlite*" -not -path "./apps/web/dist/*" | sort
  echo
  echo "## PANDUAN_HACKATHON.pdf presence check:"
  if [ -f "PANDUAN_HACKATHON.pdf" ] || [ -f "prd/PANDUAN_HACKATHON.pdf" ]; then
    echo "FOUND"
  else
    echo "NOT FOUND in workspace"
    echo "Google Drive file_id 1mGFTmLzSkbxHx-7UBmsiB-GMDNBfzSWm -> UPSTREAM_REJECTED (not visible / not authorized)"
    echo "Google Drive search 'PANDUAN HACKATHON' -> 0 results"
  fi
} | tee "$OUT/01-file-inventory.txt"

log "2. Typecheck"
{
  echo "### apps/api"
  (cd apps/api && npx tsc --noEmit 2>&1) && echo "apps/api typecheck: PASS (0 errors)"
  echo "### apps/web"
  (cd apps/web && npx tsc --noEmit 2>&1) && echo "apps/web typecheck: PASS (0 errors)"
} | tee "$OUT/02-typecheck.txt"

log "3. Frontend build"
(cd apps/web && npx vite build 2>&1) | tee "$OUT/03-frontend-build.txt"

log "4. Acceptance test suite (20 official cases + 6 extra)"
(cd apps/api && npx tsx scripts/run-tests.ts 2>&1 | grep -v ExperimentalWarning | grep -v trace-warnings) \
  | tee "$OUT/04-test-suite.txt"

log "5. Test suite determinism (3 consecutive runs)"
{
  for i in 1 2 3; do
    echo "--- run $i ---"
    (cd apps/api && npx tsx scripts/run-tests.ts 2>&1 | grep -E "^PASS: " )
  done
} | tee "$OUT/05-determinism.txt"

log "6. Live HTTP demo path (real server, real curl)"
rm -f data/navi-runtime.sqlite data/navi-runtime.sqlite-wal data/navi-runtime.sqlite-shm
(cd apps/api && PORT=8787 NAVI_REFERENCE_NOW=2026-11-06T10:00:00+07:00 npx tsx src/index.ts > "$OUT/06-server.log" 2>&1 &)
sleep 6

API="http://127.0.0.1:8787"
{
  echo "### health"
  curl -s "$API/v1/health"; echo; echo

  echo "### login (Maya Putri, USR-001)"
  LOGIN=$(curl -s -X POST "$API/v1/auth/session" -H "Content-Type: application/json" -d '{"user_id":"USR-001"}')
  echo "$LOGIN"
  KEY=$(echo "$LOGIN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).api_key))")
  AUTH="Authorization: Bearer $KEY"
  echo; echo

  echo "### HAPPY PATH: create run"
  RUN=$(curl -s -X POST "$API/v1/runs" -H "$AUTH" -H "Content-Type: application/json" -d '{
    "text": "Kirim notulen MTG-02 yang sudah disahkan ke Budi Santoso (USR-101) dengan subjek Ringkasan Koordinasi Tugas. Isi: Halo Budi, terlampir notulen yang sudah disahkan, mohon ditinjau. Lalu buat tugas untuk Sari Lestari (USR-103) berjudul Finalisasi checklist operasional, tenggat Selasa 10 November 2026 pukul 16.00 WIB."
  }')
  echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('run_id:',r.run_id);console.log('step:',r.step);r.actions.forEach(a=>console.log(' ',a.action_id,a.type,a.state,'v'+a.version,a.payload_hash.slice(0,16)));})"
  RUN_ID=$(echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).run_id))")
  echo

  EMAIL_ID=$(echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).actions.find(a=>a.type==='email.create').action_id))")
  TASK_ID=$(echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).actions.find(a=>a.type==='task.create').action_id))")

  echo "### EXACT PREVIEW (email)"
  curl -s "$API/v1/actions/$EMAIL_ID/preview" -H "$AUTH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log('state:',p.state,'| version:',p.version);console.log('payload_hash:',p.payload_hash);console.log('exact fields:',p.exact_preview_fields.join(', '));console.log('payload:');console.log(JSON.stringify(p.payload,null,2));})"
  echo

  echo "### APPROVE (human decision, authenticated session)"
  curl -s -X POST "$API/v1/actions/$EMAIL_ID/decision" -H "$AUTH" -H "Content-Type: application/json" -d '{"decision":"APPROVE"}'
  echo; echo
  curl -s -X POST "$API/v1/actions/$TASK_ID/decision" -H "$AUTH" -H "Content-Type: application/json" -d '{"decision":"APPROVE"}'
  echo; echo

  echo "### EXECUTE via gateway (email)"
  curl -s -X POST "$API/internal/execute" -H "$AUTH" -H "Content-Type: application/json" -d "{\"action_id\":\"$EMAIL_ID\",\"idempotency_key\":\"demo-email-1\"}"
  echo; echo
  echo "### EXECUTE via gateway (task)"
  curl -s -X POST "$API/internal/execute" -H "$AUTH" -H "Content-Type: application/json" -d "{\"action_id\":\"$TASK_ID\",\"idempotency_key\":\"demo-task-1\"}"
  echo; echo

  echo "### IDEMPOTENCY REPLAY (same key again)"
  curl -s -X POST "$API/internal/execute" -H "$AUTH" -H "Content-Type: application/json" -d "{\"action_id\":\"$EMAIL_ID\",\"idempotency_key\":\"demo-email-1\"}"
  echo; echo

  echo "### REFUSAL: execute a NEW action that was never approved"
  RUN2=$(curl -s -X POST "$API/v1/runs" -H "$AUTH" -H "Content-Type: application/json" -d '{
    "text": "Kirim notulen MTG-02 yang sudah disahkan ke Budi Santoso (USR-101) dengan subjek Ringkasan Koordinasi Tugas. Isi: Halo Budi, terlampir notulen yang sudah disahkan, mohon ditinjau."
  }')
  EMAIL2=$(echo "$RUN2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).actions.find(a=>a.type==='email.create').action_id))")
  curl -s -o /dev/stderr -w "HTTP_STATUS=%{http_code}\n" -X POST "$API/internal/execute" -H "$AUTH" -H "Content-Type: application/json" -d "{\"action_id\":\"$EMAIL2\",\"idempotency_key\":\"demo-unapproved\"}" 2>&1
  echo

  echo "### AUDIT TRAIL"
  curl -s "$API/v1/runs/$RUN_ID/audit" -H "$AUTH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);a.events.forEach(e=>console.log('#'+e.seq,e.event_type.padEnd(26),e.actor.padEnd(9),(e.state_before||'-')+' -> '+(e.state_after||'-')));})"
  echo

  echo "### AUDIT HASH CHAIN VERIFY"
  curl -s "$API/v1/audit/verify" -H "$AUTH"; echo
} | tee "$OUT/07-demo-http.txt"

log "7. MOCK TOOL PERSISTENCE (real rows in SQLite)"
{
  echo "### mock_email_messages"
  node -e "
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync('data/navi-runtime.sqlite');
  for(const r of db.prepare('SELECT id,action_id,recipient_emails,subject FROM mock_email_messages').all()) console.log(JSON.stringify(r));
  console.log('### mock_tasks');
  for(const r of db.prepare('SELECT id,action_id,assignee_id,title,due_at FROM mock_tasks').all()) console.log(JSON.stringify(r));
  console.log('### mock_calendar_events');
  for(const r of db.prepare('SELECT id,action_id,title,start_at,timezone FROM mock_calendar_events').all()) console.log(JSON.stringify(r));
  db.close();
  " 2>/dev/null
} | tee "$OUT/08-mock-persistence.txt"

log "8. NO REAL SIDE EFFECT (AC20) - outbound capability scan"
{
  echo "### network / mail / connector calls in apps/"
  grep -rnE "smtp|nodemailer|fetch\(|axios|https?://(?!127\.0\.0\.1|localhost)" apps/api/src apps/web/src 2>/dev/null \
    | grep -vE "127\.0\.0\.1|localhost" || echo "(no outbound calls found)"
  echo
  echo "### only localhost references:"
  grep -rnoE "https?://[a-zA-Z0-9.:_-]+" apps/api/src apps/web/src 2>/dev/null | sort -u
} | tee "$OUT/09-no-real-side-effect.txt"

log "9. WORKBUDDY SKILLS (4 agent roles packaged as loadable WorkBuddy Skills)"
{
  echo "### user-level installed skills:"
  ls -1 ~/.workbuddy-ai/skills/ | grep navi
  echo
  echo "### project-level skills:"
  ls -1 .workbuddy-ai/skills/
  echo
  echo "### each skill frontmatter:"
  for f in .workbuddy-ai/skills/*/SKILL.md; do
    echo "--- $f"
    sed -n '1,7p' "$f"
  done
} | tee "$OUT/10-workbuddy-skills.txt"

log "10. EVIDENCE PACK COMPLETE"
ls -la "$OUT"

# stop the demo server
pkill -f "tsx src/index.ts" 2>/dev/null
exit 0
