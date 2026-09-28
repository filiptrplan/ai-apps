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

## Server-side API

`worker.js` (a Cloudflare Worker) handles `/api/*` paths that aren't static
files. `/api/shopping-list` calls Claude for the Shopping List app and needs
an Anthropic API key set as a Worker secret:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
```

It only answers signed-in users, so the key can't be spent by anyone else.
