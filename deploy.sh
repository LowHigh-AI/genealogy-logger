#!/bin/bash
# Push the Apps Script source and publish a NEW VERSION of the existing deployment.
#
# The point of `clasp deploy -i <id>` is that it updates the deployment in place, so the
# web app URL stays the same and nothing has to be re-pasted into the extension's
# Settings. Omitting -i creates a brand new deployment with a new URL — the trap that
# the Google UI's "New deployment" button falls into.
#
#   ./deploy.sh                   # version labelled with the current date
#   ./deploy.sh "retry on 503"    # version with your own label
#
# One-time setup lives in google-sheets-script/CLASP_SETUP.md.

set -euo pipefail
cd "$(dirname "$0")/google-sheets-script"

CLASP="npx --yes @google/clasp@latest"

if [ ! -f .clasp.json ]; then
  echo "✗ No .clasp.json here. Run the one-time setup first:" >&2
  echo "  see google-sheets-script/CLASP_SETUP.md" >&2
  exit 1
fi

# The deployment id is half of the webhook's credentials, so it stays out of git.
if [ -n "${GAS_DEPLOYMENT_ID:-}" ]; then
  DEPLOY_ID="$GAS_DEPLOYMENT_ID"
elif [ -f .clasp-deployment ]; then
  DEPLOY_ID="$(tr -d '[:space:]' < .clasp-deployment)"
else
  echo "✗ No deployment id found." >&2
  echo "  Put it in google-sheets-script/.clasp-deployment, or set GAS_DEPLOYMENT_ID." >&2
  echo "  It is the AKfy... portion of your web app URL." >&2
  exit 1
fi

LABEL="${1:-Update $(date '+%Y-%m-%d %H:%M')}"

echo "→ Pushing source…"
$CLASP push -f

echo "→ Deploying new version to ${DEPLOY_ID:0:12}…"
$CLASP deploy -i "$DEPLOY_ID" -d "$LABEL"

WEBHOOK_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"

echo
echo "✓ Live. Webhook URL (unchanged — deploying in place never rotates it):"
echo "  $WEBHOOK_URL"
echo
echo "  Only paste this into Settings if the field is empty or shows a different id."
