jest.mock('../pantry', () => ({}));

import { ScanCandidate, blankCandidate, splitByAttention } from '../scan';

function row(id: string, patch: Partial<ScanCandidate>): ScanCandidate {
  return { ...blankCandidate(), id, name: id, ...patch };
}

describe('splitByAttention', () => {
  const unsure = row('chicken', { nameUnsure: true });
  const settled = row('beef', { editedByUser: true });

  it('sorts by whether a row needs a look', () => {
    const { needsLook, looksRight } = splitByAttention([unsure, settled]);
    expect(needsLook.map((c) => c.id)).toEqual(['chicken']);
    expect(looksRight.map((c) => c.id)).toEqual(['beef']);
  });

  it('keeps an open card in the group it was opened in after an edit settles it', () => {
    const edited = { ...unsure, editedByUser: true };
    const { needsLook, looksRight } = splitByAttention([edited, settled], {
      id: 'chicken',
      needsLook: true,
    });
    expect(needsLook.map((c) => c.id)).toEqual(['chicken']);
    expect(looksRight.map((c) => c.id)).toEqual(['beef']);
  });
});
