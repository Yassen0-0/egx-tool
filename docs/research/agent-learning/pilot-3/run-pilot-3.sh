#!/usr/bin/env bash
# Pilot 3: the return arrow. Add-on v2 (concrete checks) against v1, nothing, and a generic placebo,
# on packets C and D from pilot 2 plus a new packet E in a third domain.
#   WORK=/tmp/dir ./run-pilot-3.sh setup     copy packets, keys and both add-ons into $WORK/pilot (outside the repo)
#   WORK=... MODEL=composer-2.5 ./run-pilot-3.sh test       3 packets x 4 arms x 3 reps through cursor-delegate
#   WORK=... MODEL=grok-4.7-medium ./run-pilot-3.sh judge   two blind passes per packet, each its own shuffle, in batches of three answers
# Arms: S2 = add-on v2 (skill-v2.md), S1 = add-on v1 (pilot/02-skill.md), N = nothing, P = generic "be careful" placebo.
# S1 and S2 get the same arm text; the only difference is which file sits in the workspace as skill.md.
set -u
SRC="$(cd "$(dirname "$0")" && pwd)"
S="${WORK:?set WORK to a scratch directory outside the repo}"
RELAY="$HOME/.claude/skills/cursor-delegate/scripts/relay.mjs"
MODEL="${MODEL:-composer-2.5}"
PACKETS="${PACKETS:-C D E}"
ARMS="S2 S1 N P"
REPS="1 2 3"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$S/runs" "$S/scores" "$S/briefs" "$S/pilot"

arm_text() {
  case "$1" in
    S1|S2) echo "Before you start, read skill.md in this workspace and follow its method step by step. Write your answer in the structure given below." ;;
    N) echo "" ;;
    P) echo "Be careful and critical: check each source thoroughly before you trust it, and think about what could make it wrong." ;;
  esac
}

mkws() {  # mkws <dir> <files...>
  local w="$1"; shift
  rm -rf "$w"; mkdir -p "$w"; cp "$@" "$w/"
  (cd "$w" && git init -q && git add . && git -c user.name=x -c user.email=x@x commit -qm base)
}

run() {  # run <name> <brief> <workspace>
  node "$RELAY" --brief "$2" --cd "$3" --no-force --model "$MODEL" --timeout 30m \
    --out-dir "$S/runs/$1" > "$S/runs/$1.stdout" 2>&1
}

test_one() {  # test_one <packet> <arm> <rep>
  local P="$1" ARM="$2" REP="$3"
  local name="40-test-$P-$ARM-$REP" w="$S/ws-test-$P-$ARM-$REP"
  local files=("$S/pilot/packet-$P.md")
  mkws "$w" "${files[@]}"; mv "$w/packet-$P.md" "$w/packet.md"
  case "$ARM" in S1) cp "$S/pilot/skill-v1.md" "$w/skill.md" ;; S2) cp "$S/pilot/skill-v2.md" "$w/skill.md" ;; esac
  (cd "$w" && git add -A && git -c user.name=x -c user.email=x@x commit -qm packet)
  python3 -I -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[3],"w").write(t.replace("__ARM__",sys.argv[2]))' \
    "$SRC/briefs/40-test-template.txt" "$(arm_text "$ARM")" "$S/briefs/$name.txt"
  run "$name" "$S/briefs/$name.txt" "$w"
}

case "${1:-}" in
  setup)
    cp "$SRC/../pilot-2/tasks/packet-C.md" "$SRC/../pilot-2/tasks/packet-D.md" "$SRC/../pilot-2/tasks/key-C.md" "$SRC/../pilot-2/tasks/key-D.md" \
       "$SRC/tasks/packet-E.md" "$SRC/tasks/key-E.md" "$S/pilot/"
    cp "$SRC/../pilot/02-skill.md" "$S/pilot/skill-v1.md"; cp "$SRC/skill-v2.md" "$S/pilot/skill-v2.md"
    # The judge's copy of key-E stops before the reviewers' cross-packet table, which names C and D items.
    python3 -I -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[1],"w").write(t.split("\n## الأنواع")[0].rstrip()+"\n")' "$S/pilot/key-E.md"
    ls -l "$S/pilot" ;;
  test)
    for P in $PACKETS; do
      for ARM in $ARMS; do for REP in $REPS; do test_one "$P" "$ARM" "$REP" & done; done
      wait   # one packet (12 runs) at a time
    done ;;
  judge)
    # Two independent passes per packet. Each pass shuffles the twelve answers and grades them in four batches of three,
    # because a judge writing a big table loops and is stopped by Cursor. Mapping stays out of the judge's workspace.
    for P in $PACKETS; do for J in 1 2; do
      m="$S/scores/mapping-$P-$J.txt"; : > "$m"; b=0; i=0
      for src in $(for A in $ARMS; do for R in $REPS; do echo "$A-$R"; done; done | python3 -I -c 'import sys,random;l=sys.stdin.read().split();random.shuffle(l);print("\n".join(l))'); do
        if [ $((i % 3)) -eq 0 ]; then
          b=$((b+1)); w="$S/ws-judge-$P-$J-$b"; mkws "$w" "$S/pilot/packet-$P.md" "$S/pilot/key-$P.md"
          mv "$w/packet-$P.md" "$w/packet.md"; mv "$w/key-$P.md" "$w/key.md"
        fi
        i=$((i+1)); k=$(( (i-1) % 3 + 1 )); f="$S/ws-test-$P-$src/answer.md"
        if [ -f "$f" ]; then cp "$f" "$w/X$k.md"; else echo "(لم يكتب هذا الإجينت إجابة)" > "$w/X$k.md"; fi
        echo "$J-$b-X$k=$src" >> "$m"
      done
      for b in 1 2 3 4; do w="$S/ws-judge-$P-$J-$b"
        (cd "$w" && git add -A && git -c user.name=x -c user.email=x@x commit -qm answers)
        run "50-judge-$P-$J-$b" "$SRC/briefs/50-judge-batch-template.txt" "$w" &
      done
    done; wait; done
    for P in $PACKETS; do for J in 1 2; do for b in 1 2 3 4; do
      echo "== $P pass $J batch $b"; grep "^$J-$b-" "$S/scores/mapping-$P-$J.txt" | paste -sd' ' -
      jq -r '.status' "$S/runs/50-judge-$P-$J-$b/result.json"; jq -r '.finalMessage' "$S/runs/50-judge-$P-$J-$b/result.json" 2>/dev/null | tail -1
    done; done; done ;;
  *) echo "usage: WORK=<dir> $0 setup|test|judge"; exit 2 ;;
esac
