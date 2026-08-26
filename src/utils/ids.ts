// src/utils/ids.ts
//
// Document ids, generated on the phone.
//
// Firestore handed these out client-side and the app leaned on that harder than
// it looks: the scan modal wires up "N items added · Undo" the moment a batch
// is approved, and a scan record is updated in place by an id chosen when it
// was first saved. Waiting for the server to mint an id would mean waiting for
// a round trip before the interface could respond to a tap.
//
// So the ids stay client-side and Mongo takes them as strings. Twenty-four hex
// characters is the same width as an ObjectId, which keeps anything reading the
// database by hand looking normal.

const HEX = '0123456789abcdef';

/**
 * A new document id.
 *
 * Math.random is not a cryptographic source, and it does not need to be —
 * nothing is guessed from these. What matters is that two ids generated on two
 * devices in the same second do not collide, and 96 bits of width settles that
 * comfortably for a pantry.
 */
export function newId(): string {
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}
