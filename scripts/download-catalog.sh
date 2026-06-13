#!/bin/bash
# Download deep star catalog for plate solving
# Usage: bash scripts/download-catalog.sh [magnitude]
# magnitude: 6 (default UI), 8 (default plate solving), 14 (sparse fields)

MAG=${1:-14}
OUTPUT_DIR="public/data"
CATALOG_FILE="$OUTPUT_DIR/stars.${MAG}.json"
BASE_URL="https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data"

# Catalog size estimates
case $MAG in
  6) SIZE="~5k stars, 641KB" ;;
  8) SIZE="~41k stars, 5.4MB" ;;
  14) SIZE="~118k stars, 14.7MB" ;;
  *) echo "Error: magnitude must be 6, 8, or 14"; exit 1 ;;
esac

echo "Downloading stars.${MAG}.json catalog ($SIZE)..."
echo "This catalog will be used for plate solving WCS transformations."
echo ""

mkdir -p "$OUTPUT_DIR"

if [ -f "$CATALOG_FILE" ]; then
  echo "✓ $CATALOG_FILE already exists"
  read -p "Overwrite? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Skipping download"
    exit 0
  fi
fi

echo "Downloading from: $BASE_URL/stars.${MAG}.json"
if curl -f -L -o "$CATALOG_FILE" "$BASE_URL/stars.${MAG}.json"; then
  echo ""
  echo "✓ Catalog downloaded to $CATALOG_FILE"

  # Update STAR_CATALOG_PATH in .env (create the file if it doesn't exist)
  ENV_FILE=".env"
  if [ -f "$ENV_FILE" ] && grep -q "^STAR_CATALOG_PATH=" "$ENV_FILE"; then
    sed -i "s|^STAR_CATALOG_PATH=.*|STAR_CATALOG_PATH=public/data/stars.${MAG}.json|" "$ENV_FILE"
  else
    echo "STAR_CATALOG_PATH=public/data/stars.${MAG}.json" >> "$ENV_FILE"
  fi
  echo "✓ STAR_CATALOG_PATH set to public/data/stars.${MAG}.json in .env"
  echo ""
  echo "Catalog info:"
  echo "  - Magnitude limit: $MAG"
  echo "  - Size: $SIZE"
  echo "  - Use mag 8 (default) for most images"
  echo "  - Use mag 14 for sparse star fields (galaxies, high declination)"
else
  echo ""
  echo "✗ Failed to download catalog"
  echo "Available catalogs: 6, 8, 14"
  echo "Check your internet connection or try again later"
  exit 1
fi

