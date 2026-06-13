#!/usr/bin/env python3
"""
Fetch ALL SIMBAD cross-identifiers for the 86 Abell Planetary Nebulae.

Useful catalogs found in SIMBAD for these objects:
  PN G NNN.N±NN.N  – IAU PN designation (already partially collected)
  PK NNN±NN N      – Perek-Kohoutek (1967)
  PN ARO NNN       – Abell-Ritter-Ortiz / Strasbourg ESO catalog
  Sh 2-NNN         – Sharpless (for Abell 21 = SH2-274)
  NGC NNNN / IC NNNN – (already handled in generate-dso.mjs)
  2MASS JHHMMSSss±DDMMSSs – skip (positional, not useful)
  IRAS / [...]     – very obscure, skip

Output:
  /tmp/abell_crossrefs.json  –  { "Abell1": ["PN G119.4+06.5", "PK 119+06.1"], ... }

Usage:
  python3 scripts/download-abell-crossrefs.py
"""

import urllib.request
import urllib.parse
import json
import time
import re
import sys

SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"

# Identifier prefixes we want to keep (in addition to PN G which we already have).
# Order doesn't matter here – we'll sort them in the output.
KEEP_PREFIXES = (
    'PN G',    # IAU PN catalog
    'PK ',     # Perek-Kohoutek 1967
    'PN ARO ', # Acker, Raytchev, Ochsenbein (Strasbourg ESO catalog of galactic PNe)
    'Sh 2-',   # Sharpless HII regions (Abell 21 = Sh 2-274)
    'VV',      # Vorontsov-Velyaminov (some LPN cross-ref)
)

def simbad_tap(query):
    data = {
        'request': 'doQuery',
        'lang': 'adql',
        'format': 'json',
        'query': query,
    }
    req = urllib.request.Request(
        SIMBAD_TAP,
        data=urllib.parse.urlencode(data).encode()
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        raw = response.read().decode('utf-8')
    result = json.loads(raw)
    if 'data' not in result:
        print(f"\n  ERROR response: {raw[:500]}", file=sys.stderr)
        raise RuntimeError("SIMBAD returned no 'data' field")
    return result


# ── Step 1: Get ALL identifiers for every PN A66 object in one query ──────────
print("Querying SIMBAD for ALL cross-identifiers of PN A66 objects...")

query = """
SELECT a66.id AS abell_id, other.id AS cross_id
FROM ident a66
JOIN ident other ON other.oidref = a66.oidref
WHERE a66.id LIKE 'PN A66 %'
ORDER BY 1, 2
"""

result = simbad_tap(query)
rows = result.get('data', [])
print(f"✓ {len(rows)} total rows returned")

# ── Step 2: Group by Abell number ─────────────────────────────────────────────
raw_by_num = {}
for abell_id, cross_id in rows:
    abell_id = abell_id.strip()
    cross_id = cross_id.strip()
    m = re.search(r'\d+$', abell_id)
    if not m:
        continue
    num = int(m.group())
    raw_by_num.setdefault(num, set()).add(cross_id)

print(f"✓ {len(raw_by_num)} distinct Abell PN objects found")

# ── Step 3: Filter to useful catalog prefixes ─────────────────────────────────
# Build a mapping: AbellN -> [sorted list of useful cross-IDs]
crossrefs = {}
all_prefixes = {}  # census of all identifier prefixes seen

for num, ids in sorted(raw_by_num.items()):
    kept = []
    for cid in sorted(ids):
        # Count prefix
        prefix = re.match(r'[A-Z\[\]a-z]+', cid)
        if prefix:
            p = prefix.group()
            all_prefixes[p] = all_prefixes.get(p, 0) + 1

        # Keep if starts with a desired prefix
        if any(cid.startswith(pfx) for pfx in KEEP_PREFIXES):
            kept.append(cid)

    crossrefs[f'Abell{num}'] = sorted(kept)

# ── Step 4: Print census of identifier types seen ─────────────────────────────
print("\nAll identifier type prefixes seen (count = # Abell objects with that prefix):")
for p, c in sorted(all_prefixes.items(), key=lambda x: -x[1]):
    if c >= 2:
        print(f"  {p!r:30s} {c}")

# ── Step 5: Print the filtered cross-refs ─────────────────────────────────────
print(f"\nFiltered cross-refs (keeping {', '.join(KEEP_PREFIXES)}):")
total_kept = 0
for key, ids in crossrefs.items():
    if ids:
        print(f"  {key:10s}: {ids}")
        total_kept += len(ids)
    else:
        print(f"  {key:10s}: (none after filtering)")
print(f"\nTotal cross-ref IDs kept: {total_kept}")

# ── Step 6: Check coverage ────────────────────────────────────────────────────
print(f"\nPK coverage:  {sum(1 for v in crossrefs.values() if any('PK ' in x for x in v))}/86 objects")
print(f"ARO coverage: {sum(1 for v in crossrefs.values() if any('PN ARO' in x for x in v))}/86 objects")
print(f"PN G coverage:{sum(1 for v in crossrefs.values() if any('PN G' in x for x in v))}/86 objects")

# ── Step 7: Save ──────────────────────────────────────────────────────────────
output_file = '/tmp/abell_crossrefs.json'
with open(output_file, 'w') as f:
    json.dump(crossrefs, f, indent=2)

print(f"\n📁 Saved to {output_file}")
