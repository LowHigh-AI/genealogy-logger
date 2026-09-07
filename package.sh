#!/bin/bash
# Helper script to pack the Genealogy Logger Chrome Extension into a clean distributable zip.

cd "$(dirname "$0")"

OUTPUT_ZIP="Genealogy-Logger.zip"

# Remove existing zip if present
rm -f "$OUTPUT_ZIP"

# Create zip with all required assets
zip -r "$OUTPUT_ZIP" \
  manifest.json \
  background.js \
  content \
  icons \
  options \
  google-sheets-script \
  SETUP_GUIDE.html \
  README.md \
  PRIVACY_POLICY.md \
  -x "*.DS_Store*" -x "*.git*" -x "CHROMEWEBSTORE.md" -x "package.sh"

echo "Successfully packaged $OUTPUT_ZIP!"
