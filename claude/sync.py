#!/usr/bin/env python3
"""Claude side of the Mission Control two-way sync.

Two steps, run from the repo root:

  python3 claude/sync.py plan  <dump_dir> <versions.json>
      Reads the Claude board's documents (dumped by ArtifactData into <dump_dir>/<collection>/<doc>.json),
      their versions (path -> version), state/google.json and state/claude_sync.json.
      Writes claude/out/writes.json: the batch of Claude database writes that import Google's changes.

  python3 claude/sync.py finish <dump_dir> <versions.json> <written_versions.json>
      After the writes are applied (written_versions.json = path -> new version, {} if none),
      writes state/claude.json (Claude's local changes for Google to merge) and updates
      state/claude_sync.json (what both sides last agreed on).

Rules
  - A document Claude has not changed since the last sync takes Google's version.
  - A document Claude has changed is exported with its base, and Google merges it.
    Claude imports the merged result on the next run, once Google confirms it processed the export.
  - Private notes (data/users/...) are never synced.
"""
import hashlib, json, os, sys
from datetime import datetime, timezone

SKIP = 'data/users/'
SYNC_FILE = 'state/claude_sync.json'
GOOGLE_FILE = 'state/google.json'
EXPORT_FILE = 'state/claude.json'
OUT = 'claude/out'


def h(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def dump_docs(dump_dir):
    docs = {}
    for root, _, files in os.walk(dump_dir):
        for name in files:
            if not name.endswith('.json'):
                continue
            full = os.path.join(root, name)
            path = os.path.relpath(full, dump_dir)[:-5].replace(os.sep, '/')
            if path.startswith(SKIP):
                continue
            with open(full) as f:
                docs[path] = json.load(f)
    return docs


def new_sync():
    return {'lastExportAt': None, 'unacked': {}, 'docs': {}}


def ref_for(sync, path, acked):
    """The content Claude's copy is compared against, and the base to export with."""
    if path in sync['unacked']:
        ex = sync['unacked'][path]
        # Before Google confirms, it has seen nothing new: keep the old agreed base.
        # After it confirms, Google already holds the exported content.
        return ex['hash'], (ex['data'] if acked else ex['base'])
    s = sync['docs'].get(path)
    return (s['hash'], s['base']) if s else (None, None)


def plan(dump_dir, versions_file):
    claude = dump_docs(dump_dir)
    versions = load(versions_file, {})
    sync = load(SYNC_FILE, new_sync())
    google = load(GOOGLE_FILE, None)
    writes = []
    if google:
        acked = sync['lastExportAt'] is None or google.get('processedClaudeExport') == sync['lastExportAt']
        for path, gdata in google.get('docs', {}).items():
            if path.startswith(SKIP) or '/' not in path:
                continue
            cdata = claude.get(path)
            if cdata is not None and h(cdata) == h(gdata):
                continue
            if path in sync['unacked'] and not acked:
                continue  # Google has not merged our last export yet
            ref_hash, _ = ref_for(sync, path, acked)
            if cdata is not None and h(cdata) != ref_hash:
                continue  # Claude changed it: it goes to Google first, merged result comes back
            col, doc = path.rsplit('/', 1)
            w = {'op': 'set', 'collection': col, 'doc_id': doc, 'data': gdata}
            if path in versions:
                w['if_version'] = versions[path]
            writes.append(w)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'writes.json'), 'w') as f:
        json.dump(writes, f, indent=1)
    print(f'{len(writes)} document(s) to import from Google. Batch saved to {OUT}/writes.json')


def finish(dump_dir, versions_file, written_file):
    claude = dump_docs(dump_dir)
    google = load(GOOGLE_FILE, {'docs': {}})
    sync = load(SYNC_FILE, new_sync())
    writes = load(os.path.join(OUT, 'writes.json'), [])
    written = load(written_file, {})
    gdocs = google.get('docs', {})
    acked = sync['lastExportAt'] is None or google.get('processedClaudeExport') == sync['lastExportAt']

    for w in writes:  # imported: Google's version is now the agreed base
        path = w['collection'] + '/' + w['doc_id']
        if path in written:
            claude[path] = w['data']
            sync['docs'][path] = {'hash': h(w['data']), 'base': w['data']}
            sync['unacked'].pop(path, None)

    export, unacked = {}, {}
    for path, cdata in claude.items():
        if path in gdocs and h(gdocs[path]) == h(cdata):
            sync['docs'][path] = {'hash': h(cdata), 'base': cdata}  # both sides agree
            continue
        ref_hash, base = ref_for(sync, path, acked)
        if h(cdata) == ref_hash and acked:
            continue  # unchanged, and Google already has it; its merge comes back next run
        if h(cdata) == ref_hash and path in sync['unacked']:
            unacked[path] = sync['unacked'][path]  # still waiting on Google; re-send as is
            export[path] = {'base': sync['unacked'][path]['base'], 'data': cdata}
            continue
        if h(cdata) == ref_hash:
            continue
        export[path] = {'base': base, 'data': cdata}
        unacked[path] = {'hash': h(cdata), 'data': cdata, 'base': base}

    sync['unacked'] = unacked
    if export:
        now = datetime.now(timezone.utc).isoformat()
        with open(EXPORT_FILE, 'w') as f:
            json.dump({'exportedAt': now, 'docs': export}, f, indent=1)
        sync['lastExportAt'] = now
    with open(SYNC_FILE, 'w') as f:
        json.dump(sync, f, indent=1)
    print(f'Exported {len(export)} changed document(s) for Google to merge.' if export else 'Nothing new to export.')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'plan' and len(sys.argv) == 4:
        plan(sys.argv[2], sys.argv[3])
    elif cmd == 'finish' and len(sys.argv) == 5:
        finish(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
        sys.exit(1)
