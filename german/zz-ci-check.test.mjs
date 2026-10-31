import test from "node:test";
import assert from "node:assert/strict";
test("deliberately failing (stage 05 CI check, never merged)", () => assert.equal(1, 2));
