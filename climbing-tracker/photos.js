// Exercise pictures. An exercise's `photo` is { library: "<id>" } for a
// stretch library picture (static files, see stretchLibrary.js) or
// { path: "<user id>/<file>" } for one the user uploaded to the private
// "climbing-photos" bucket (shared/photos.js), which needs a session to read.

import * as photos from "../shared/photos.js";
import { libraryPhotoUrls } from "./stretchLibrary.js";

const BUCKET = "climbing-photos";

export { compressPhoto } from "../shared/photos.js";

export const uploadPhoto = (session, blob) => photos.uploadPhoto(BUCKET, session, blob);

export const removePhoto = (path) => photos.removePhoto(BUCKET, path);

// The exercise's picture URLs, the one to show first (the held position)
// first; empty when it has none, or an uploaded one and no session.
export function exercisePhotoUrls(exercise, session) {
  const photo = exercise?.photo;
  if (!photo) return [];
  if (photo.library) return libraryPhotoUrls(photo.library);
  if (photo.path && session) return [photos.photoUrl(BUCKET, photo.path)];
  return [];
}
