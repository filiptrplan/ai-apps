# AI Apps

A small collection of AI-generated apps, served as static HTML/JS. The
bundles are built when the server image is built, not at runtime.

## Adding an app

Each app has an entry point written in JSX at the repo root (`<name>-app.jsx`),
compiled to a plain `React.createElement`-based bundle (`<name>-app.js`)
that's loaded directly by `<name>.html` alongside the React/ReactDOM UMD
scripts. The compiled `.js` file is not committed:
the Dockerfile builds it when the server image is built. If an app grows large, its entry point can `import`/`export`
from sibling files or a subdirectory (e.g. `<name>/`) — esbuild bundles
everything into the single `<name>-app.js`.

To compile `.jsx` sources after editing them:

```sh
pnpm install
pnpm run build
```

This runs `build.cjs`, which compiles every `*-app.jsx` file in the repo
root into its matching `*-app.js` file via esbuild.

## AI functions

The AI functions live in `server/functions/<name>.js` and are served by the
server at `POST /api/fn/<name>`, only to signed-in users, so the keys can't
be spent by anyone else. The keys and model overrides are environment
variables of the Komodo stack on vps2 (see `server/README.md`), never in
the repo.

`shopping-list` calls an LLM through OpenRouter (`OPENROUTER_API_KEY`) for
the Shopping List app. `recipe-import` powers the Recipes app's "✦ Magic"
import (screenshots, pasted text or a link → recipe), and `shopping-merge`
spots ingredients added from a recipe that are already on the Recipes app's
list and adds up their amounts, both with the same key.

`price-estimate` estimates what a recipe or shopping list costs at Aldi
Suisse, with the same key. Packaged goods are priced from Aldi Suisse's
product search; fresh fruit and vegetables, which Aldi doesn't list online,
from the Federal Office for Agriculture's monthly Swiss retail prices
(LINDAS). Neither needs a key.

`german-ai` does every text AI task of the German app (filling in words,
also from podcast transcripts, examples, suggested words, writing prompts
and corrections), `german-tts` speaks example sentences into the private
`german-audio` storage bucket, and `german-podcast` makes the AI podcast
episodes: it writes a script after a web search, has Gemini TTS (through
OpenRouter) speak it as a two-voice dialogue and stores it as a WAV in the
same bucket, in the background in the server process, so the app can be
closed meanwhile. They call OpenAI directly (`OPENAI_API_KEY`); the text
model (default `gpt-6.1-sol`) and speech model can be switched with the
optional `OPENAI_MODEL` and `OPENAI_TTS_MODEL` (the text model has to
support the Responses API's web search tool for the podcast). The podcast
also needs the OpenRouter key, and its voice model can be switched with the
optional `PODCAST_TTS_MODEL` (default `google/gemini-3.8-flash-tts`).
