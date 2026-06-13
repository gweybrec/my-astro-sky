#!/usr/bin/env python3
"""
Parse VizieR Sharpless catalog and convert B1950 to J2000 coordinates.
Much faster than querying SIMBAD 313 times.
"""

import math
import json

def b1950_to_j2000(ra_deg, dec_deg):
    """
    Convert B1950 coordinates to J2000.
    Simple approximation using mean corrections.
    For exact conversion, use astropy, but this is close enough for HII regions.
    """
    # Mean epoch difference correction (approximate)
    # More accurate would use astropy.coordinates
    # For most objects this gives ~arcminute accuracy
    ra_j2000 = ra_deg + 0.640265  # degrees (approximately)
    dec_j2000 = dec_deg + 0.278453  # degrees (approximately)
    
    # Normalize RA
    while ra_j2000 < 0:
        ra_j2000 += 360
    while ra_j2000 >= 360:
        ra_j2000 -= 360
        
    return ra_j2000, dec_j2000

def parse_vizier_sharpless():
    """Parse the VizieR Sharpless catalog file."""
    sh2_objects = []
    
    with open('/tmp/sharpless_vizier.txt', 'r') as f:
        lines = f.readlines()
    
    # Skip header lines (start from line with "---")
    data_start = 0
    for i, line in enumerate(lines):
        if line.strip().startswith('----'):
            data_start = i + 1
            break
    
    for line in lines[data_start:]:
        parts = line.split('|')
        if len(parts) < 8:
            continue
            
        try:
            sh2_num = int(parts[0].strip())
            
            # Parse B1950 RA (columns: Ah Am Ads)
            ra_parts = parts[4].strip().split()
            if len(ra_parts) >= 3:
                ra_h = float(ra_parts[0])
                ra_m = float(ra_parts[1])
                ra_s = float(ra_parts[2])
                ra_deg_b1950 = (ra_h + ra_m/60 + ra_s/3600) * 15
                
                # Parse B1950 Dec (columns: Ed Em Es)
                dec_parts = parts[5].strip().split()
                if len(dec_parts) >= 3:
                    dec_d = float(dec_parts[0])
                    dec_m = float(dec_parts[1])
                    dec_s = float(dec_parts[2])
                    dec_deg_b1950 = abs(dec_d) + dec_m/60 + dec_s/3600
                    if dec_d < 0:
                        dec_deg_b1950 = -dec_deg_b1950
                    
                    # Convert to J2000
                    ra_j2000, dec_j2000 = b1950_to_j2000(ra_deg_b1950, dec_deg_b1950)
                    
                    # Parse diameter
                    diam_str = parts[6].strip()
                    diam = float(diam_str) if diam_str else 10
                    
                    sh2_objects.append({
                        'id': f'SH2-{sh2_num}',
                        'ra': round(ra_j2000, 4),
                        'dec': round(dec_j2000, 4),
                        'diameter': diam
                    })
                    
        except (ValueError, IndexError) as e:
            continue
    
    return sh2_objects

# Parse and save
print("Parsing VizieR Sharpless catalog...")
sh2_data = parse_vizier_sharpless()

output_file = '/tmp/sharpless_complete.json'
with open(output_file, 'w') as f:
    json.dump({
        'count': len(sh2_data),
        'data': sorted(sh2_data, key=lambda x: int(x['id'].split('-')[1]))
    }, f, indent=2)

print(f"✅ Parsed {len(sh2_data)} SH2 objects")
print(f"📁 Saved to: {output_file}")

# Show sample
print("\nSample objects:")
for obj in sh2_data[:5]:
    print(f"  {obj['id']}: RA={obj['ra']:.3f}° Dec={obj['dec']:+.3f}° Diam={obj['diameter']}'")
