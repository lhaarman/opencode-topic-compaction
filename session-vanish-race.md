# Session-vanish race during large compactions — upstream report draft

**Environment:** opencode serve v1.18.21 (also observed adjacent behaviors on v1.18.18 SDK against 1.18.21 server), Linux, shared SQLite DB (`opencode.db`, WAL mode, `busy_timeout=5000`), two headless serves on different ports sharing one DB.

## Summary

While evaluating compaction quality on large sessions (880 messages, ~306k tokens), sessions were repeatedly **deleted from the database mid-operation**, roughly 10 minutes after a `POST /session/{id}/summarize` was issued against them. Reproduced three times across two days. The deletion removes the `session` row and cascades to `message`/`part`; sources and unrelated sessions remain intact.

## Reproduction outline

1. Create a session with ~880 messages (~1.2 MB history).
2. Start `opencode serve` (with or without `--pure`) and issue `POST /session/{id}/summarize` with a remote model.
3. Poll for the compaction result. After ~10 minutes the session rows are gone (`SELECT ... FROM session WHERE slug=...` returns empty; message/part rows cascade-deleted).

Observed instances (all UTC, 2026-08-22):
- ~14:25 — both evaluation clones (x-u10-plugin/x-u10-pure) vanished between clone time and first poll.
- ~19:12 — same pair vanished again ~10 min into summarize; source session `h4-plugin`'s 880 messages were also found deleted minutes after being read intact.
- Yesterday ~13:2x — equivalent pair lost during the same experiment.

## Notes

- The window that triggers it is consistently the largest one tested (~300k tokens); smaller windows (≤65 msgs) never vanished across dozens of runs.
- A concurrent writer existed in some instances (an interactive opencode instance on the same DB), so an interaction between server-side compaction/cleanup paths and concurrent access is suspected; however the timing correlation with summarize-on-huge-windows held even when monitoring was otherwise quiet.
- Failed generations on these windows also leave behind marker pairs whose assistant member has reasoning parts but no text part.

## Workaround

- Keep compaction inputs comfortably below ~300k tokens.
- Snapshot (SQL copy) source sessions before issuing summarize on very large windows; re-clone from snapshot if a vanish occurs.
- Avoid multiple live serves/instances sharing one DB during large compactions where possible.

## Requested from maintainers

- Confirm whether any server-side path deletes sessions/messages on failed or oversized summarize (e.g., rollback/GC), and under what conditions.
- If intentional, document the threshold and make it observable (log line with reason + session id).
