import sys, re, json, os, glob, statistics as st
R = sys.argv[1]
rows = {}   # (P, src) -> list of dicts per pass
items = {}  # (P, src, pass) -> {item: v}
for P in "CD":
    for J in "12":
        m = {}
        for line in open(f"{R}/scores/mapping-{P}-{J}.txt"):
            k, v = line.strip().split("=")
            _, b, x = k.split("-")
            m[(b, x)] = v
        for b in "123":
            t = open(f"{R}/ws-judge-{P}-{J}-{b}/scores.md").read()
            for line in t.splitlines():
                c = [s.strip() for s in line.strip().strip("|").split("|")]
                if len(c) == 4 and re.match(rf"{P}-K\d+", c[0]):
                    for i, x in enumerate(["X1", "X2", "X3"]):
                        items.setdefault((P, m[(b, x)], J), {})[c[0]] = float(c[i+1])
                if len(c) == 6 and re.fullmatch(r"\*?\*?X[123]\*?\*?", c[0]):
                    x = c[0].strip("*")
                    nums = [float(re.sub(r"[^\d.\-−]", "", s).replace("−", "-") or 0) for s in c[1:]]
                    rows.setdefault((P, m[(b, x)]), []).append(dict(J=J, items=nums[0], rank=nums[1], ans=nums[2], err=nums[3], total=nums[4]))
out = {"rows": {f"{k[0]}|{k[1]}": v for k, v in rows.items()}, "items": {f"{k[0]}|{k[1]}|{k[2]}": v for k, v in items.items()}}
json.dump(out, open(f"{R}/scores/tally.json", "w"), ensure_ascii=False, indent=1)
for P in "CD":
    nitems = len(next(v for k, v in items.items() if k[0] == P))
    print(f"== {P} ({nitems} items)")
    for A in "SNP":
        ts, its, rk, an, er = [], [], [], [], []
        for r in "123":
            v = rows[(P, f"{A}-{r}")]
            ts.append(st.mean(x["total"] for x in v)); its.append(st.mean(x["items"] for x in v))
            rk.append(st.mean(x["rank"] for x in v)); an.append(st.mean(x["ans"] for x in v)); er.append(st.mean(x["err"] for x in v))
            print(f"  {A}-{r}: passes={[x['total'] for x in v]} items={[x['items'] for x in v]} rank={[x['rank'] for x in v]} ans={[x['ans'] for x in v]} err={[x['err'] for x in v]}")
        print(f"  {A} mean total={st.mean(ts):.2f} items={st.mean(its):.2f} ({100*st.mean(its)/nitems:.0f}%) rank={st.mean(rk):.2f} ans={st.mean(an):.2f} err={st.mean(er):.2f}")
    # judge agreement
    d = [abs(rows[(P, s)][0]["total"] - rows[(P, s)][1]["total"]) for s in [f"{A}-{r}" for A in "SNP" for r in "123"]]
    print(f"  pass1 vs pass2 |diff| mean={st.mean(d):.2f} max={max(d)}")
