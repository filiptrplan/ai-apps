// Recipe photos in the private "recipe-photos" Supabase Storage bucket.
// Photos are shrunk and re-encoded in the browser before upload, stored
// under "<user id>/<file>" (the bucket's policies only allow your own
// folder), and shown through signed URLs that are cached so the browser can
// keep reusing the downloaded image.

import { supabase } from "../shared/supabaseClient.js";
import { uid } from "./format.js";

const { useState, useEffect } = React;

const BUCKET = "recipe-photos";
const PHOTO_MAX_SIDE = 1280;
const PHOTO_QUALITY = 0.8;
const URL_TTL_S = 7 * 24 * 3600;
// Signed URLs are reused until they have less than this left.
const URL_MIN_LEFT_MS = 24 * 3600 * 1000;
const URL_CACHE_PREFIX = "recipes-photo-url:";

// Draws an image file onto a canvas no larger than maxSide on its long edge.
export function drawScaled(file, maxSide) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("Couldn't read that image."));
    };
    img.src = src;
  });
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Returns { blob, preview } with the photo as WebP (or JPEG where the
// browser can't encode WebP), typically 100–300 KB.
export async function compressPhoto(file) {
  const canvas = await drawScaled(file, PHOTO_MAX_SIDE);
  let blob = await toBlob(canvas, "image/webp", PHOTO_QUALITY);
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", PHOTO_QUALITY);
  if (!blob) throw new Error("Couldn't compress that image.");
  return { blob, preview: URL.createObjectURL(blob) };
}

export async function uploadPhoto(session, blob) {
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${session.user.id}/${Date.now()}-${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

// Best effort: a leftover file only costs a little storage.
export async function removePhoto(path) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
  try {
    localStorage.removeItem(URL_CACHE_PREFIX + path);
  } catch {}
}

const inflight = new Map();

function cachedUrl(path) {
  try {
    const hit = JSON.parse(localStorage.getItem(URL_CACHE_PREFIX + path));
    if (hit && hit.exp - Date.now() > URL_MIN_LEFT_MS) return hit.url;
  } catch {}
  return null;
}

function signedUrl(path) {
  const hit = cachedUrl(path);
  if (hit) return Promise.resolve(hit);
  if (!inflight.has(path)) {
    const p = supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, URL_TTL_S)
      .then(({ data, error }) => {
        if (error || !data) return null;
        try {
          localStorage.setItem(URL_CACHE_PREFIX + path, JSON.stringify({ url: data.signedUrl, exp: Date.now() + URL_TTL_S * 1000 }));
        } catch {}
        return data.signedUrl;
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  return inflight.get(path);
}

// The displayable URL of a stored photo, or null while loading, when
// signed out, or when there's no photo.
export function usePhotoUrl(path, session) {
  const [url, setUrl] = useState(() => (path && session ? cachedUrl(path) : null));
  useEffect(() => {
    if (!path || !session) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    signedUrl(path).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [path, session && session.user.id]);
  return url;
}
