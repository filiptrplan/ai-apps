# Marsova opravila — design canvas

Design-stage source for **Marsova opravila**, a private Slovenian chore-and-reward
PWA for one couple. This folder holds the working source for the Claude Design
canvas prototype, not an app implementation yet.

**Published canvas:** https://claude.ai/code/artifact/d2d6844a-373a-46f7-a46a-7d85a4d022f5

## What's in the canvas so far

One artboard (`Main.dc.html`) prototyping the user-side app: Opravila (hold-to-
complete chore cards, category chips, empty/loading states), Nagrade (reward
cards, request bottom sheet with hold-to-confirm, pending requests, no-rewards
state), and Dogajanje (grouped activity timeline with undo). All copy is final
Slovenian, not placeholder. Simulated states (`nalaganje`/loading, `prazno`/
empty, `brez povezave`/offline, `napaka`/error) are wired as canvas tweaks and
drive both the chore-completion and reward-request hold gestures.

Not yet built: the admin side (Pregled, Opravila, Kategorije, Nagrade,
Zahtevki, Nastavitve), the PIN entry screen, and the visual direction board —
see the original brief for full scope.

## Mars poses needed

Only one Mars illustration exists (`mars-idle.jpg` — sitting, calm, paws
crossed, cream/blush circular badge background, no transparency). The canvas
currently stands in with this same image everywhere a different mood is
implied; each spot is marked with an HTML comment (`MARS POSE: ...`) in
`Main.dc.html`. To finish the mascot, draw these in the **same square,
painted-background circular-badge style** as the idle pose so they drop in
without reframing:

1. **Zaspan / čaka (sleepy-waiting)** — calmer, maybe head resting on paws or
   half-closed eyes. Used in every empty state: no chores yet, no rewards yet,
   empty activity log.
2. **Navdušen / praznuje (celebrating)** — big joyful reaction, tail mid-wag,
   sparkle-eyed. Used in the header avatar the moment a chore completes.
3. **Radoveden / pričakuje (excited anticipation)** — perked up, leaning in.
   Used as a small badge on the reward-request bottom sheet.

Once supplied, swap each `<img src="./mars-idle.jpg">` at the marked spots
for a new file (e.g. `mars-sleepy.jpg`, `mars-celebrate.jpg`,
`mars-excited.jpg`), keep each under ~70 KB, and re-seed.

## Re-seeding after edits

```sh
node "<design skill base dir>/seed-canvas.mjs" \
  --template "<design skill base dir>/payload.template.html" \
  --out marsova-opravila.html \
  --title "Marsova opravila" \
  --artboard Main.dc.html \
  --image mars-idle.jpg [--image mars-sleepy.jpg ...]
```

Then publish with the `Artifact` tool, passing the existing artifact URL above
so it updates in place rather than creating a new one.
