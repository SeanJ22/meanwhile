"""Who holds the big collections in a V8 heap snapshot.
Usage: retainers.py <file.heapsnapshot> [minEdges]
For every JS array/Map/Set/object with at least minEdges elements, its shallow+children size estimate and its retainer
path (edge names) up to a context variable, a module or a root."""
import json, sys
import numpy as np
from collections import Counter, defaultdict
path = sys.argv[1]; MIN = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
text = open(path, "r", encoding="utf8").read()
head = json.loads(text[: text.index("},\n\"nodes\"") + 1] + "}") if "},\n\"nodes\"" in text[:100000] else json.loads(text[: text.index(',"nodes"')] + "}")
meta = head["snapshot"]["meta"]
nf = len(meta["node_fields"]); ef = len(meta["edge_fields"])
ntypes = meta["node_types"][0]; etypes = meta["edge_types"][0]
ns = text.index('"nodes":[') + 9; ne = text.index("]", ns)
nodes = np.fromstring(text[ns:ne], dtype=np.int64, sep=",").reshape(-1, nf)
es = text.index('"edges":[', ne) + 9; ee = text.index("]", es)
edges = np.fromstring(text[es:ee], dtype=np.int64, sep=",").reshape(-1, ef)
ss = text.index('"strings":[') + 10
strings = json.loads(text[ss: text.rindex("]") + 1])
del text
T, N, ID, SIZE, EC = 0, 1, 2, 3, 4
ET, EN, ETO = 0, 1, 2
n = len(nodes)
first = np.zeros(n + 1, dtype=np.int64); first[1:] = np.cumsum(nodes[:, EC])
src = np.repeat(np.arange(n), nodes[:, EC])
to = edges[:, ETO] // nf
weak = etypes.index("weak"); shortcut = etypes.index("shortcut") if "shortcut" in etypes else -1
mask = (edges[:, ET] != weak) & (edges[:, ET] != shortcut)
order = np.argsort(to[mask], kind="stable")
rsrc = src[mask][order]; redge = np.nonzero(mask)[0][order]; rto = to[mask][order]
rfirst = np.searchsorted(rto, np.arange(n + 1))
def ename(e):
    t = etypes[edges[e, ET]]
    return f"[{edges[e, EN]}]" if t in ("element", "hidden") else strings[edges[e, EN]]
def label(i):
    t = ntypes[nodes[i, T]]
    return f"{t}:{strings[nodes[i, N]][:60]}"
def children_size(i, depth=2):
    """Self size of the node plus its direct children (and grandchildren) — a cheap estimate for arrays of records."""
    total = int(nodes[i, SIZE]); frontier = [i]; seen = {i}
    for _ in range(depth):
        nxt = []
        for f in frontier:
            for e in range(first[f], first[f + 1]):
                if edges[e, ET] == weak: continue
                c = to[e]
                if c in seen: continue
                seen.add(c); total += int(nodes[c, SIZE]); nxt.append(c)
        frontier = nxt
    return total
def path_up(i, limit=12):
    out = []; cur = i; seen = {i}
    for _ in range(limit):
        cands = [(rsrc[k], redge[k]) for k in range(rfirst[cur], rfirst[cur + 1])]
        if not cands: break
        # prefer context variables and properties over internal/hidden edges
        def rank(c):
            s, e = c; t = etypes[edges[e, ET]]
            return {"context": 0, "property": 1, "element": 2, "internal": 3, "hidden": 4}.get(t, 5)
        cands.sort(key=rank)
        s, e = next(((s, e) for s, e in cands if s not in seen), (None, None))
        if s is None: break
        out.append(f"{ename(e)}<-{label(s)}")
        seen.add(s); cur = s
        if etypes[edges[e, ET]] == "context" or ntypes[nodes[s, T]] == "synthetic": break
    return " | ".join(out)
print(f"nodes {n}, self total {nodes[:, SIZE].sum()/1e6:.0f} MB")
big = np.nonzero(nodes[:, EC] >= MIN)[0]
rows = []
for i in big:
    t = ntypes[nodes[i, T]]
    if t not in ("object", "array"): continue
    rows.append((children_size(i), i))
rows.sort(reverse=True)
for size, i in rows[:40]:
    print(f"{size/1e6:8.1f} MB  {nodes[i, EC]:8d} edges  {label(i)}\n           {path_up(i)}")
