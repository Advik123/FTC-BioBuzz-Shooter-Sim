"""Extract world-space bounding boxes and vertex clouds from the official
BIOBUZZ field STEP export (ftc-resources.firstinspires.org/ftc/field/field-cad-step).

Usage:
    python tools/step_extract.py path/to/field-cad-step.step [name-filter ...]

Prints one line per part occurrence: path, world bbox (inches, Onshape axes).
With --dump NAME it writes the world-space B-rep vertices of every occurrence
whose path contains NAME to stdout as JSON (inches).

Only VERTEX_POINT and tessellated coordinates contribute to bounding boxes, so
surface placement origins do not inflate them. No third-party packages needed.
"""
import json
import re
import sys
from collections import defaultdict

M_TO_IN = 1 / 0.0254


def load(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    data = text[text.index("DATA;") + 5:text.rindex("ENDSEC;")]
    ents = {}
    for m in re.finditer(r"#(\d+)\s*=\s*(.*?);\s*(?=#\d+\s*=|$)", data, re.S):
        ents[int(m.group(1))] = " ".join(m.group(2).split())
    return ents


def etype(raw):
    if raw.startswith("("):
        return "COMPLEX"
    return raw[: raw.index("(")].strip()


def refs(raw):
    return [int(r) for r in re.findall(r"#(\d+)", strip_strings(raw))]


def strip_strings(raw):
    return re.sub(r"'(?:[^']|'')*'", "''", raw)


class Step:
    def __init__(self, path):
        self.e = load(path)
        self.t = {k: etype(v) for k, v in self.e.items()}
        self.by_type = defaultdict(list)
        for k, ty in self.t.items():
            self.by_type[ty].append(k)
        self.unit = self._length_unit()
        self._bbox = {}

    def _length_unit(self):
        for k, v in self.e.items():
            if "LENGTH_UNIT" in v and "SI_UNIT" in v:
                if ".MILLI." in v:
                    return 0.001
                return 1.0
        return 1.0

    def point(self, pid):
        nums = re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", self.e[pid].split("(", 1)[1].split("(", 1)[1])
        return [float(n) * self.unit for n in nums[:3]]

    def leaf_points(self, eid):
        ty = self.t.get(eid)
        if ty == "VERTEX_POINT":
            return [self.point(refs(self.e[eid])[0])]
        if ty == "COORDINATES_LIST":
            body = self.e[eid].split("(", 1)[1]
            body = body[body.index("((") + 2:]
            pts = []
            for tri in re.findall(r"\(([^()]*)\)", "(" + body):
                nums = [float(x) for x in tri.split(",") if x.strip()]
                if len(nums) == 3:
                    pts.append([n * self.unit for n in nums])
            return pts
        return None

    def gather(self, root, skip_types=("AXIS2_PLACEMENT_3D",)):
        """All leaf points reachable from root (iterative DFS)."""
        seen, out, stack = set(), [], [root]
        while stack:
            n = stack.pop()
            if n in seen or n not in self.e:
                continue
            seen.add(n)
            lp = self.leaf_points(n)
            if lp is not None:
                out.extend(lp)
                continue
            ty = self.t[n]
            if ty in ("CARTESIAN_POINT", "DIRECTION", "VECTOR") or ty.endswith("_CONTEXT") or ty == "COMPLEX" and n != root and "REPRESENTATION_CONTEXT" in self.e[n]:
                continue
            if n != root and ty in skip_types:
                continue
            stack.extend(refs(strip_strings(self.e[n])))
        return out

    def axis(self, aid):
        r = refs(self.e[aid])
        loc = self.point(r[0])
        def d(i):
            if i < len(r):
                nums = re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", self.e[r[i]].split("(", 2)[2])
                return [float(x) for x in nums[:3]]
            return None
        z = d(1) or [0, 0, 1]
        x = d(2) or [1, 0, 0]
        z = norm(z)
        x = norm(sub(x, scale(z, dot(x, z))))
        y = cross(z, x)
        return mat(x, y, z, loc)


def norm(v):
    l = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5
    return [c / l for c in v]


def dot(a, b):
    return sum(i * j for i, j in zip(a, b))


def sub(a, b):
    return [i - j for i, j in zip(a, b)]


def scale(a, s):
    return [i * s for i in a]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def mat(x, y, z, t):
    return [[x[0], y[0], z[0], t[0]], [x[1], y[1], z[1], t[1]], [x[2], y[2], z[2], t[2]], [0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def inv(m):
    r = [[m[j][i] for j in range(3)] for i in range(3)]
    t = [-sum(r[i][k] * m[k][3] for k in range(3)) for i in range(3)]
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0, 0, 0, 1]]


def apply(m, p):
    return [m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3)]


IDENT = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def build(s):
    name_of_pd = {}
    for f in s.by_type["PRODUCT_DEFINITION"]:
        form = refs(s.e[f])[0]
        prod = refs(s.e[form])[0]
        m = re.match(r"PRODUCT\s*\(\s*'((?:[^']|'')*)'", s.e[prod])
        name_of_pd[f] = m.group(1) if m else s.e[prod][:60]

    pds_target = {k: refs(s.e[k])[0] for k in s.by_type["PRODUCT_DEFINITION_SHAPE"]}
    rep_of_pd = {}
    for k in s.by_type["SHAPE_DEFINITION_REPRESENTATION"]:
        pds, rep = refs(s.e[k])[:2]
        rep_of_pd[pds_target[pds]] = rep

    # Non-transforming rep links (shape rep -> brep rep)
    rep_links = defaultdict(set)
    for k in s.by_type["SHAPE_REPRESENTATION_RELATIONSHIP"]:
        a, b = refs(s.e[k])[:2]
        rep_links[a].add(b)
        rep_links[b].add(a)

    def rep_items(rep):
        return set(refs(strip_strings(s.e[rep])))

    children = defaultdict(list)
    is_child = set()
    for k in s.by_type["CONTEXT_DEPENDENT_SHAPE_REPRESENTATION"]:
        rr, pds = refs(s.e[k])[:2]
        nauo = pds_target[pds]
        r = refs(s.e[nauo])
        parent_pd, child_pd = r[0], r[1]
        raw = s.e[rr]
        m = re.search(r"REPRESENTATION_RELATIONSHIP\('[^']*','[^']*',#(\d+),#(\d+)\)", raw)
        rep1, rep2 = int(m.group(1)), int(m.group(2))
        idt = int(re.search(r"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\(#(\d+)\)", raw).group(1))
        i1, i2 = refs(s.e[idt])[:2]
        child_rep = rep_of_pd.get(child_pd)
        # Determine which placement lives in the child's rep.
        if child_rep in (rep1,) or i1 in rep_items(rep1) and rep1 == child_rep:
            ci, pi = (i1, i2) if i1 in rep_items(rep1) else (i2, i1)
        else:
            ci, pi = (i2, i1) if i2 in rep_items(rep2) else (i1, i2)
        T = mul(s.axis(pi), inv(s.axis(ci)))
        children[parent_pd].append((child_pd, T, name_of_pd.get(child_pd, "?")))
        is_child.add(child_pd)

    roots = [p for p in name_of_pd if p not in is_child and p in children]
    return name_of_pd, rep_of_pd, rep_links, children, roots


def geometry_points(s, rep, rep_links, cache):
    if rep in cache:
        return cache[rep]
    reps, stack = set(), [rep]
    while stack:
        r = stack.pop()
        if r in reps:
            continue
        reps.add(r)
        stack.extend(rep_links.get(r, ()))
    pts = []
    for r in reps:
        pts.extend(s.gather(r))
    cache[rep] = pts
    return pts


def walk(s, built, visit):
    name_of_pd, rep_of_pd, rep_links, children, roots = built
    cache = {}
    def rec(pd, T, path):
        kids = children.get(pd, [])
        rep = rep_of_pd.get(pd)
        if rep is not None:
            pts = geometry_points(s, rep, rep_links, cache)
            if pts:
                visit(path, [apply(T, p) for p in pts])
        for child, Tc, nm in kids:
            rec(child, mul(T, Tc), path + [nm])
    for r in roots:
        rec(r, IDENT, [name_of_pd[r]])


def main():
    args = sys.argv[1:]
    path = args[0]
    dump = None
    if "--dump" in args:
        dump = args[args.index("--dump") + 1]
    out = args[args.index("--out") + 1] if "--out" in args else None
    filters = [a for a in args[1:] if a not in ("--dump", "--out", dump, out)]
    s = Step(path)
    built = build(s)
    dumped = []

    def visit(p, pts):
        full = " / ".join(p)
        pin = [[c * M_TO_IN for c in q] for q in pts]
        if dump:
            if dump in full:
                dumped.append({"path": full, "pts": [[round(c, 3) for c in q] for q in pin]})
            return
        if filters and not any(f in full for f in filters):
            return
        lo = [min(q[i] for q in pin) for i in range(3)]
        hi = [max(q[i] for q in pin) for i in range(3)]
        print(f"{full}\n    min=({lo[0]:.2f},{lo[1]:.2f},{lo[2]:.2f}) max=({hi[0]:.2f},{hi[1]:.2f},{hi[2]:.2f}) n={len(pin)}")

    walk(s, built, visit)
    if dump:
        if "--out" in args:
            with open(args[args.index("--out") + 1], "w", encoding="utf-8") as fh:
                json.dump(dumped, fh)
        else:
            json.dump(dumped, sys.stdout)


if __name__ == "__main__":
    main()
