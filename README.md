# AI Apps

A small collection of AI-generated apps, served as static HTML/JS — no
runtime build step required.

## Adding an app

Each app has an entry point written in JSX at the repo root (`<name>-app.jsx`),
compiled to a plain `React.createElement`-based bundle (`<name>-app.js`)
that's loaded directly by `<name>.html` alongside the React/ReactDOM UMD
scripts. The compiled `.js` file is committed, so the site needs no build
step to deploy. If an app grows large, its entry point can `import`/`export`
from sibling files or a subdirectory (e.g. `<name>/`) — esbuild bundles
everything into the single committed `<name>-app.js`.

To compile `.jsx` sources after editing them:

```sh
pnpm install
pnpm run build
```

This runs `build.js`, which compiles every `*-app.jsx` file in the repo
root into its matching `*-app.js` file via esbuild.

## Supabase Edge Functions

`supabase/functions/shopping-list` calls an LLM through OpenRouter for the
Shopping List app. It needs an OpenRouter API key set as a secret:

```sh
supabase secrets set OPENROUTER_API_KEY=...
supabase functions deploy shopping-list
```

It only answers signed-in users, so the key can't be spent by anyone else.

`supabase/functions/recipe-import` powers the Recipes app's "✦ Magic" import
(screenshots, pasted text or a link → recipe) with the same OpenRouter key:

```sh
supabase functions deploy recipe-import
```

`supabase/functions/shopping-merge` spots ingredients added from a recipe
that are already on the Recipes app's list and adds up their amounts, with
the same key:

```sh
supabase functions deploy shopping-merge
```

`supabase/functions/price-estimate` estimates what a recipe or shopping list
costs at Aldi Suisse, with the same key. Packaged goods are priced from Aldi
Suisse's product search; fresh fruit and vegetables, which Aldi doesn't list
online, from the Federal Office for Agriculture's monthly Swiss retail prices
(LINDAS). Neither needs a key:

```sh
supabase functions deploy price-estimate
```
