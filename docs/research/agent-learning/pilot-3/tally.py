# Collect the blind judge tables for pilot 3: python3 tally.py <work-dir>
import sys, re, json, statistics as st
R = sys.argv[1]
PACKETS, ARMS, REPS, BATCHES = "CDE", ["S2", "S1", "N", "P"], "123", "1234"
rows, items = {}, {}  # (P, src) -> per-pass dicts ; (P, src, pass) -> {item: v}
num = lambda s: float(re.sub(r"[^\d.\-]", "", s.replace("−", "-")) or 0)
for P in PACKETS:
    for J in "12":
        m = {}
        for line in open(f"{R}/scores/mapping-{P}-{J}.txt"):
            k, v = line.strip().split("=")
            _, b, x = k.split("-")
            m[(b, x)] = v
        for b in BATCHES:
            for line in open(f"{R}/ws-judge-{P}-{J}-{b}/scores.md").read().splitlines():
                c = [s.strip() for s in line.strip().strip("|").split("|")]
                id_ = re.match(rf"\**({P}-K\d+)\b", c[0]) if len(c) == 4 else None
                if id_:  # Grok rows are "C-K1"; Haiku rows are "C-K1 (name)"
                    for i, x in enumerate(["X1", "X2", "X3"]):
                        items.setdefault((P, m[(b, x)], J), {})[id_.group(1)] = num(c[i + 1])
                if len(c) == 6 and re.fullmatch(r"\**X[123]\**", c[0]):
                    n = [num(s) for s in c[1:]]
                    rows.setdefault((P, m[(b, c[0].strip("*"))]), []).append(dict(J=J, items=n[0], rank=n[1], ans=n[2], err=n[3], total=n[4]))
json.dump({"rows": {f"{k[0]}|{k[1]}": v for k, v in rows.items()}, "items": {f"{k[0]}|{k[1]}|{k[2]}": v for k, v in items.items()}},
          open(f"{R}/scores/tally.json", "w"), ensure_ascii=False, indent=1)
for P in PACKETS:
    keys = sorted({i for k, v in items.items() if k[0] == P for i in v}, key=lambda s: int(s.split("K")[1]))
    assert all(len(items[(P, f"{A}-{r}", J)]) == len(keys) for A in ARMS for r in REPS for J in "12"), "item table incomplete"
    print(f"== {P} ({len(keys)} items)")
    for A in ARMS:
        agg = {f: [] for f in ["total", "items", "rank", "ans", "err"]}
        for r in REPS:
            v = rows[(P, f"{A}-{r}")]
            assert len(v) == 2, (P, A, r, len(v))
            for f in agg: agg[f].append(st.mean(x[f] for x in v))
            print(f"  {A}-{r}: passes={[x['total'] for x in v]} items={[x['items'] for x in v]} ans={[x['ans'] for x in v]} err={[x['err'] for x in v]}")
        print(f"  {A} mean total={st.mean(agg['total']):.2f} items={st.mean(agg['items']):.2f} ({100*st.mean(agg['items'])/len(keys):.0f}%) "
              f"rank={st.mean(agg['rank']):.2f} ans={st.mean(agg['ans']):.2f} err={st.mean(agg['err']):.2f}")
    d = [abs(rows[(P, f"{A}-{r}")][0]["total"] - rows[(P, f"{A}-{r}")][1]["total"]) for A in ARMS for r in REPS]
    print(f"  pass1 vs pass2 |diff| mean={st.mean(d):.2f} max={max(d)}")
    print("  per item (mean over 3 reps x 2 passes): " + "  ".join(A for A in ARMS))
    for k in keys:
        print(f"   {k}: " + "  ".join(f"{st.mean(items[(P, f'{A}-{r}', J)].get(k, 0) for r in REPS for J in '12'):.2f}" for A in ARMS))
