# Stage 07: Decommission and wrap-up

## Goal

After two stable weeks on the new stack: remove Supabase and the Worker for good, update the docs, have a separate agent verify everything with `REVIEW.md`, then delete `migration-plan/`.

## Depends on

Stage 06, plus two weeks without an incident that sends anyone back to Supabase.

## Deliverables

- [ ] Final Supabase export (database dump and both storage buckets) stored on the NAS (`backup-vps` share, so it's in Hyper Backup), and its integrity checked.
- [ ] Cloudflare Worker `ai-apps` deleted; the old route and any leftover DNS or custom-domain entries removed.
- [ ] Supabase project `zqxvlczqfqmcojbgwogs` deleted (with the user's explicit go-ahead).
- [ ] `supabase/` directory removed from the repo; `worker.js` and `wrangler.jsonc` confirmed gone.
- [ ] `CLAUDE.md` rewritten: the Supabase, Edge functions, Deploying and MCP sections now describe `server/`, dbmate, the API, GitHub Actions + the `deploy` branch, Komodo, and the rollback caveat about migrations.
- [ ] `~/Obsidian/Claude/Homelab.md` updated: the `apps.trplan.si` row, the vps2 stack table, backups, and the issues list; snapshot date bumped.
- [ ] The `komodo` skill's stack table updated with `ai-apps` and its autodeploy procedure.
- [ ] A separate agent works through `REVIEW.md` and records evidence for each item; any findings are fixed or consciously accepted.
- [ ] `migration-plan/` deleted in the final commit. `REVIEW.md` stays.

## Files touched

Removed: `supabase/**`, `migration-plan/**`. Modified: `CLAUDE.md`, `REVIEW.md` (ticked, with evidence). Outside the repo, with the user's confirmation each time: Cloudflare, Supabase, the Homelab note, the komodo skill.

## Design notes

- Don't delete the Supabase project until the final export is verified: restore the dump into a scratch Postgres container and compare counts, and check the bucket files' digests.
- Before deleting the Worker, check Cloudflare analytics or logs for stray traffic (old PWAs or the old connector still pointing at it).
- Remove `.claude/` leftovers only if they came from this migration; leave the user's other files alone.
- The reviewing agent should work from `REVIEW.md` and the repo alone, not from this plan, so that it checks the result rather than the intentions. It may only fix what `REVIEW.md` lists; everything else goes in the Findings section.

## Done when

- Every `REVIEW.md` item is ticked with evidence, or has an accepted finding written down.
- `git grep -iE 'supabase|zqxvlczq|sb_publishable|Deno\.|EdgeRuntime|wrangler'` finds nothing outside `REVIEW.md`.
- `migration-plan/` no longer exists on `master`.

## REVIEW.md sections

10, plus a full pass over 1–9.

## Notes

(Fill in as work lands.)
