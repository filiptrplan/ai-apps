import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch, setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

const resolve = (url) => t.request(`/api/resolve-maps-link?url=${encodeURIComponent(url)}`);
const redirect = (location) => new Response(null, { status: 302, headers: { location } });

test("a short link resolves to the Google Maps URL it redirects to, and is cacheable", async () => {
  const full = "https://www.google.com/maps/dir/47.37,8.54/47.41,8.55/data=!4m2";
  const mock = mockFetch((url) => {
    if (url.href === "https://maps.app.goo.gl/abc") return redirect("https://goo.gl/maps/xyz");
    if (url.href === "https://goo.gl/maps/xyz") return redirect(full);
    throw new Error(`unexpected fetch ${url}`);
  });
  try {
    const res = await resolve("https://maps.app.goo.gl/abc");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
    assert.deepEqual(await res.json(), { url: full });
    // Signed out is fine.
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});

test("only Google Maps short links are followed", async () => {
  const mock = mockFetch((url) => {
    throw new Error(`unexpected fetch ${url}`);
  });
  try {
    for (const [url, error] of [
      ["", "Not a URL"],
      ["https://example.com/maps", "Not a Google Maps short link"],
      ["https://goo.gl/other", "Not a Google Maps short link"],
      ["ftp://maps.app.goo.gl/abc", "Not a Google Maps short link"],
    ]) {
      const res = await resolve(url);
      assert.deepEqual([res.status, await res.json()], [400, { error }], url);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("a short link leading elsewhere is a 422, an unreachable one a 502", async () => {
  let mock = mockFetch(() => redirect("https://evil.example/phish"));
  try {
    const res = await resolve("https://maps.app.goo.gl/abc");
    assert.deepEqual([res.status, await res.json()], [422, { error: "Link didn't lead to Google Maps" }]);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
  mock = mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  try {
    const res = await resolve("https://maps.app.goo.gl/abc");
    assert.deepEqual([res.status, await res.json()], [502, { error: "Couldn't reach Google Maps" }]);
  } finally {
    mock.restore();
  }
});
