#!/usr/bin/env python3
"""
Download Sharpless coordinates from SIMBAD TAP service (batch query).
Much faster than individual queries.
"""

import urllib.request
import urllib.parse
import json
import time

def query_simbad_batch(sh2_numbers):
    """Query multiple SH2 objects at once using SIMBAD TAP."""
    # Create list of identifiers
    ids = ' OR '.join([f"ident='{id}'" for id in sh2_numbers])
    
    # ADQL query
    query = f"""
SELECT oid, main_id, ra, dec
FROM basic
WHERE ({ids})
"""
    
    url = "https://simbad.u-strasbg.fr/simbad/sim-tap/sync"
    data = {
        'request': 'doQuery',
        'lang': 'adql',
        'format': 'json',
        'query': query
    }
    
    try:
        req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode())
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error: {e}")
        return None

# Query in batches of 50 to avoid timeout
all_data = []
batch_size = 50

print("Downloading Sharpless catalog from SIMBAD TAP (313 objects in batches of 50)...\n")

for batch_start in range(1, 314, batch_size):
    batch_end = min(batch_start + batch_size, 314)
    sh2_ids = [f"SH2-{i}" for i in range(batch_start, batch_end)]
    
    print(f"Batch {batch_start}-{batch_end-1}...", end=" ", flush=True)
    result = query_simbad_batch(sh2_ids)
    
    if result and 'data' in result:
        count = len(result['data'])
        print(f"✓ {count} objects")
        for row in result['data']:
            all_data.append({
                'id': row[1],  # main_id
                'ra': row[2],  # ra in degrees
                'dec': row[3]  # dec in degrees
            })
    else:
        print("✗ Failed")
    
    time.sleep(2)  # Rate limit

# Save results
output_file = '/tmp/sharpless_simbad.json'
with open(output_file, 'w') as f:
    json.dump({
        'count': len(all_data),
        'data': sorted(all_data, key=lambda x: int(x['id'].split('-')[1]) if 'SH2-' in x['id'] else 999)
    }, f, indent=2)

print(f"\n✅ Downloaded {len(all_data)}/313 SH2 objects")
print(f"📁 Saved to: {output_file}")
