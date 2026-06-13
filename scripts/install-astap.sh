#!/bin/bash
set -e

ASTAP_DIR=/opt/astap
mkdir -p "$ASTAP_DIR"

# Linux 64-bit CLI binary (~315 KB, no GUI)
echo "Downloading ASTAP CLI binary..."
wget -q --show-progress -L \
  -O /tmp/astap_cli.zip \
  "https://sourceforge.net/projects/astap-program/files/linux_installer/astap_command-line_version_Linux_amd64.zip/download"
unzip -o /tmp/astap_cli.zip -d "$ASTAP_DIR"
chmod +x "$ASTAP_DIR"/astap_cli
rm /tmp/astap_cli.zip

# D50 star catalog (~900 MB, ~5000 stars/deg², best for images with few stars)
# Alternatives: d05_star_database.zip (~102 MB) or d20_star_database.zip (~400 MB)
echo "Downloading D50 star catalog..."
wget -q --show-progress -L \
  -O /tmp/d50.zip \
  "https://sourceforge.net/projects/astap-program/files/star_databases/d50_star_database.zip/download"
unzip -o /tmp/d50.zip -d "$ASTAP_DIR"
rm /tmp/d50.zip

echo ""
echo "Installation complete in $ASTAP_DIR"
echo "In the app Settings, set the ASTAP path to: $ASTAP_DIR/astap_cli"
