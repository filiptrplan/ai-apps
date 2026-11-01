// Recipe photos in the private "recipe-photos" storage bucket, through the
// shared photo helpers (shared/photos.js).

import * as photos from "../shared/photos.js";

const BUCKET = "recipe-photos";

export { drawScaled, compressPhoto } from "../shared/photos.js";

export const uploadPhoto = (session, blob) => photos.uploadPhoto(BUCKET, session, blob);

export const removePhoto = (path) => photos.removePhoto(BUCKET, path);

// The displayable URL of a stored photo, or null when signed out or when
// there's no photo.
export function usePhotoUrl(path, session) {
  return path && session ? photos.photoUrl(BUCKET, path) : null;
}
