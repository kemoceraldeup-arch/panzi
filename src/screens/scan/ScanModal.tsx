// src/screens/scan/ScanModal.tsx
//
// Host for the item-scanner flow. Opens modally over whichever tab the user was
// on — this is not a tab push, and no tab bar is visible on any scan screen.
//
// Owns the phase machine, the candidate list, the write, and the scan record
// that outlives it. Each phase is a presentational screen taking callbacks.
//
// Recognition runs on the API (server/src/routes/scan.ts), which is where the
// OpenAI key lives — everything in an Expo bundle ships to the device, so
// the call cannot happen here.
//
// Two rules shape the machine:
//
// Every phase has a way out. A scan the user cannot abandon is a scan that
// traps them, and the exits mean different things: closing the modal abandons
// the read, collapsing an edit card goes back to the list.
//
// The flow does not end on a success screen. It ends in the pantry, with the
// batch marked and an Undo still live — which is why `onAdded` hands its ids
// back to MainTabs rather than this modal congratulating the user and closing.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import ScanCameraScreen from './ScanCameraScreen';
import ScanReadingScreen, { ScanRegion } from './ScanReadingScreen';
import ScanReviewScreen from './ScanReviewScreen';
import ScanFreshnessScreen from './ScanFreshnessScreen';
import ScanErrorScreen, { ScanErrorCause } from './ScanErrorScreen';
import ScanHistoryScreen from './ScanHistoryScreen';
import ScanPermissionScreen from './ScanPermissionScreen';
import { addPantryItems, updatePantryItem, NewPantryItem } from '../../services/pantry';
import {
  ScanCandidate,
  blankCandidate,
  candidateToItem,
  markConfirmed,
  needsALook,
  withUserRipeness,
} from '../../services/scan';
import { RecognitionError, recognize } from '../../services/recognition';
import {
  ScanRecord,
  newScanId,
  publishScanPhotos,
  saveScan,
  subscribeToScans,
  updateScanCandidates,
} from '../../services/scans';
import { RipenessStage } from '../../utils/ripeness';
import { getDaysLeft } from '../../utils/freshness';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { UserProfile } from '../../services/profile';
import { checkItemConflicts } from '../../services/dietCheck';
import ConflictAlertModal, { ConflictingItem } from '../../components/ConflictAlertModal';

export type ScanPhase =
  | 'permission'
  | 'aiming' // 01
  | 'reading' // 02
  | 'review' // 03 / 04
  | 'freshness' // 05
  | 'error' // 06 / 07
  | 'history'; // 09

type Props = {
  visible: boolean;
  uid: string;
  /** 'manual' opens straight onto a review page holding one blank row — the
   *  "add by hand" entry from the pantry, which no longer has a form of its
   *  own. */
  startMode?: 'camera' | 'manual';
  /** Opens straight onto a past scan, skipping the camera and the history
   *  list. How the "finish this scan" card on Home gets the user to the rows
   *  that still need a date in one tap rather than four. */
  startScan?: ScanRecord | null;
  onClose: () => void;
  /** Reports a landed batch so the pantry can mark the rows and offer Undo.
   *  `note` names what to eat first, when the batch had anything urgent. */
  onAdded: (count: number, ids: string[], note: string | null) => void;
  /** For the diet/allergy conflict check before a batch is saved — see submit(). */
  profile: UserProfile;
};

type Capture = { uri: string; width: number; height: number };

// The progress bar can't track a single round trip it gets no updates from, so
// it eases toward this ceiling while the call is in flight and only completes
// when the answer lands. Stopping short of the end is the honest shape: the bar
// is saying "still working", not "nearly done".
const PROGRESS_CEILING = 0.92;
const PROGRESS_TICK_MS = 220;
const PROGRESS_STEP = 0.045;

// Once the answer is in, the rows are dealt out at this rate so they can be
// read as they land. An entrance for real data, not a fake of one — every row
// shown is a row already received.
const ROW_REVEAL_MS = 140;

// How long the finished read holds on screen with its boxes drawn before the
// review page takes over.
const REVEAL_HOLD_MS = 600;

// Only worth naming something in the Undo snackbar if it needs eating within
// this many days.
const URGENT_NOTE_DAYS = 3;

/**
 * "avocados go first" — the soonest-expiring thing in the batch, when it is
 * urgent enough to be worth saying.
 *
 * Returns null rather than reaching for something to say when nothing in the
 * batch needs eating this week. A snackbar that always names an item trains the
 * user to ignore the one time it matters.
 */
function urgentNote(items: ScanCandidate[]): string | null {
  const dated = items
    .filter((c) => c.expiryDate)
    .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));

  const first = dated[0];
  if (!first) return null;

  const days = getDaysLeft(first.expiryDate);
  if (days === null || days > URGENT_NOTE_DAYS) return null;

  return `${first.name.toLowerCase()} ${days <= 0 ? 'needs eating today' : 'goes first'}`;
}

export default function ScanModal({
  visible,
  uid,
  startMode = 'camera',
  startScan = null,
  onClose,
  onAdded,
  profile,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();

  // True once the native Modal below has actually finished its slide-in —
  // `visible` flips the instant the modal is *told* to open, but the
  // transition itself takes a beat, and a touch that lands on a freshly
  // mounted TextInput during that beat gets eaten by the in-flight
  // transition rather than focusing the field. This is what "add by hand"
  // below waits on, so the Name field's first real tap isn't racing the
  // animation the way it was — see that effect's own comment.
  const [modalShown, setModalShown] = useState(false);

  // Reset the instant the modal is told to close, not on some later cleanup
  // — the next open (a fresh "Add item" tap) needs to wait on a real onShow
  // of its own, not read a stale true left over from the last time.
  useEffect(() => {
    if (!visible) setModalShown(false);
  }, [visible]);

  // Candidates that conflict with the user's diet/allergies, held until they
  // choose Cancel or Add anyway on ConflictAlertModal — see submit().
  const [pendingConflicts, setPendingConflicts] = useState<ConflictingItem[] | null>(null);

  // Manual mode starts on the review phase directly rather than on 'aiming'
  // and switching over once modalShown fires — starting at 'aiming' meant the
  // camera screen actually mounted and rendered for the beat before that
  // effect ran, a visible flash of the scan screen behind "Add item"'s
  // slide-in. MainTabs remounts this component fresh (a new `key`) for every
  // open, so reading startMode once here at mount is safe.
  const [phase, setPhase] = useState<ScanPhase>(startMode === 'manual' ? 'review' : 'aiming');
  const [photo, setPhoto] = useState<Capture | null>(null);
  const [sceneLabel, setSceneLabel] = useState(startMode === 'manual' ? 'Typed in' : 'Scan');
  // Empty until a read produces something, except in manual mode, which starts
  // with the one blank row "add by hand" edits — see the modalShown effect
  // below for why editingId still waits on the modal's slide-in to finish.
  const [candidates, setCandidates] = useState<ScanCandidate[]>(() =>
    startMode === 'manual' ? [blankCandidate()] : []
  );

  const [progress, setProgress] = useState(0);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  const [regions, setRegions] = useState<ScanRegion[]>([]);
  // Just what this read produced. Held apart from `candidates` because a read
  // can now be asked to join rows that are already on the review page — the
  // reading screen must show what is arriving, not what the user typed earlier.
  const [readRows, setReadRows] = useState<ScanCandidate[]>([]);
  // The read as it arrived, frozen. Never edited, only ever written to the scan
  // record so the corrections can be diffed against it later — see
  // services/accuracy.ts. `candidates` is the same data under active editing;
  // this is the copy that has to survive that editing untouched.
  const [originalRead, setOriginalRead] = useState<ScanCandidate[]>([]);

  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every new read and by Cancel. A response whose id no longer
  // matches is a read the user has already walked away from — the call can't be
  // aborted mid-flight, so its answer is dropped on arrival instead.
  const readId = useRef(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [freshnessId, setFreshnessId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorCause, setErrorCause] = useState<ScanErrorCause>('unrecognised');
  // Set by "Retake with torch on", so the camera opens already lit.
  const [torchNext, setTorchNext] = useState(false);

  // The scan record this session is attached to. Non-null once a batch has
  // landed, or once an old scan has been reopened from history — which is what
  // lets corrections write back to the same document instead of forking a new
  // one every time the user finishes something off.
  const [scanId, setScanId] = useState<string | null>(null);
  const [reopened, setReopened] = useState(false);

  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Snapshot of the review page's state at the moment Retake was pressed, so
  // Close on the camera that follows can put it back rather than dropping the
  // user all the way out to the pantry with nothing to show for it. Null
  // whenever there is nothing worth restoring — Retake pressed from the error
  // screen or from mid-read, where there was no finished batch to return to.
  const preRetake = useRef<{
    photo: Capture | null;
    candidates: ScanCandidate[];
    regions: ScanRegion[];
    sceneLabel: string;
    editingId: string | null;
    scanId: string | null;
    reopened: boolean;
    originalRead: ScanCandidate[];
  } | null>(null);

  // Subscribed for as long as the modal is mounted rather than only while the
  // history screen is open: opening history should show the list, not a spinner
  // over a round trip the app had every opportunity to make earlier.
  useEffect(() => {
    if (!visible) return;
    return subscribeToScans(
      uid,
      (records) => {
        setHistory(records);
        setHistoryLoading(false);
      },
      () => setHistoryLoading(false)
    );
  }, [uid, visible]);

  const stopRead = useCallback(() => {
    readId.current += 1;
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    if (revealTimer.current) {
      clearInterval(revealTimer.current);
      revealTimer.current = null;
    }
    if (handoffTimer.current) {
      clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
  }, []);

  // Any unmount with a read in flight would otherwise leave timers ticking
  // against state that no longer exists.
  useEffect(() => stopRead, [stopRead]);

  // "Add by hand" from the pantry opens the same review page with one empty row
  // already being edited. One item form in the app, not two that drift. The
  // blank row itself is created eagerly (see the candidates initializer above)
  // so the review page — not the camera — is what's behind the modal's
  // slide-in from the very first frame; only *editingId* waits here.
  //
  // Gated on modalShown rather than visible — see that state's own comment.
  // Focusing the Name TextInput the instant `visible` flips true meant the
  // field became a tap target while the modal's own slide-in was still
  // playing, so the very first tap — the one "type it in" exists for — landed
  // mid-transition and was swallowed by it rather than focusing the input.
  // Waiting for the modal to actually finish presenting means the field is
  // genuinely interactive by the time there is anything on screen to tap.
  useEffect(() => {
    if (!modalShown || startMode !== 'manual') return;
    setEditingId((current) => current ?? candidates[0]?.id ?? null);
    // candidates is intentionally not a dependency — this only ever needs to
    // read the blank row created at mount, not re-run when editing adds more.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalShown, startMode]);

  // Opened straight onto a past scan. Keyed on the scan's id rather than the
  // object, because the record arrives from a live Firestore subscription and
  // gets a fresh identity on every snapshot — depending on the object itself
  // would re-open (and so reset) the scan under the user's fingers each time
  // anything in the collection changed.
  const openedScanId = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      openedScanId.current = null;
      return;
    }
    if (!startScan || openedScanId.current === startScan.id) return;
    openedScanId.current = startScan.id;
    openScan(startScan);
    // openScan is recreated every render; the ref guard above is what makes
    // this run once per scan rather than on every commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, startScan]);

  // The permission ask is Panzi's own screen shown *before* the system sheet, so
  // a "no" here costs nothing. Only switches into it — never out — so a grant
  // mid-flow doesn't yank the user off whatever they were doing.
  useEffect(() => {
    if (!visible || !permission || startMode !== 'camera' || startScan) return;
    if (!permission.granted && phase === 'aiming') setPhase('permission');
  }, [visible, permission, phase, startMode, startScan]);

  // The effect above runs *after* the first render, and `permission` is null for
  // the first frame while the hook reads the current status. Deciding whether to
  // mount the camera from phase alone therefore mounts it for one frame with
  // permission unknown or refused — which is what crashed the app when camera
  // access had been revoked in Settings.
  const cameraReady = !!permission?.granted;

  /**
   * Resize the capture, send it, and route the answer.
   *
   * Nothing about the result is shown before it exists: no climbing count, no
   * boxes, no rows. What happens after it arrives is a staged reveal of data
   * already in hand.
   *
   * `keep` is the rows the read should land alongside — empty for a fresh scan,
   * and the rest of the batch when the user asks Panzi to read a photo they
   * attached to a hand-added item. Passing them in rather than reading state
   * inside means the list can't shift under a read that is already in flight.
   */
  async function runRead(capture: Capture, keep: ScanCandidate[] = []) {
    stopRead();
    const id = readId.current;

    setProgress(0);
    setFoundCount(null);
    setRevealCount(0);
    setRegions([]);
    setReadRows([]);
    setPhase('reading');

    progressTimer.current = setInterval(() => {
      setProgress((prev) => Math.min(PROGRESS_CEILING, prev + PROGRESS_STEP));
    }, PROGRESS_TICK_MS);

    let result;
    try {
      result = await recognize(capture);
    } catch (err) {
      if (readId.current !== id) return;
      stopRead();
      // A failure to *reach* the scanner isn't a failure to read the photo, so
      // it gets an alert and the camera back rather than the error screen's
      // "hold it steadier" advice, which would be wrong and unhelpful.
      Alert.alert(
        'Scan failed',
        err instanceof RecognitionError ? err.message : 'Something went wrong — try again.'
      );
      setPhase('aiming');
      return;
    }

    if (readId.current !== id) return;
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgress(1);

    if (!result.readable) {
      // "Nothing I could recognise as food" is not a fault in the photo, so it
      // does not get the error screen's hold-it-steadier advice — it gets the
      // same popup a failed scan gets, saying the one thing that actually fixes
      // it. The photo-fault causes still go to the screen, which shows the
      // user their own shot as evidence.
      if (result.cause === 'unrecognised') {
        stopRead();
        Alert.alert('No food found', 'Please make sure you are scanning a food item.');
        setPhase('aiming');
        return;
      }
      setErrorCause(result.cause);
      setPhase('error');
      return;
    }

    const read = result.candidates;
    setSceneLabel(result.sceneLabel);
    setFoundCount(read.length);
    setReadRows(read);
    // Appended, not replaced: a read that joins an existing batch adds its own
    // claims to the ones already made, and both sets get scored.
    setOriginalRead((prev) => [...prev.filter((c) => keep.some((k) => k.id === c.id)), ...read]);
    setRegions(
      read
        .map((c) => ({
          id: c.id,
          rect: result.boxes[c.id],
          label: c.name,
          status: needsALook(c) ? ('candidate' as const) : ('confirmed' as const),
        }))
        // The model returns zeroes when it can't localise something; an empty
        // rect would draw as a dot in the corner.
        .filter((region) => region.rect && region.rect.width > 0 && region.rect.height > 0)
    );

    // Deal the rows out, then hand over.
    let shown = 0;
    revealTimer.current = setInterval(() => {
      if (readId.current !== id) return;
      shown += 1;
      setRevealCount(shown);
      if (shown >= read.length && revealTimer.current) {
        clearInterval(revealTimer.current);
        revealTimer.current = null;
        handoffTimer.current = setTimeout(() => {
          if (readId.current !== id) return;
          setCandidates([...keep, ...read]);
          setPhase('review');
        }, REVEAL_HOLD_MS);
      }
    }, ROW_REVEAL_MS);
  }

  function capture(shot: Capture) {
    // A real new photo — whatever Retake was standing in front of is gone
    // for good now, not just cleared from the working state.
    preRetake.current = null;
    setPhoto(shot);
    setScanId(null);
    setReopened(false);
    void runRead(shot);
  }

  /**
   * Reads a photo the user attached to a hand-added row.
   *
   * The blank row is dropped and the read takes its place — they were reaching
   * for a scan, not a thumbnail. Everything else in the batch is kept, because
   * this can happen halfway through checking a list that already has items in
   * it.
   */
  function scanAttachedPhoto(id: string, shot: Capture) {
    const keep = candidates.filter((c) => c.id !== id);
    setPhoto(shot);
    setEditingId(null);
    void runRead(shot, keep);
  }

  function patch(id: string, changes: Partial<ScanCandidate>) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  }

  function confirmItem(id: string) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? markConfirmed(c) : c)));
    setEditingId(null);
  }

  function removeItem(id: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
    setEditingId(null);
  }

  function pickRipeness(id: string, stage: RipenessStage) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? withUserRipeness(c, stage) : c)));
  }

  function addByHand() {
    const blank = blankCandidate();
    setCandidates((prev) => [...prev, blank]);
    setEditingId(blank.id);
    setPhase('review');
  }

  function reset() {
    stopRead();
    preRetake.current = null;
    setPhase('aiming');
    setPhoto(null);
    setSceneLabel('Scan');
    setCandidates([]);
    setEditingId(null);
    setFreshnessId(null);
    setProgress(0);
    setFoundCount(null);
    setRevealCount(0);
    setRegions([]);
    setReadRows([]);
    setOriginalRead([]);
    setScanId(null);
    setReopened(false);
    setTorchNext(false);
  }

  /**
   * Back to the camera. The previous read is cleared from the working state,
   * but not actually thrown away yet — it's kept in `preRetake` so Close on
   * the camera that follows can restore it. Only a new capture, or leaving
   * the flow some other way, discards it for good.
   */
  function retake(withTorch = false) {
    // Nothing to come back to — Retake from the error screen or a cancelled
    // read never had a finished batch on screen.
    preRetake.current =
      candidates.length > 0
        ? { photo, candidates, regions, sceneLabel, editingId, scanId, reopened, originalRead }
        : null;

    stopRead();
    setPhoto(null);
    setCandidates([]);
    setRegions([]);
    setFoundCount(null);
    setRevealCount(0);
    setReadRows([]);
    setEditingId(null);
    setScanId(null);
    setReopened(false);
    setTorchNext(withTorch);
    setPhase('aiming');
  }

  /** Close on the camera screen, right after a Retake with something to go
   *  back to: restores the pre-retake review state instead of leaving the
   *  flow entirely. */
  function cancelRetake() {
    const prev = preRetake.current;
    if (!prev) return false;
    preRetake.current = null;
    setPhoto(prev.photo);
    setCandidates(prev.candidates);
    setRegions(prev.regions);
    setSceneLabel(prev.sceneLabel);
    setEditingId(prev.editingId);
    setScanId(prev.scanId);
    setReopened(prev.reopened);
    setOriginalRead(prev.originalRead);
    setPhase('review');
    return true;
  }

  /**
   * The review page's back control, which only appears on a typed row.
   *
   * Where it goes depends on where the row came from: "Type it in" sits on the
   * camera screen, so back means that screen. "Add an item by hand" is reached
   * from the pantry with no camera involved, so back means out of the scanner
   * entirely — handleClose already asks before binning anything.
   */
  function goBack() {
    if (startMode === 'manual') {
      handleClose();
      return;
    }
    const typed = candidates.some((c) => c.name.trim().length > 0);
    if (!typed) {
      retake();
      return;
    }
    Alert.alert('Discard what you typed?', 'The camera will open with nothing kept.', [
      { text: 'Keep typing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => retake() },
    ]);
  }

  function handleClose() {
    // Closing the camera right after a Retake that had a finished batch
    // behind it: go back to that batch instead of leaving the flow. Nothing
    // has been thrown away for good yet — `retake` only cleared it from the
    // working state, not from `preRetake`.
    if (cancelRetake()) return;

    // Checking through a read is the user's work. Closing on a stray tap and
    // silently binning it would be the worst outcome in this flow, so a batch
    // under review asks first. A scan reopened from history has nothing to lose
    // — its items are already in the pantry.
    if (candidates.length > 0 && !reopened) {
      Alert.alert('Discard this scan?', 'Nothing will be added to your pantry.', [
        { text: 'Keep checking', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            reset();
            onClose();
          },
        },
      ]);
      return;
    }
    reset();
    onClose();
  }

  /**
   * Refuses to save a row with no name, and points at the offender.
   *
   * Quietly dropping it would be worse than blocking: the user typed a row,
   * pressed the button, and got a batch one item short with no explanation.
   */
  function blockedByBlankRow(): boolean {
    const blank = candidates.find((c) => c.name.trim().length === 0);
    if (!blank) return false;
    setEditingId(blank.id);
    Alert.alert('One row still needs a name', "I can't put something in the pantry unnamed.");
    return true;
  }

  /**
   * Saves corrections made to a scan reopened from history.
   *
   * Writes through to the pantry, not just to the scan record. The row the user
   * came back to fix is an item on their shelves that has been sitting there
   * with no date; updating only the history document would leave it exactly as
   * it was and quietly break the promise that sent them here.
   */
  async function saveFixes() {
    if (!scanId) return;
    setSaving(true);
    try {
      const existing = candidates.filter((c) => c.pantryItemId);
      const added = candidates.filter((c) => !c.pantryItemId);

      await Promise.all(
        existing.map((c) => {
          const fields: Partial<NewPantryItem> = candidateToItem(c, photo);
          // A scan reopened from history often has no usable capture any more —
          // the file was cleared, or the record predates the dimensions being
          // stored. Writing the resulting nulls would wipe the picture the item
          // already has, so the picture keys come out of the patch entirely:
          // there is nothing to replace it with, and null here would be an
          // assertion rather than an absence.
          if (!fields.scanPhoto && !fields.photoUri) {
            delete fields.scanPhoto;
            delete fields.box;
            delete fields.photoUri;
          }
          return updatePantryItem(c.pantryItemId as string, fields);
        })
      );

      // Anything added by hand while finishing the scan off is a genuine new
      // item and joins the pantry properly.
      let saved = candidates;
      if (added.length > 0) {
        const ids = await addPantryItems(uid, added.map((c) => candidateToItem(c, photo)));
        const byId = new Map(added.map((c, i) => [c.id, ids[i]]));
        saved = candidates.map((c) =>
          byId.has(c.id) ? { ...c, pantryItemId: byId.get(c.id) as string } : c
        );
      }

      await updateScanCandidates(scanId, saved, originalRead);

      // Same as the first save. A scan finished off later is often the first
      // time its capture has been anywhere near a network — the original submit
      // may have been offline, or the upload may simply have failed.
      void publishScanPhotos(
        uid,
        scanId,
        photo,
        saved
          .filter((c) => c.pantryItemId)
          .map((c) => ({ itemId: c.pantryItemId as string, ownPhotoUri: c.photoUri }))
      );

      reset();
      onClose();
    } catch (err: any) {
      Alert.alert('Could not save those fixes', err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Writes the batch, records the scan, and gets out of the way.
   *
   * The scan record is written after the pantry batch and its failure is
   * swallowed: the items are already saved at that point, and an alert about
   * history failing would be telling the user their scan went wrong when it
   * didn't. The cost is a scan missing from history, which is recoverable; the
   * alternative is alarming someone about a success.
   */
  async function submit() {
    if (saving || candidates.length === 0 || blockedByBlankRow()) return;

    // Reopened from history: those rows already exist in the pantry, so this is
    // a write-back rather than a second insert. Nothing new is being added, so
    // there is nothing to run the conflict check against.
    if (reopened && scanId) {
      await saveFixes();
      return;
    }

    const conflicting: ConflictingItem[] = candidates
      .map((c) => ({ name: c.name, conflicts: checkItemConflicts(c.name, profile.dietary, profile.allergies) }))
      .filter((entry) => entry.conflicts.length > 0);
    if (conflicting.length > 0) {
      setPendingConflicts(conflicting);
      return;
    }

    await commitBatch();
  }

  /** The actual write, split from submit() so ConflictAlertModal's "Add
   *  anyway" can call straight through to it without re-running the check it
   *  was just shown for. */
  async function commitBatch() {
    setSaving(true);
    try {
      const ids = await addPantryItems(uid, candidates.map((c) => candidateToItem(c, photo)));
      // Index-aligned only here, at the moment of the write, where the two
      // arrays provably came from the same map.
      const saved = candidates.map((c, i) => ({ ...c, pantryItemId: ids[i] }));

      const id = scanId ?? newScanId();
      try {
        await saveScan(uid, id, {
          sceneLabel,
          photoUri: photo?.uri ?? null,
          // Without these the crops can't be reconstructed when the scan is
          // reopened; see ScanRecord.
          photoWidth: photo?.width ?? null,
          photoHeight: photo?.height ?? null,
          original: originalRead,
          candidates: saved,
          addedItemIds: ids,
        });
      } catch {
        // History is a convenience over a completed write; see above.
      }

      // Uploads run after the write and are not awaited — the batch is already
      // on the shelves and the local files already render here. This is what
      // makes the pictures show up on the account's other devices, which have
      // no local files to fall back on.
      void publishScanPhotos(
        uid,
        id,
        photo,
        saved.map((c, i) => ({ itemId: ids[i], ownPhotoUri: c.photoUri }))
      );

      const note = urgentNote(candidates);
      // Close first, then report: the pantry behind is where the batch and its
      // Undo live, and both would be hidden under the modal the other way round.
      reset();
      onClose();
      onAdded(ids.length, ids, note);
    } catch (err: any) {
      // Deliberately stays on the review page — the user's corrections are the
      // work, and dropping them because the network blipped would mean checking
      // the whole batch again.
      Alert.alert('Could not add those', err.message);
    } finally {
      setSaving(false);
    }
  }

  /** Opens a past scan back onto the review page to finish it off. */
  function openScan(record: ScanRecord) {
    stopRead();
    setScanId(record.id);
    setReopened(true);
    setCandidates(record.candidates);
    // Carried forward so corrections made now are still scored against what the
    // scanner originally claimed — not against the half-corrected state the
    // user left behind last time.
    setOriginalRead(record.original);
    setSceneLabel(record.sceneLabel);
    setPhoto(
      record.photoUri
        ? {
            uri: record.photoUri,
            // Zeroes on scans written before the dimensions were stored. The
            // crop treats that as "no size" and falls back to a plain tile
            // rather than dividing by it.
            width: record.photoWidth ?? 0,
            height: record.photoHeight ?? 0,
          }
        : null
    );
    setEditingId(record.candidates.find(needsALook)?.id ?? null);
    setPhase('review');
  }

  async function allowCamera() {
    // Once the OS has recorded a permanent denial it stops showing the sheet,
    // so the only honest next step is Settings.
    if (permission && !permission.canAskAgain) {
      Linking.openSettings();
      return;
    }
    const next = await requestPermission();
    if (next.granted) setPhase('aiming');
  }

  const blocked = !!permission && !permission.canAskAgain && !permission.granted;
  const freshnessItem = candidates.find((c) => c.id === freshnessId) ?? null;
  // Every screen in the flow is now cream. The camera is a window on a light
  // page rather than the page itself, so the status bar never flips.
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      // Marks the slide-in as actually finished — see modalShown's own
      // comment for why "add by hand" waits on this rather than on
      // `visible` alone.
      onShow={() => setModalShown(true)}
      statusBarTranslucent
    >
      <StatusBar barStyle={colors.statusBar} />
      {/* A Modal is its own root view and doesn't inherit the app's
          SafeAreaProvider, so useSafeAreaInsets inside would read zeroes and the
          header would slide under the notch. Seeded with initialWindowMetrics so
          the first frame has real insets instead of measuring and reflowing. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.container}>
          {phase === 'permission' && (
            <ScanPermissionScreen
              blocked={blocked}
              onClose={handleClose}
              onAllow={allowCamera}
              onTypeInstead={addByHand}
            />
          )}

          {phase === 'aiming' && cameraReady && (
            <ScanCameraScreen
              initialTorch={torchNext}
              onClose={handleClose}
              onCapture={capture}
              onOpenHistory={() => setPhase('history')}
              onAddByHand={addByHand}
            />
          )}

          {phase === 'reading' && (
            <ScanReadingScreen
              photo={photo}
              regions={regions}
              foundCount={foundCount}
              revealed={readRows.slice(0, revealCount)}
              progress={progress}
              onCancel={() => retake()}
            />
          )}

          {phase === 'review' && (
            <ScanReviewScreen
              candidates={candidates}
              photo={photo}
              editingId={editingId}
              saving={saving}
              subtitle={reopened ? sceneLabel : undefined}
              primaryLabel={reopened ? 'Save these fixes' : undefined}
              onClose={handleClose}
              onBack={goBack}
              onRetake={() => retake()}
              onEdit={(candidate) => setEditingId(candidate.id)}
              onCollapse={() => setEditingId(null)}
              onPatch={patch}
              onConfirmItem={confirmItem}
              onRemove={removeItem}
              onOpenFreshness={(candidate) => {
                setFreshnessId(candidate.id);
                setPhase('freshness');
              }}
              onAddByHand={addByHand}
              onScanAttached={scanAttachedPhoto}
              onSubmit={submit}
            />
          )}

          {phase === 'freshness' && freshnessItem && (
            <ScanFreshnessScreen
              candidate={freshnessItem}
              photo={photo}
              onBack={() => {
                setFreshnessId(null);
                setPhase('review');
              }}
              onPickStage={(stage) => pickRipeness(freshnessItem.id, stage)}
            />
          )}

          {phase === 'error' && (
            <ScanErrorScreen
              cause={errorCause}
              photoUri={photo?.uri ?? null}
              onClose={handleClose}
              onRetry={retake}
              onTypeInstead={addByHand}
            />
          )}

          {phase === 'history' && (
            <ScanHistoryScreen
              scans={history}
              loading={historyLoading}
              onClose={() => setPhase('aiming')}
              onOpen={openScan}
            />
          )}
        </View>
      </SafeAreaProvider>

      <ConflictAlertModal
        visible={pendingConflicts !== null}
        items={pendingConflicts ?? []}
        onCancel={() => setPendingConflicts(null)}
        onAddAnyway={() => {
          setPendingConflicts(null);
          void commitBatch();
        }}
      />
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
}));