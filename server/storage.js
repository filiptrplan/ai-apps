// File storage on disk, replacing Supabase Storage: a file lives at
// <storageDir>/<bucket>/<userId>/<path>, and a user may only touch their
// own folder (the first path segment must be their id, as the Supabase
// policies required). Bucket limits come from the bucket migrations.

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MiB = 1024 * 1024;

// Each allowed content type with the file extensions it may be stored under;
// a file is served back with the type its extension maps to.
export const BUCKETS = {
  "recipe-photos": {
    maxBytes: 2 * MiB,
    types: { "image/webp": [".webp"], "image/jpeg": [".jpg", ".jpeg"] },
  },
  "german-audio": {
    maxBytes: 50 * MiB,
    types: { "audio/mpeg": [".mp3"], "audio/wav": [".wav"] },
  },
};

export class StorageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function typeForExtension(bucket, ext) {
  for (const [type, exts] of Object.entries(BUCKETS[bucket].types)) {
    if (exts.includes(ext)) return type;
  }
  return null;
}

export function createStorage(storageDir) {
  const root = path.resolve(storageDir);

  // Checks a request for <bucket>/<segments...> by `userId` and returns the
  // file's absolute path and content type. Segments are already URL-decoded.
  function resolve(bucket, segments, userId) {
    if (!Object.hasOwn(BUCKETS, bucket)) throw new StorageError(404, "No such bucket.");
    const valid =
      Array.isArray(segments) &&
      segments.length >= 2 &&
      segments.join("/").length <= 1024 &&
      segments.every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= 255 && !s.startsWith(".") && !/[/\\\0]/.test(s)
      );
    if (!valid) throw new StorageError(400, "Invalid path.");
    if (segments[0] !== userId) throw new StorageError(403, "Not your file.");

    const userDir = path.join(root, bucket, userId);
    const file = path.resolve(userDir, ...segments.slice(1));
    if (!file.startsWith(userDir + path.sep)) throw new StorageError(400, "Invalid path.");

    const type = typeForExtension(bucket, path.extname(file).toLowerCase());
    if (!type) throw new StorageError(415, "This file type isn't allowed here.");
    return { file, type };
  }

  // Streams `body` into the file. It's written to a temp file next to it and
  // renamed into place, so a half-finished upload is never served.
  async function write(bucket, segments, userId, contentType, body) {
    const { file, type } = resolve(bucket, segments, userId);
    const sentType = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (sentType !== type) throw new StorageError(415, `Expected Content-Type ${type}.`);

    const { maxBytes } = BUCKETS[bucket];
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.upload-${randomBytes(8).toString("hex")}`);
    let size = 0;
    try {
      await pipeline(
        // Not destroyed when we stop early, so the caller can still answer 413.
        body.iterator({ destroyOnReturn: false }),
        async function* (chunks) {
          for await (const chunk of chunks) {
            size += chunk.length;
            if (size > maxBytes) throw new StorageError(413, `Files here can be at most ${maxBytes / MiB} MB.`);
            yield chunk;
          }
        },
        createWriteStream(tmp, { flags: "wx" })
      );
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return { size };
  }

  // Returns false if there was no such file.
  async function remove(bucket, segments, userId) {
    const { file } = resolve(bucket, segments, userId);
    try {
      await unlink(file);
      return true;
    } catch (err) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  return { resolve, write, remove };
}
