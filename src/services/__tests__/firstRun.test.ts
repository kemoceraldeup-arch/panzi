// src/services/__tests__/firstRun.test.ts
//
// Home's "Nothing on your shelves yet" welcome is for a new user only. Once
// this phone has seen the account with food on its shelves (or with anything
// in its History), an empty pantry shows the normal Home instead.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasHadPantry, rememberHadPantry, showWelcome, shouldRemember } from '../firstRun';
import { EMPTY_HISTORY } from '../removals';

jest.mock('../../config/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../live', () => ({ refreshKey: jest.fn(), subscribeToKey: jest.fn() }));
jest.mock('../pantry', () => ({ refreshPantry: jest.fn() }));

beforeEach(() => AsyncStorage.clear());

describe('showWelcome', () => {
  it('shows for an empty pantry this phone has never seen stocked', () => {
    expect(showWelcome(0, false)).toBe(true);
  });

  it('does not show once the phone remembers food on the shelves', () => {
    expect(showWelcome(0, true)).toBe(false);
  });

  it('does not show on a stocked pantry', () => {
    expect(showWelcome(4, false)).toBe(false);
  });

  it('waits while either answer is still loading', () => {
    expect(showWelcome(null, false)).toBe(false);
    expect(showWelcome(0, null)).toBe(false);
  });
});

describe('shouldRemember', () => {
  const withRemovals = { ...EMPTY_HISTORY, counts: { ...EMPTY_HISTORY.counts, spoiled: 1 } };

  it('remembers once the pantry has food in it', () => {
    expect(shouldRemember(2, null)).toBe(true);
  });

  it('remembers an account whose History already has removals', () => {
    expect(shouldRemember(0, withRemovals)).toBe(true);
  });

  it('does not remember an empty pantry with an empty History', () => {
    expect(shouldRemember(0, EMPTY_HISTORY)).toBe(false);
    expect(shouldRemember(null, null)).toBe(false);
  });
});

describe('the phone remembers per account', () => {
  it('is false until remembered, then true', async () => {
    expect(await hasHadPantry('u1')).toBe(false);
    await rememberHadPantry('u1');
    expect(await hasHadPantry('u1')).toBe(true);
  });

  it('keeps accounts apart', async () => {
    await rememberHadPantry('u1');
    expect(await hasHadPantry('u2')).toBe(false);
  });
});
