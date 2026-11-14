import test from "node:test";
import assert from "node:assert/strict";

test("review: deliberately failing test (do not merge)", () => {
  assert.equal(1, 2);
});
