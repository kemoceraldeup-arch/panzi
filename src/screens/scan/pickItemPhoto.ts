// src/screens/scan/pickItemPhoto.ts
//
// Giving a hand-added item a picture of its own.
//
// Everything the scanner produces gets its thumbnail cropped out of the
// capture, but an item typed in by hand has no capture behind it. Without this
// it would be the one row in the pantry with a blank tile where every other row
// shows the food — which reads as a rendering fault rather than a fact about
// how the item was added.
//
// Two sources, because both are the obvious one depending on where the user is
// standing: the food is in front of them (camera) or they are tidying up an
// entry later (library).

import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/** What the picker hands back — the same shape the scanner's capture uses. */
export type PickedPhoto = { uri: string; width: number; height: number };

// Squared off at pick time so the tile it lands in doesn't have to crop it, and
// so what the user framed is what they get.
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  // Array form: MediaTypeOptions.Images is deprecated in SDK 54.
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  // These are thumbnails, never re-read by the model, so full resolution would
  // only cost storage and scroll performance.
  quality: 0.6,
};

function first(result: ImagePicker.ImagePickerResult): PickedPhoto | null {
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Asks where the picture should come from, then gets it.
 *
 * Permission refusals are reported as a sentence about what the user needs to
 * do, not as a thrown error — being told "no" by the OS is a normal outcome
 * here, and the item is perfectly addable without a photo.
 */
export async function pickItemPhoto(copy?: SourceCopy): Promise<PickedPhoto | null> {
  const source = await askSource(copy);
  if (!source) return null;

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera is off', 'Allow camera access in Settings to take a photo here.');
      return null;
    }
    return first(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Photos are off', 'Allow photo access in Settings to choose a picture here.');
    return null;
  }
  return first(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
}

/**
 * Asks whether a picture the user just chose should be read rather than kept.
 *
 * Offered, never assumed. Someone who photographed their whole counter for a
 * hand-added row almost certainly wanted a scan — but running one uninvited
 * would spend a model call they did not ask for and replace the row they were
 * halfway through typing.
 */
export function offerToScan(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Read this photo?',
      'If it has a few things in it, I can read them all and fill in the dates — rather than keeping it as one picture.',
      [
        { text: 'Just keep the picture', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Read it', onPress: () => resolve(true) },
      ]
    );
  });
}

/** Wording for the source prompt. The two sources are the same wherever this
 *  is used; only the sentence naming what the picture is for changes. */
export type SourceCopy = { title: string; message: string };

const ITEM_COPY: SourceCopy = { title: 'Add a picture', message: 'Where should it come from?' };

/** A three-way Alert rather than an ActionSheet, which is iOS-only. */
function askSource(copy: SourceCopy = ITEM_COPY): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) => {
    Alert.alert(copy.title, copy.message, [
      { text: 'Take a photo', onPress: () => resolve('camera') },
      { text: 'Choose from photos', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

/**
 * The same two sources, for the picture that stands in for the person rather
 * than for an item. Square crop is already what the options ask for, which is
 * exactly what a round avatar needs — anything else would be centre-cropped by
 * the frame and could cut the face off.
 */
export function pickProfilePhoto(): Promise<PickedPhoto | null> {
  return pickItemPhoto({
    title: 'Profile photo',
    message: 'Where should it come from?',
  });
}
