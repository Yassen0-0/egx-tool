#!/usr/bin/env bash
# Pilot test: 2 packets x 3 arms x 2 reps through cursor-delegate, then one blind judge per packet.
# Arms: S = with the learned add-on (skill.md), N = nothing, P = generic "be careful" placebo.
set -u
S="$(cd "$(dirname "$0")" && pwd)"
RELAY="$HOME/.claude/skills/cursor-delegate/scripts/relay.mjs"
MODEL=grok-4.7-medium
export PATH="$HOME/.local/bin:$PATH"

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

for P in A B; do
  for ARM in S N P; do
    for REP in 1 2; do
      name="40-test-$P-$ARM-$REP"; w="$S/ws-test-$P-$ARM-$REP"
      files=("$S/pilot/packet-$P.md"); [ "$ARM" = S ] && files+=("$S/pilot/skill.md")
      mkws "$w" "${files[@]}"; mv "$w/packet-$P.md" "$w/packet.md"
      (cd "$w" && git add -A && git -c user.name=x -c user.email=x@x commit -qm packet)
      python3 -I -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[3],"w").write(t.replace("__ARM__",sys.argv[2]))' \
        "$S/briefs/40-test-template.txt" "$(arm_text $ARM)" "$S/briefs/$name.txt"
      run "$name" "$S/briefs/$name.txt" "$w" &
    done
  done
  wait   # one packet (6 runs) at a time
done

# Blind judging: shuffle the six answers of each packet into X1..X6, keep the mapping out of the judge's workspace.
for P in A B; do
  w="$S/ws-judge-$P"; mkws "$w" "$S/pilot/packet-$P.md" "$S/pilot/key-$P.md"
  mv "$w/packet-$P.md" "$w/packet.md"; mv "$w/key-$P.md" "$w/key.md"
  : > "$S/pilot/mapping-$P.txt"; i=0
  for src in $(printf '%s\n' S-1 S-2 N-1 N-2 P-1 P-2 | python3 -I -c 'import sys,random;l=sys.stdin.read().split();random.shuffle(l);print("\n".join(l))'); do
    i=$((i+1)); f="$S/ws-test-$P-$src/answer.md"
    if [ -f "$f" ]; then cp "$f" "$w/X$i.md"; else echo "(لم يكتب هذا الإجينت إجابة)" > "$w/X$i.md"; fi
    echo "X$i=$src" >> "$S/pilot/mapping-$P.txt"
  done
  (cd "$w" && git add -A && git -c user.name=x -c user.email=x@x commit -qm answers)
  run "50-judge-$P" "$S/briefs/50-judge-template.txt" "$w" &
done
wait

for P in A B; do
  echo "== $P"; cat "$S/pilot/mapping-$P.txt" | paste -sd' ' -
  jq -r '.finalMessage' "$S/runs/50-judge-$P/result.json" 2>/dev/null | tail -2
done
