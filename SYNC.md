# How Mission Control stays in sync

There are two live copies of the board.

- **The Claude board** (claude.ai artifact). Claude edits it directly.
- **The Google board** (Apps Script web app with a Google Sheet). The team and Antigravity edit it.

This repo sits between them.

| File | Written by | Holds |
|---|---|---|
| `apps_script/*` | Antigravity or Claude | The Google board's code. Antigravity deploys it with clasp. |
| `state/google.json` | Google, every 5 minutes | A full snapshot of the Google board's data |
| `state/claude.json` | Claude, every hour | Only the documents Claude changed, each with the version both sides last agreed on |
| `state/claude_sync.json` | Claude | Claude's record of what both sides last agreed on |

## The cycle

1. Every 5 minutes, Google reads `state/claude.json`. If it's a new export, Google merges each document into the State tab and then publishes `state/google.json`.
2. Every hour, a scheduled Claude session imports `state/google.json` into the Claude board, then exports Claude's own changes to `state/claude.json`.
3. A change made on one side shows on the other within about an hour.

## Conflicts

- **Different items, both sides:** the merge works field by field, so both changes are kept. For example, a tick on one side and a moved date on the other.
- **The same item, both sides, before a sync:** Google's value wins. Google is where the team works live.
- **Never synced:** private Team notes (`data/users/...`) stay on the side where they were written. Deleting a whole document doesn't sync either; clearing its contents does.

## Code changes

- Change code in this repo, whether in Antigravity or Claude.
- Antigravity deploys with `clasp push` and a new version of the same deployment, so the URL stays the same.
- A change to the Claude board's page that should also reach Google goes in `apps_script/Index.html` as well. The board code sits under the adapter block at the top of that file.

## Security

- The GitHub token lives only in the Apps Script's Script properties. It's a fine-grained token for this one repo, with Contents set to read and write.
- The repo is private. It holds budget, personnel and pipeline names, so keep it private, and move it to an ibex-owned GitHub account if IT asks.
