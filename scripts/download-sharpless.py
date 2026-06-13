#!/usr/bin/env python3
"""
Download complete Sharpless (SH2) catalog coordinates from SIMBAD.
All 313 objects with J2000 coordinates.
"""

import urllib.request
import urllib.parse
import time
import json
import re

def query_simbad_votable(object_name):
    """Query SIMBAD for object coordinates in VOTable format."""
    url = f"https://simbad.u-strasbg.fr/simbad/sim-id?output.format=votable&Ident={urllib.parse.quote(object_name)}"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"  Error querying {object_name}: {e}")
        return None

def parse_coordinates(votable_text):
    """Extract RA and Dec from VOTable XML."""
    # Look for the data row with coordinates
    match = re.search(r'<TD>([0-9]{2,3}\.[0-9]+)</TD><TD>([+-][0-9]+\.[0-9]+)</TD>', votable_text)
    if match:
        ra = float(match.group(1))
        dec = float(match.group(2))
        return ra, dec
    return None, None

# Download all SH2 objects
sh2_data = []
errors = []

print("Downloading Sharpless catalog from SIMBAD (313 objects)...")
print("This will take ~5-10 minutes with 1 second delay between queries.\n")

for i in range(1, 314):
    object_name = f"SH2-{i}"
    print(f"[{i}/313] Querying {object_name}...", end=" ", flush=True)
    
    votable = query_simbad_votable(object_name)
    
    if votable:
        ra, dec = parse_coordinates(votable)
        if ra is not None and dec is not None:
            sh2_data.append({
                'id': object_name,
                'ra': ra,
                'dec': dec
            })
            print(f"✓ RA={ra:.3f}° Dec={dec:+.3f}°")
        else:
            print(f"✗ Not found in SIMBAD")
            errors.append(object_name)
    else:
        print(f"✗ Query failed")
        errors.append(object_name)
    
    # Rate limit: 1 query per second to be respectful to SIMBAD
    time.sleep(1)

# Save results
output_file = '/tmp/sharpless_complete.json'
with open(output_file, 'w') as f:
    json.dump({
        'count': len(sh2_data),
        'errors': errors,
        'data': sh2_data
    }, f, indent=2)

print(f"\n✅ Downloaded {len(sh2_data)}/313 SH2 objects")
print(f"❌ Failed: {len(errors)} objects: {errors[:10]}{'...' if len(errors) > 10 else ''}")
print(f"📁 Saved to: {output_file}")
