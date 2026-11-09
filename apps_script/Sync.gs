/**
 * ibex Marketing Mission Control: two-way sync with the Claude board, through a GitHub repo.
 *
 * Every 5 minutes (installSyncTrigger):
 *   1. Reads state/claude.json from the repo. If it is a new export, merges each changed
 *      document into the State tab with a three-way merge (base = the version both sides
 *      last agreed on). When both sides changed the same field, the Google value wins.
 *   2. Writes a full snapshot of the State tab to state/google.json, so Claude can import it.
 *
 * Script Properties (Project Settings > Script properties), set by a person, never in code:
 *   GH_REPO   owner/name of the repo, e.g. askokes/ibex-mission-control
 *   GH_TOKEN  a fine-grained GitHub token for that one repo, Contents: read and write
 *   GH_BRANCH optional, default "main"
 *
 * Private per-person notes (data/users/...) never leave the Sheet.
 */

const SYNC_SKIP_PREFIX = 'data/users/';

function ghConf_() {
  const p = PropertiesService.getScriptProperties();
  const repo = p.getProperty('GH_REPO'), token = p.getProperty('GH_TOKEN');
  if (!repo || !token) throw new Error('Set GH_REPO and GH_TOKEN in Script properties first.');
  return { repo: repo, token: token, branch: p.getProperty('GH_BRANCH') || 'main' };
}

function ghFetch_(method, path, body) {
  const c = ghConf_();
  const url = 'https://api.github.com/repos/' + c.repo + '/contents/' + path +
    (method === 'GET' ? '?ref=' + encodeURIComponent(c.branch) : '');
  const opt = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' }
  };
  if (body) opt.payload = JSON.stringify(Object.assign({ branch: c.branch }, body));
  const res = UrlFetchApp.fetch(url, opt);
  return { code: res.getResponseCode(), json: res.getContentText() ? JSON.parse(res.getContentText()) : null };
}

/** Returns {data, sha} or null when the file does not exist. */
function ghGet_(path) {
  const r = ghFetch_('GET', path);
  if (r.code === 404) return null;
  if (r.code !== 200) throw new Error('GitHub read failed (' + r.code + ') for ' + path);
  const text = Utilities.newBlob(Utilities.base64Decode(r.json.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return { data: JSON.parse(text), sha: r.json.sha };
}

function ghPut_(path, obj, sha, message) {
  const content = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(obj, null, 1)).getBytes());
  const body = { message: message, content: content };
  if (sha) body.sha = sha;
  const r = ghFetch_('PUT', path, body);
  if (r.code !== 200 && r.code !== 201) throw new Error('GitHub write failed (' + r.code + ') for ' + path);
}

function isObj_(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function same_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** Three-way merge. ours = Google (wins a true conflict), theirs = Claude. undefined = absent. */
function merge3_(base, ours, theirs) {
  if (same_(theirs, base)) return ours;
  if (same_(ours, base)) return theirs;
  if (isObj_(ours) && isObj_(theirs)) {
    const b = isObj_(base) ? base : {};
    const out = {};
    const keys = {};
    [b, ours, theirs].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      const v = merge3_(b[k], ours[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return ours;
}

function syncWithGitHub() {
  withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    const lastDone = props.getProperty('SYNC_LAST_CLAUDE_EXPORT') || '';
    const all = readAll_();
    const docs = {};
    Object.keys(all).forEach(function (p) { try { docs[p] = JSON.parse(all[p].json); } catch (e) {} });

    // 1. Apply a new Claude export.
    const cl = ghGet_('state/claude.json');
    let merged = 0;
    if (cl && cl.data && cl.data.exportedAt && cl.data.exportedAt !== lastDone) {
      const ex = cl.data.docs || {};
      Object.keys(ex).forEach(function (p) {
        if (p.indexOf(SYNC_SKIP_PREFIX) === 0) return;
        const e = ex[p];
        if (e.data === null || e.data === undefined) return; // deletes are not synced
        const base = e.base === null ? undefined : e.base;
        const next = merge3_(base, docs[p], e.data);
        if (next !== undefined && !same_(next, docs[p])) {
          writeAs_(p, next, 'claude-sync');
          docs[p] = next;
          merged++;
        }
      });
      props.setProperty('SYNC_LAST_CLAUDE_EXPORT', cl.data.exportedAt);
    }

    // 2. Publish the Google snapshot when anything changed.
    const snap = {};
    Object.keys(docs).sort().forEach(function (p) { if (p.indexOf(SYNC_SKIP_PREFIX) !== 0) snap[p] = docs[p]; });
    const processed = props.getProperty('SYNC_LAST_CLAUDE_EXPORT') || '';
    const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(snap) + processed));
    if (hash !== props.getProperty('SYNC_LAST_PUSH_HASH')) {
      const cur = ghGet_('state/google.json');
      ghPut_('state/google.json',
        { generatedAt: new Date().toISOString(), processedClaudeExport: processed, docs: snap },
        cur ? cur.sha : null,
        'Google snapshot' + (merged ? ' (merged ' + merged + ' from Claude)' : ''));
      props.setProperty('SYNC_LAST_PUSH_HASH', hash);
    }
  });
}

/** Same as write_ in Code.gs, but records who made the change. */
function writeAs_(path, obj, by) {
  const json = JSON.stringify(obj);
  if (json.length > MAX_CELL) throw new Error('Document too large for one cell: ' + path);
  const sh = stateSheet_();
  const all = readAll_();
  const vals = [[path, json, new Date().toISOString(), by]];
  if (all[path]) sh.getRange(all[path].row, 1, 1, 4).setValues(vals);
  else sh.appendRow(vals[0]);
}

/** Run once from the editor. Runs the sync every 5 minutes. */
function installSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncWithGitHub') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncWithGitHub').timeBased().everyMinutes(5).create();
  syncWithGitHub();
}
