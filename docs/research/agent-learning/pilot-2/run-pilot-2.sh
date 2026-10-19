#!/usr/bin/env bash
# Pilot 2: harder packets (C, D; 12 sources each), same add-on, same arms.
#   ./run-pilot-2.sh calib        one N run per packet, to check the packet is hard enough (N < 70% of items)
#   ./run-pilot-2.sh test         2 packets x 3 arms x 3 reps through cursor-delegate
#   ./run-pilot-2.sh judge        two blind passes per packet, each its own shuffle, graded in batches of three answers
# Arms: S = with the learned add-on (skill.md, unchanged from pilot 1), N = nothing, P = generic "be careful" placebo.
set -u
S="$(cd "$(dirname "$0")" && pwd)"
RELAY="$HOME/.claude/skills/cursor-delegate/scripts/relay.mjs"
MODEL="${MODEL:-grok-4.7-medium}"
REPS="1 2 3"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$S/runs" "$S/scores"

arm_text() {
  case "$1" in
    S) echo "Before you start, read skill.md in this workspace and follow its method step by step. Write your answer in the structure given below." ;;
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
  local files=("$S/pilot/packet-$P.md"); [ "$ARM" = S ] && files+=("$S/pilot/skill.md")
  mkws "$w" "${files[@]}"; mv "$w/packet-$P.md" "$w/packet.md"
  (cd "$w" && git add -A && git -c user.name=x -c user.email=x@x commit -qm packet)
  python3 -I -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[3],"w").write(t.replace("__ARM__",sys.argv[2]))' \
    "$S/briefs/40-test-template.txt" "$(arm_text "$ARM")" "$S/briefs/$name.txt"
  run "$name" "$S/briefs/$name.txt" "$w"
}

case "${1:-}" in
  calib)
    for P in C D; do test_one "$P" N "${CALIB_TAG:-0}" & done; wait ;;
  test)
    for P in C D; do
      for ARM in S N P; do for REP in $REPS; do test_one "$P" "$ARM" "$REP" & done; done
      wait   # one packet (9 runs) at a time
    done ;;
  judge)
    # Two independent passes per packet. Each pass shuffles the nine answers and grades them in three batches of three,
    # because one judge writing a 20x9 table looped and was stopped by Cursor. Mapping stays out of the judge's workspace.
    for P in C D; do for J in 1 2; do
      m="$S/scores/mapping-$P-$J.txt"; : > "$m"; b=0; i=0
      for src in $(for A in S N P; do for R in $REPS; do echo "$A-$R"; done; done | python3 -I -c 'import sys,random;l=sys.stdin.read().split();random.shuffle(l);print("\n".join(l))'); do
        if [ $((i % 3)) -eq 0 ]; then
          b=$((b+1)); w="$S/ws-judge-$P-$J-$b"; mkws "$w" "$S/pilot/packet-$P.md" "$S/pilot/key-$P.md"
          mv "$w/packet-$P.md" "$w/packet.md"; mv "$w/key-$P.md" "$w/key.md"
        fi
        i=$((i+1)); k=$(( (i-1) % 3 + 1 )); f="$S/ws-test-$P-$src/answer.md"
        if [ -f "$f" ]; then cp "$f" "$w/X$k.md"; else echo "(لم يكتب هذا الإجينت إجابة)" > "$w/X$k.md"; fi
        echo "$J-$b-X$k=$src" >> "$m"
      done
      for b in 1 2 3; do w="$S/ws-judge-$P-$J-$b"
        (cd "$w" && git add -A && git -c user.name=x -c user.email=x@x commit -qm answers)
        run "50-judge-$P-$J-$b" "$S/briefs/50-judge-batch-template.txt" "$w" &
      done
    done; wait; done
    for P in C D; do for J in 1 2; do for b in 1 2 3; do
      echo "== $P pass $J batch $b"; grep "^$J-$b-" "$S/scores/mapping-$P-$J.txt" | paste -sd' ' -
      jq -r '.status' "$S/runs/50-judge-$P-$J-$b/result.json"; jq -r '.finalMessage' "$S/runs/50-judge-$P-$J-$b/result.json" 2>/dev/null | tail -1
    done; done; done ;;
  *) echo "usage: $0 calib|test|judge"; exit 2 ;;
esac
