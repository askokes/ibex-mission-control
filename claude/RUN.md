# Claude sync run (hourly)

Claude board: https://claude.ai/artifact/GoeK8ZLvbK1J1BNgns89pP

1. `git pull` on the default branch.
2. Dump the Claude board's documents with ArtifactData `list` and `out_dir: /tmp/mcdump`, for each collection: runsheet, notes, ar, pr, mod, voices, people.
3. Write /tmp/mcversions.json mapping each "collection/doc" path to the version the list results showed.
4. `python3 claude/sync.py plan /tmp/mcdump /tmp/mcversions.json`
5. If claude/out/writes.json has entries, apply them with one ArtifactData `batch`, 50 at most per call. Write /tmp/mcwritten.json mapping each written path to its new version. If nothing was written, write `{}`. If a pinned write fails because someone just edited that document, leave it out. The next run picks it up.
6. Dump again into /tmp/mcdump2, as in step 2, then run `python3 claude/sync.py finish /tmp/mcdump2 /tmp/mcversions.json /tmp/mcwritten.json`
7. Commit state/claude.json and state/claude_sync.json with "Claude sync <UTC time>" and push. Don't commit claude/out/.
8. Reply with one line: documents imported, documents exported.

Never sync data/users/. Don't change any file except those in state/ and claude/out/.
