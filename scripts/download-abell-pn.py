#!/usr/bin/env python3
"""
Download Abell Planetary Nebula catalog coordinates from SIMBAD TAP service.

The Abell (1966) catalog has 86 planetary nebulae (numbered 1–86).
SIMBAD identifier format: "PN A66 N" (e.g., "PN A66 7").

NOT to be confused with the Abell catalog of galaxy clusters (ACO / Abell 1958).

Output: /tmp/abell_pn_simbad.json
"""

import urllib.request
import urllib.parse
import json
import time


def simbad_tap(query):
    url = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
    data = {
        'request': 'doQuery',
        'lang': 'adql',
        'format': 'json',
        'query': query,
    }
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode())
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode('utf-8'))


# ── Step 1: fetch all objects identified as "PN A66 N" ──────────────────────
print("Querying SIMBAD TAP for all PN A66 % identifiers...", end=" ", flush=True)

query_main = """
SELECT i.id, b.main_id, b.ra, b.dec, b.otype,
       b.galdim_majaxis, b.galdim_minaxis, b.galdim_angle
FROM basic b JOIN ident i ON i.oidref = b.oid
WHERE i.id LIKE 'PN A66 %'
ORDER BY id
"""

result = simbad_tap(query_main)
rows = result.get('data', [])
print(f"✓ {len(rows)} rows")

# Parse into dict keyed by Abell number
abell = {}
for row in rows:
    pn_a66_id, main_id, ra, dec, otype, maj, minax, pa = row
    try:
        num = int(pn_a66_id.strip().split()[-1])
    except ValueError:
        print(f"  WARNING: could not parse number from '{pn_a66_id}'")
        continue
    abell[num] = {
        'num': num,
        'abell_id': f'Abell{num}',
        'main_id': main_id,
        'ra': ra,
        'dec': dec,
        'otype': otype,
        'maj_arcmin': maj,   # arcminutes (SIMBAD galdim_majaxis unit)
        'min_arcmin': minax,
        'pa': pa,
        'mag_V': None,
    }

# ── Step 2: fetch V magnitudes ────────────────────────────────────────────────
print("Querying V magnitudes...", end=" ", flush=True)
time.sleep(2)

query_mag = """
SELECT i.id, f.flux
FROM ident i
JOIN flux f ON f.oidref = i.oidref AND f.filter = 'V'
WHERE i.id LIKE 'PN A66 %'
ORDER BY id
"""

try:
    mag_result = simbad_tap(query_mag)
    for row in mag_result.get('data', []):
        pn_a66_id, flux = row
        try:
            num = int(pn_a66_id.strip().split()[-1])
            if num in abell:
                abell[num]['mag_V'] = flux
        except ValueError:
            pass
    print(f"✓ {len(mag_result.get('data', []))} magnitudes")
except Exception as e:
    print(f"✗ {e}")

# ── Step 3: fetch PN G identifiers (needed for cross-refs) ────────────────────
print("Querying PN G cross-references...", end=" ", flush=True)
time.sleep(2)

query_png = """
SELECT i_a66.id AS a66_id, i_png.id AS png_id
FROM ident i_a66
JOIN ident i_png ON i_png.oidref = i_a66.oidref
WHERE i_a66.id LIKE 'PN A66 %'
  AND i_png.id LIKE 'PN G%'
ORDER BY 1
"""

try:
    png_result = simbad_tap(query_png)
    for row in png_result.get('data', []):
        a66_id, png_id = row
        try:
            num = int(a66_id.strip().split()[-1])
            if num in abell:
                abell[num]['png_id'] = png_id
        except ValueError:
            pass
    print(f"✓ {len(png_result.get('data', []))} PN G cross-refs")
except Exception as e:
    print(f"✗ {e}")

# ── Step 4: also fetch NGC/IC identifiers (for already-catalogued objects) ────
print("Querying NGC/IC cross-references...", end=" ", flush=True)
time.sleep(2)

query_ngcic = """
SELECT i_a66.id AS a66_id, i_ngcic.id AS ngcic_id
FROM ident i_a66
JOIN ident i_ngcic ON i_ngcic.oidref = i_a66.oidref
WHERE i_a66.id LIKE 'PN A66 %'
  AND (i_ngcic.id LIKE 'NGC %' OR i_ngcic.id LIKE 'IC %')
ORDER BY 1
"""

try:
    ngcic_result = simbad_tap(query_ngcic)
    for row in ngcic_result.get('data', []):
        a66_id, ngcic_id = row
        try:
            num = int(a66_id.strip().split()[-1])
            if num in abell:
                abell[num].setdefault('ngcic_ids', []).append(ngcic_id)
        except ValueError:
            pass
    print(f"✓ {len(ngcic_result.get('data', []))} NGC/IC cross-refs")
except Exception as e:
    print(f"✗ {e}")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n✅ Retrieved {len(abell)}/86 Abell PN objects from SIMBAD")

print("\nObjects excluded by dec < -35 cutoff:")
excluded = [obj for obj in abell.values() if obj['dec'] is not None and obj['dec'] < -35]
for obj in sorted(excluded, key=lambda x: x['num']):
    print(f"  Abell {obj['num']:2d}: RA={obj['ra']:.3f}° Dec={obj['dec']:.3f}° otype={obj['otype']}")

print(f"\nObject types (all {len(abell)}):")
types = {}
for obj in abell.values():
    t = obj.get('otype', '?')
    types[t] = types.get(t, 0) + 1
for t, count in sorted(types.items(), key=lambda x: -x[1]):
    print(f"  {t}: {count}")

print(f"\nObjects with NGC/IC cross-ref:")
for num, obj in sorted(abell.items()):
    if obj.get('ngcic_ids'):
        print(f"  Abell {num:2d}: {', '.join(obj['ngcic_ids'])}")

print(f"\nObjects missing PN G cross-ref:")
for num, obj in sorted(abell.items()):
    if not obj.get('png_id'):
        print(f"  Abell {num:2d}: main_id={obj['main_id']}")

# ── Save ──────────────────────────────────────────────────────────────────────
output = {
    'note': 'Abell 1966 planetary nebulae downloaded from SIMBAD TAP. maj/min in arcminutes.',
    'count': len(abell),
    'data': [abell[k] for k in sorted(abell.keys())],
}

output_file = '/tmp/abell_pn_simbad.json'
with open(output_file, 'w') as f:
    json.dump(output, f, indent=2)

print(f"\n📁 Saved to: {output_file}")
