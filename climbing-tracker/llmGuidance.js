export const LLM_GUIDANCE = `You are generating data for the "Climbing Tracker" web app. The app stores exercises and routines as JSON that gets pasted into its "Import exercises & routines" dialog.

Output the JSON inside a single fenced code block (\`\`\`json ... \`\`\`) so it's easy to copy, with no commentary before or after the block and no trailing commas. The JSON must match this exact shape:

{
  "exercises": [ <Exercise>, ... ],
  "routines": [ <Routine>, ... ]
}

Exercise objects use one of three "type" values:

1) "reps" - plain bodyweight reps, e.g. pull-ups, push-ups, core work:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "reps",
  "sets": <integer, number of sets>,
  "reps": <integer, target reps per set>,
  "restSec": <integer, seconds of rest between sets, 0 for no timed rest>
}

2) "weighted" - sets of reps with a weight, either added to bodyweight (weighted pull-up belt, weight vest) or an absolute total weight (barbell, dumbbell, machine):
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "weighted",
  "sets": <integer>,
  "reps": <integer, target reps per set>,
  "weight": <number, kg>,
  "weightMode": "added" | "total",
  "restSec": <integer, seconds of rest between sets, 0 for no timed rest>
}
Use "added" when the weight is extra load on top of the climber's own bodyweight. Use "total" when it's the full weight being lifted.

3) "interval" - timed work/rest sets, e.g. hangboard repeaters, dead hangs, plank holds, rest-pause finger boarding:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "interval",
  "workSec": <integer, seconds of work per set>,
  "restSec": <integer, seconds of rest between sets>,
  "sets": <integer, number of work/rest cycles>
}

Routine objects group exercises into an ordered sequence of steps to perform together. Each step points at an exercise and can optionally override that exercise's "sets" and "restSec" just for this routine (leave them null to use the exercise's own defaults). The same exerciseId can appear in multiple steps, e.g. to do a couple of warm-up sets early in the routine and more later:
{
  "id": "<unique string>",
  "name": "<routine name>",
  "steps": [
    { "id": "<unique string>", "exerciseId": "<id of an exercise in the exercises array>", "sets": <integer or null>, "restSec": <integer or null>, "restAfterSec": <integer or null>, "targetSets": <array or null>, "supersetGroup": <string or null> },
    ...
  ]
}

For "reps" and "weighted" exercise steps only, "targetSets" can specify a heterogeneous per-set pattern instead of a uniform "sets" count - e.g. a pyramid of 2 sets of 12 reps then 1 set of 24 reps. When present it fully replaces "sets" (and "reps"/"weight") for that step. Leave it null for a plain uniform sets x reps target. Format: an array with one entry per set, in order:
- "reps" type: [ { "reps": <integer> }, ... ]
- "weighted" type: [ { "reps": <integer>, "weight": <number, kg> }, ... ]
Do not use "targetSets" for "interval" exercises - they only support the uniform "sets"/"restSec" overrides above.

IMPORTANT - there are TWO different kinds of rest, don't mix them up:
- "restSec" (on the exercise or overridden on a step) fires ONLY between repeated sets of that SAME exercise within that SAME step, and ONLY when that step's "sets" is 2 or more. If a step has "sets": 1, its "restSec" is completely inert (for "interval" exercises, a rest phase only ever happens between work cycles of that SAME timer, so "sets": 1 means the rest phase never triggers either). Only set "restSec" above 0 when that same step also has "sets" of 2 or more.
- "restAfterSec" (only settable per routine step, defaults to 0/null) is the rest countdown shown after this step is fully finished, before moving on to the NEXT exercise (or superset) in the routine. Use it for pauses between separate exercises, e.g. "5 exercises with 20s between each exercise" - give every step "restAfterSec": 20 (it is harmless to leave it on the very last step too, since it is simply never shown after the last card). For alternating sets of two or more exercises, use "supersetGroup" (below) instead. Do not set "restAfterSec" on a step and expect it to do anything other than pause AFTER that step completes and BEFORE the next one - it has no effect on rest within the step itself, that is still "restSec"'s job.

SUPERSETS - "supersetGroup" (optional, per routine step, default null) links consecutive steps into a superset that is performed in alternating rounds: one set of the first exercise, one set of the next, and so on, then a rest, then the next round (A1, B1, rest, A2, B2, rest, ...). Give every member step the same short string (e.g. "ss-1"); use a different string for each separate superset, and null for steps that aren't in one. Rules for supersets:
- Only "reps" and "weighted" exercise steps can be in a superset - never "interval" steps.
- Members must be directly next to each other in "steps", and a superset needs at least 2 members.
- Give every member the same number of sets (same "sets", or "targetSets" arrays of the same length).
- The rest between rounds is the LAST member's "restSec". Set "restSec" to 0 on all other members - there is no rest between exercises inside a round.
- The rest after the whole superset (before the next exercise) is the LAST member's "restAfterSec". "restAfterSec" on the other members is ignored.
Example: weighted pull-ups superset with push-ups, 3 rounds, 90s between rounds, then 2 min before the next exercise:
  { "id": "st-1", "exerciseId": "ex-weighted-pullups", "sets": 3, "restSec": 0, "restAfterSec": null, "targetSets": null, "supersetGroup": "ss-1" },
  { "id": "st-2", "exerciseId": "ex-pushups", "sets": 3, "restSec": 90, "restAfterSec": 120, "targetSets": null, "supersetGroup": "ss-1" }

Rules:
- Every "id" must be unique within the file (e.g. "ex-dead-hangs-01").
- Every "exerciseId" referenced by a routine step must also appear as an exercise in the "exercises" array of the same JSON.
- Leave "exercises" or "routines" as an empty array (or omit the key) if you have nothing to add for it.
- Do not invent extra fields beyond the ones described above ("supersetGroup" is allowed on routine steps). Put the JSON in exactly one \`\`\`json code block and nothing else outside it.
- Unless told otherwise, pick sensible default sets/reps/weights/durations/rests for an intermediate climber.

Now generate the exercises and/or routines described by the user's request that follows this prompt.`;
