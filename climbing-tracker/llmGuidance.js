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
    { "id": "<unique string>", "exerciseId": "<id of an exercise in the exercises array>", "sets": <integer or null>, "restSec": <integer or null>, "restAfterSec": <integer or null> },
    ...
  ]
}

IMPORTANT - there are TWO different kinds of rest, don't mix them up:
- "restSec" (on the exercise or overridden on a step) fires ONLY between repeated sets of that SAME exercise within that SAME step, and ONLY when that step's "sets" is 2 or more. If a step has "sets": 1, its "restSec" is completely inert (for "interval" exercises, a rest phase only ever happens between work cycles of that SAME timer, so "sets": 1 means the rest phase never triggers either). Only set "restSec" above 0 when that same step also has "sets" of 2 or more.
- "restAfterSec" (only settable per routine step, defaults to 0/null) is the rest countdown shown after this step is fully finished, before moving on to the NEXT exercise in the routine. This is what to use for circuits/supersets, e.g. "3 rounds of 5 exercises with 20s between each exercise" - give every step in the round "restAfterSec": 20 (except it is harmless to leave it on the very last step too, since it is simply never shown after the last card). Do not set "restAfterSec" on a step and expect it to do anything other than pause AFTER that step completes and BEFORE the next one - it has no effect on rest within the step itself, that is still "restSec"'s job.

Rules:
- Every "id" must be unique within the file (e.g. "ex-dead-hangs-01").
- Every "exerciseId" referenced by a routine step must also appear as an exercise in the "exercises" array of the same JSON.
- Leave "exercises" or "routines" as an empty array (or omit the key) if you have nothing to add for it.
- Do not invent extra fields. Put the JSON in exactly one \`\`\`json code block and nothing else outside it.
- Unless told otherwise, pick sensible default sets/reps/weights/durations/rests for an intermediate climber.

Now generate the exercises and/or routines described by the user's request that follows this prompt.`;
