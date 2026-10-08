"""Live heap by allocation site from a V8 sampling heap profile. Usage: prof.py <file.heapprofile> [top] [depth]
Prints the top allocation sites (self) and the top repo frames on the stack (inclusive: the nearest repo frame that is not a library)."""
import json, sys, collections
p = json.load(open(sys.argv[1]))
top = int(sys.argv[2]) if len(sys.argv) > 2 else 25
depth = int(sys.argv[3]) if len(sys.argv) > 3 else 4
sites = collections.Counter(); repo = collections.Counter(); chains = collections.Counter()
total = 0
def short(cf):
    u = cf['url'].split('/meanwhile/')[-1].split('wt-before/')[-1].split('agent-a35d8b95fdd51edac/')[-1]
    return f"{cf['functionName'] or '(anon)'} {u}:{cf['lineNumber'] + 1}"
def walk(node, stack):
    global total
    cf = node['callFrame']
    st = stack + [cf]
    s = node.get('selfSize', 0)
    if s:
        total += s
        sites[short(cf)] += s
        ours = [f for f in st if ('/lib/' in f['url'] or '/scripts/' in f['url']) and 'node_modules' not in f['url']]
        if ours:
            repo[short(ours[-1])] += s
            chains[' <- '.join(short(f) for f in reversed(ours[-depth:]))] += s
        else:
            repo['(no repo frame)'] += s
    for c in node.get('children', []):
        walk(c, st)
sys.setrecursionlimit(100000)
walk(p['head'], [])
print(f"total sampled live {total/1e6:.0f} MB")
print("\nself sites:")
for k, v in sites.most_common(top): print(f"{v/1e6:9.1f} MB  {k}")
print("\nnearest repo frame:")
for k, v in repo.most_common(top): print(f"{v/1e6:9.1f} MB  {k}")
print("\nrepo chains:")
for k, v in chains.most_common(top): print(f"{v/1e6:9.1f} MB  {k}")
