import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setup } from "./testing.mjs";

let t;
before(async () => (t = await setup()));
after(() => t.close());

const MiB = 1024 * 1024;

function upload(user, pathname, body, type) {
  return t.request(`/api/storage/${pathname}`, {
    method: "PUT",
    headers: { ...user.headers, "content-type": type },
    body,
    duplex: "half",
  });
}

test("a user uploads, reads back and deletes their own file", async () => {
  const a = await t.signedIn();
  const bytes = Buffer.from("RIFF....WAVE");
  const put = await upload(a, `german-audio/${a.id}/podcast/ep1.wav`, bytes, "audio/wav");
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { path: `${a.id}/podcast/ep1.wav`, size: bytes.length });

  const get = await t.request(`/api/storage/german-audio/${a.id}/podcast/ep1.wav`, { headers: a.headers });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "audio/wav");
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);

  // Ranges work, so audio can seek.
  const range = await t.request(`/api/storage/german-audio/${a.id}/podcast/ep1.wav`, { headers: { ...a.headers, range: "bytes=0-3" } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "RIFF");

  const del = await t.request(`/api/storage/german-audio/${a.id}/podcast/ep1.wav`, { method: "DELETE", headers: a.headers });
  assert.equal(del.status, 204);
  assert.equal((await t.request(`/api/storage/german-audio/${a.id}/podcast/ep1.wav`, { headers: a.headers })).status, 404);
});

test("an upload replaces the file, and leaves no temp files behind", async () => {
  const a = await t.signedIn();
  await upload(a, `recipe-photos/${a.id}/p.webp`, "one", "image/webp");
  await upload(a, `recipe-photos/${a.id}/p.webp`, "two", "image/webp");
  const res = await t.request(`/api/storage/recipe-photos/${a.id}/p.webp`, { headers: a.headers });
  assert.equal(await res.text(), "two");
  assert.deepEqual(await readdir(path.join(t.storageDir, "recipe-photos", a.id)), ["p.webp"]);
});

test("another user's files are off limits", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await upload(a, `recipe-photos/${a.id}/p.jpg`, "a's photo", "image/jpeg");

  const file = `/api/storage/recipe-photos/${a.id}/p.jpg`;
  assert.equal((await t.request(file, { headers: b.headers })).status, 403);
  assert.equal((await upload(b, `recipe-photos/${a.id}/p.jpg`, "b's", "image/jpeg")).status, 403);
  assert.equal((await t.request(file, { method: "DELETE", headers: b.headers })).status, 403);
  assert.equal(await (await t.request(file, { headers: a.headers })).text(), "a's photo");
});

test("signed out, storage answers 401", async () => {
  const a = await t.signedIn();
  assert.equal((await t.request(`/api/storage/recipe-photos/${a.id}/p.jpg`)).status, 401);
});

test("path traversal is rejected", async () => {
  const a = await t.signedIn();
  const b = await t.signedIn();
  await upload(b, `recipe-photos/${b.id}/secret.jpg`, "b's", "image/jpeg");

  const attempts = [
    `recipe-photos/${a.id}/..%2F${b.id}%2Fsecret.jpg`,
    `recipe-photos/${a.id}/%2e%2e/${b.id}/secret.jpg`,
    `recipe-photos/${a.id}/..%5C${b.id}%5Csecret.jpg`,
    `recipe-photos/${a.id}/%2Fetc%2Fpasswd.jpg`,
    `recipe-photos/${a.id}/x%00.jpg`,
    `recipe-photos/${a.id}/.upload-123`,
    `recipe-photos/${a.id}`,
  ];
  for (const p of attempts) {
    const get = await t.request(`/api/storage/${p}`, { headers: a.headers });
    assert.ok([400, 403, 404].includes(get.status), `${p}: ${get.status}`);
    assert.notEqual(await get.text(), "b's");
    const put = await upload(a, p, "x", "image/jpeg");
    assert.ok([400, 403, 404].includes(put.status), `PUT ${p}: ${put.status}`);
  }
  // fetch normalises a literal "/../" away before sending, so send it raw.
  const status = await new Promise((resolve, reject) => {
    const { hostname, port } = new URL(t.base);
    const rawPath = `/api/storage/recipe-photos/${a.id}/../${b.id}/secret.jpg`;
    http
      .get({ hostname, port, path: rawPath, headers: a.headers }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject);
  });
  assert.ok([400, 403, 404].includes(status), `raw ../: ${status}`);
});

test("unknown buckets are a 404", async () => {
  const a = await t.signedIn();
  assert.equal((await upload(a, `other/${a.id}/x.jpg`, "x", "image/jpeg")).status, 404);
  assert.equal((await t.request(`/api/storage/__proto__/${a.id}/x.jpg`, { headers: a.headers })).status, 404);
});

test("bucket content types are enforced", async () => {
  const a = await t.signedIn();
  assert.equal((await upload(a, `recipe-photos/${a.id}/p.png`, "x", "image/png")).status, 415);
  assert.equal((await upload(a, `recipe-photos/${a.id}/p.jpg`, "x", "image/webp")).status, 415);
  assert.equal((await upload(a, `recipe-photos/${a.id}/p.html`, "<script>", "text/html")).status, 415);
  assert.equal((await upload(a, `german-audio/${a.id}/s.jpg`, "x", "image/jpeg")).status, 415);
  assert.equal((await upload(a, `german-audio/${a.id}/s.mp3`, "x", "audio/mpeg")).status, 200);
});

test("bucket size limits are enforced, with or without a Content-Length", async () => {
  const a = await t.signedIn();
  const tooBig = Buffer.alloc(2 * MiB + 1);
  const res = await upload(a, `recipe-photos/${a.id}/big.jpg`, tooBig, "image/jpeg");
  assert.equal(res.status, 413);

  // A chunked upload has no Content-Length, so it's stopped while streaming.
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(MiB));
      controller.close();
    },
  });
  const chunked = await upload(a, `recipe-photos/${a.id}/big2.jpg`, stream, "image/jpeg");
  assert.equal(chunked.status, 413);
  assert.deepEqual(await readdir(path.join(t.storageDir, "recipe-photos", a.id)), []);

  assert.equal((await upload(a, `recipe-photos/${a.id}/ok.jpg`, Buffer.alloc(2 * MiB), "image/jpeg")).status, 200);
});
