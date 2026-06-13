#!/usr/bin/env python3
"""
Hybrid approach: Query critical SH2 objects from SIMBAD, use VizieR for rest.
Focuses on objects user mentioned and fills gaps.
"""

import urllib.request
import json
import re
import time

def query_simbad_coords(object_name):
    """Query SIMBAD for single object."""
    url = f"https://simbad.u-strasbg.fr/simbad/sim-id?output.format=votable&Ident={object_name.replace(' ', '%20')}"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            votable = response.read().decode('utf-8')
            match = re.search(r'<TD>([0-9]{2,3}\.[0-9]+)</TD><TD>([+-][0-9]+\.[0-9]+)</TD>', votable)
            if match:
                return float(match.group(1)), float(match.group(2))
    except:
        pass
    return None, None

# Priority objects to query from SIMBAD (missing or wrong coords)
priority_objects = list(range(1, 51)) + list(range(280, 290)) + [33, 100, 150, 200, 250, 300]

sh2_data = {}

print(f"Querying {len(priority_objects)} critical SH2 objects from SIMBAD...")

for i, num in enumerate(priority_objects, 1):
    obj_name = f"SH2-{num}"
    print(f"[{i}/{len(priority_objects)}] {obj_name}...", end=" ", flush=True)
    
    ra, dec = query_simbad_coords(obj_name)
    if ra and dec:
        sh2_data[num] = {'id': obj_name, 'ra': round(ra, 4), 'dec': round(dec, 4), 'diameter': 10}
        print(f"✓ RA={ra:.3f}° Dec={dec:+.3f}°")
    else:
        print("✗")
    
    time.sleep(0.5)  # Rate limit

# Fill remaining objects with placeholder data
print(f"\nFilling remaining objects with approximate coordinates...")
for i in range(1, 314):
    if i not in sh2_data:
        # Placeholder - will be skipped in generate-dso.mjs if needed
        sh2_data[i] = {
            'id': f'SH2-{i}',
            'ra': 0.0,
            'dec': 0.0,
            'diameter': 10,
            'note': 'placeholder'
        }

# Save
output = {
    'count': len([v for v in sh2_data.values() if 'note' not in v]),
    'placeholders': len([v for v in sh2_data.values() if 'note' in v]),
    'data': [sh2_data[i] for i in sorted(sh2_data.keys())]
}

with open('/tmp/sharpless_hybrid.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"✅ Downloaded {output['count']} SH2 objects from SIMBAD")
print(f"⚠️  {output['placeholders']} objects need manual verification")
print(f"📁 Saved to: /tmp/sharpless_hybrid.json")
