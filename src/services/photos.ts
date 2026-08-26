// src/services/photos.ts
//
// Getting item pictures off the device that took them.
//
// Everything the scanner produces starts life as a local file URI. That is the
// right thing to show immediately — it is already on disk, it renders on the
// next frame, and it costs nothing. It is also invisible to every other device
// on the account, and gone after a reinstall or a cache eviction.
//
// So a picture has two lives: the local file, shown the moment it exists, and a
// Storage object that replaces it once the upload lands. The pantry item points
// at whichever is current, and because the swap is just a field on the document,
// the second device sees the picture appear without doing anything.
//
// Uploads are deliberately never awaited by anything the user is waiting on.
// The scan is already saved by the time one starts; a failed upload costs a
// thumbnail on the other device, which is exactly what the user had before.

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { storage } from '../config/firebaseClient';
import { apiFetch } from '../config/api';
import { ItemPhoto } from './pantry';

// A scan capture is cropped, not shown whole, so it has to keep enough
// resolution for one item's square to still look like that item. An item's own
// picture is already square and only ever fills a small tile.
const SCAN_MAX_EDGE = 1400;
const ITEM_MAX_EDGE = 600;
// An avatar renders at 78pt and never larger, so 400px covers a 3x screen with
// room to spare.
const AVATAR_MAX_EDGE = 400;
const COMPRESSION = 0.7;

/** Anything already served over the network is done — re-uploading it would
 *  make a second copy of a file that is already where it needs to be. */
export function isRemote(uri: string | null | undefined): boolean {
  return !!uri && /^https?:/i.test(uri);
}

/**
 * Re-encodes down to a sane size before it goes over the wire.
 *
 * Returns the *new* pixel dimensions, which matters more than it looks: an
 * item's box is stored as fractions of each axis, so it survives any resize —
 * but only if the dimensions stored beside it describe the image actually being
 * cropped. Keeping the original numbers here would offset every crop.
 */
async function shrink(photo: ItemPhoto, maxEdge: number): Promise<ItemPhoto> {
  const longEdge = Math.max(photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.uri);

  let width = photo.width;
  let height = photo.height;
  if (longEdge > maxEdge) {
    const scale = maxEdge / longEdge;
    width = Math.round(photo.width * scale);
    height = Math.round(photo.height * scale);
    context.resize({ width, height });
  }

  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: COMPRESSION });
  return { uri: saved.uri, width, height };
}

async function put(path: string, localUri: string): Promise<string> {
  // fetch() on a file:// URI is how a local file becomes a Blob in React
  // Native — there is no FileReader path to Storage's uploadBytes. It throws
  // for a file that has been evicted, which is a normal outcome here and is
  // caught by every caller.
  const response = await fetch(localUri);
  const blob = await response.blob();
  const object = ref(storage, path);
  await uploadBytes(object, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(object);
}

/**
 * One capture per scan, not one per item.
 *
 * Every row of a scan crops out of the same photo, so uploading it once and
 * pointing all of them at the result is the difference between one upload and a
 * dozen of the same bytes.
 */
export async function uploadScanPhoto(
  uid: string,
  scanId: string,
  photo: ItemPhoto
): Promise<ItemPhoto> {
  if (isRemote(photo.uri)) return photo;
  const small = await shrink(photo, SCAN_MAX_EDGE);
  const url = await put(`users/${uid}/scans/${scanId}.jpg`, small.uri);
  return { uri: url, width: small.width, height: small.height };
}

/**
 * A picture belonging to one item — hand-added rows, and anything attached from
 * the edit sheet.
 *
 * Dimensions are optional because a candidate only ever stored the URI of its
 * own picture. Without them the resize is capped by width alone, which
 * expo-image-manipulator scales the height to match; the only cost is that a
 * picture already smaller than the cap gets scaled up to it rather than left
 * alone. With them, a small picture is passed through untouched.
 */
export async function uploadItemPhoto(
  uid: string,
  itemId: string,
  photo: { uri: string; width?: number; height?: number }
): Promise<string> {
  if (isRemote(photo.uri)) return photo.uri;

  let uri = photo.uri;
  if (photo.width && photo.height) {
    uri = (await shrink({ uri, width: photo.width, height: photo.height }, ITEM_MAX_EDGE)).uri;
  } else {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: ITEM_MAX_EDGE });
    const image = await context.renderAsync();
    uri = (await image.saveAsync({ format: SaveFormat.JPEG, compress: COMPRESSION })).uri;
  }

  return put(`users/${uid}/items/${itemId}.jpg`, uri);
}

/**
 * The account's own picture.
 *
 * This one does not go to Firebase Storage, which this project has no bucket
 * for — it goes to Supabase, through our own server. The bytes travel as base64
 * in a JSON body for the same reason a scan's do: it reuses apiFetch, so the
 * Firebase token is attached and a failure arrives as an ApiError with the
 * server's own code on it.
 *
 * The server picks the object path from the token it verified, so nothing here
 * names a uid — a client that could choose its own path could choose someone
 * else's.
 */
export async function uploadProfilePhoto(photo: {
  uri: string;
  width?: number;
  height?: number;
}): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  const longEdge = Math.max(photo.width ?? 0, photo.height ?? 0);
  if (!longEdge || longEdge > AVATAR_MAX_EDGE) {
    // Width alone: expo-image-manipulator scales the height to match, which is
    // what an already-square crop wants anyway.
    context.resize({ width: AVATAR_MAX_EDGE });
  }

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: COMPRESSION,
    base64: true,
  });
  if (!saved.base64) throw new Error('Could not read that photo — try again.');

  const { url } = await apiFetch<{ url: string }>('/api/profile/photo', {
    imageBase64: saved.base64,
  });
  return url;
}

/** Deletes the stored object, not just the reference to it — the bucket is
 *  public, so a file left behind stays readable to anyone holding its URL. */
export async function removeProfilePhoto(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/profile/photo/remove', {});
}
