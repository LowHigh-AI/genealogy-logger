# One-command deploys with clasp

Replaces the Deploy → Manage deployments → pencil → New version → Deploy click-through
with `./deploy.sh` from the repo root.

## One-time setup

1. **Enable the Apps Script API** for your Google account (clasp cannot work without it):
   <https://script.google.com/home/usersettings> → turn **Google Apps Script API** on.

2. **Log in** (opens a browser once):
   ```bash
   npx --yes @google/clasp@latest login
   ```
   Credentials are written to `~/.clasprc.json`, outside this repo.

3. **Link this folder to your script.** Get the Script ID from the Apps Script editor:
   **Project Settings (⚙) → IDs → Script ID**, then from the repo root:
   ```bash
   cd google-sheets-script
   npx --yes @google/clasp@latest clone <SCRIPT_ID>
   ```
   If clone complains the directory isn't empty, keep your local `Code.gs` and
   `appsscript.json` — they are the source of truth; overwrite whatever it pulls down.

4. **Record the deployment id** so deploys reuse the existing URL:
   ```bash
   echo "AKfy...your-deployment-id" > google-sheets-script/.clasp-deployment
   ```
   It is the `AKfy…` portion of your web app URL. This file is gitignored, because
   together with the API key it grants write access to your sheet and Drive.

## Every time after that

```bash
./deploy.sh                  # or: ./deploy.sh "what changed"
```

Push and deploy in one step, same URL.

## Notes

- `clasp push` uploads **everything** in this folder, so keep it to `Code.gs` and
  `appsscript.json`. That is why this file is documentation-only and harmless.
- Running a function in the editor (`forceAuth`, `listGeminiModels`) always uses the
  latest *saved* code and needs no deploy. Only the `/exec` web app needs a version.
