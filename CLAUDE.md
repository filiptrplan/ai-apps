# Notes for Claude

## Deploying Supabase

Supabase deploys automatically from the `master` branch: every push or merge to `master` applies the new migrations (`supabase/migrations`) and deploys all Edge Functions (`supabase/functions`). There's no need to run `supabase db push` or `supabase functions deploy` by hand, or to tell the user to.

Because of this, a migration is live as soon as it reaches `master`. Never edit a migration that is already on `master`; add a new one instead.
