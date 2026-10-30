// Recipe photos in the private "recipe-photos" storage bucket. Photos are
// shrunk and re-encoded in the browser before upload, stored under
// "<user id>/<file>" (the server only allows your own folder), and shown
// straight from /api/storage, which the session cookie unlocks.

import { apiFetch } from "../shared/api.js";
import { uid } from "./format.js";

const BUCKET = "recipe-photos";
const PHOTO_MAX_SIDE = 1280;
const PHOTO_QUALITY = 0.8;

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

const photoUrl = (path) => `/api/storage/${BUCKET}/${path}`;

export async function uploadPhoto(session, blob) {
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${session.user.id}/${Date.now()}-${uid()}.${ext}`;
  try {
    await apiFetch(photoUrl(path), { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
  } catch (err) {
    throw new Error(`Photo upload failed: ${err.message}`);
  }
  return path;
}

// Best effort: a leftover file only costs a little storage.
export async function removePhoto(path) {
  if (!path) return;
  await apiFetch(photoUrl(path), { method: "DELETE" }).catch(() => {});
}

// The displayable URL of a stored photo, or null when signed out or when
// there's no photo.
export function usePhotoUrl(path, session) {
  return path && session ? photoUrl(path) : null;
}
