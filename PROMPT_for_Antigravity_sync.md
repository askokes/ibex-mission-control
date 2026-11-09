Open the Mission Control project in Antigravity (the clasp folder you deployed from), then paste everything below the line into its agent.

---

Connect this Apps Script project to the GitHub repo askokes/ibex-mission-control so Mission Control stays in sync with the Claude version. Don't change the board's look or behavior.

1. Clone askokes/ibex-mission-control. Copy this project's current Code.gs, Seed.gs, Index.html and appsscript.json into its apps_script/ folder. Keep the repo's apps_script/Sync.gs. Commit "Current Google board code" and push.
2. From now on, use the repo's apps_script/ folder as the clasp root: put .clasp.json there with this project's scriptId. Push all five files: `clasp push --force`. Sync.gs must upload.
3. Add these to appsscript.json "oauthScopes" if clasp or the editor asks for them, keeping any scopes already there:
   - https://www.googleapis.com/auth/script.external_request
   - https://www.googleapis.com/auth/script.scriptapp
   - https://www.googleapis.com/auth/spreadsheets.currentonly
   - https://www.googleapis.com/auth/userinfo.email
4. Redeploy the same web app deployment as a new version, so the URL doesn't change: `clasp deployments`, then `clasp deploy -i <that deployment id> -d "Sync v1"`.
5. Tell me to do these myself, in the Apps Script editor. Don't do them for me, and never print or store the token anywhere else:
   - Create a fine-grained GitHub token for askokes/ibex-mission-control only, Contents: read and write.
   - In Project Settings, Script properties, add GH_REPO = askokes/ibex-mission-control and GH_TOKEN = the token.
   - Run installSyncTrigger once and approve the permissions.
6. Then confirm state/google.json appears in the repo within a minute, and show me its generatedAt line.
7. If a step fails, show me the exact error and the fix.

From now on, when I ask you to change Mission Control, edit the files in apps_script/, commit and push to the repo, then clasp push and redeploy the same deployment.
