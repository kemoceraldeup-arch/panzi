// src/components/chat/useVoiceInput.ts
//
// The chat microphone: record, notice when the person has stopped talking,
// stop by itself, and hand back text.
//
// "Stopped talking" is read off the recorder's level meter. Silence can't be
// a fixed number — a quiet bedroom and a kitchen with the extractor on differ
// by 20dB — so the quietest level heard so far stands in for the room, and
// speech is anything well above it. Once there has been speech, a stretch of
// room-level quiet ends the recording. No speech at all within the first few
// seconds ends it too, rather than leaving the mic open on a phone someone
// put down.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { transcribe, VoiceError } from '../../services/voice';

export type VoiceState = 'idle' | 'listening' | 'transcribing';

/** Mono and modest: this is speech for a transcriber, not music. */
const OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
};

const POLL_MS = 80;
/** How far above the room a level has to be to count as a voice. */
const SPEECH_ABOVE_ROOM = 14;
/** And how close to the room counts as quiet again. */
const QUIET_ABOVE_ROOM = 7;
/** Quiet this long after speaking = finished. Long enough for a breath
 *  mid-sentence, short enough that the wait after the last word isn't felt. */
const END_OF_SPEECH_MS = 1400;
/** No room is ever treated as quieter than this. */
const ROOM_FLOOR_DB = -62;
const NOTHING_HEARD_MS = 7000;
const MAX_MS = 60_000;

type Options = {
  onText: (text: string) => void;
  onError: (message: string) => void;
};

export function useVoiceInput({ onText, onError }: Options) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, POLL_MS);
  const [state, setState] = useState<VoiceState>('idle');
  const stateRef = useRef<VoiceState>('idle');
  stateRef.current = state;

  const run = useRef({
    startedAt: 0,
    room: Infinity,
    heardSpeech: false,
    quietSince: null as number | null,
    /** Some devices report no meter at all; then only the buttons and the
     *  time limit can end a recording, and nothing should be thrown away for
     *  "no speech heard". */
    metered: false,
  }).current;

  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };

  const finish = useCallback(
    async (keep: boolean, reason?: string) => {
      if (stateRef.current !== 'listening') return;
      const willTranscribe = keep && (run.heardSpeech || !run.metered);
      stateRef.current = willTranscribe ? 'transcribing' : 'idle';
      setState(stateRef.current);

      try {
        await recorder.stop();
      } catch {}
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});

      if (!willTranscribe) {
        if (reason) callbacks.current.onError(reason);
        return;
      }
      const uri = recorder.uri;
      if (!uri) {
        setState('idle');
        callbacks.current.onError('Couldn’t save the recording. Try again.');
        return;
      }
      try {
        const text = await transcribe(uri);
        if (text) callbacks.current.onText(text);
        else callbacks.current.onError('Didn’t catch any words. Try again a little closer.');
      } catch (err) {
        callbacks.current.onError(
          err instanceof VoiceError ? err.message : 'Couldn’t turn that into text. Try again.'
        );
      } finally {
        stateRef.current = 'idle';
        setState('idle');
      }
    },
    [recorder, run]
  );

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        callbacks.current.onError('Allow microphone access in Settings to talk to Panzi.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      callbacks.current.onError('Couldn’t start the microphone. Try again.');
      return;
    }
    run.startedAt = Date.now();
    run.room = Infinity;
    run.heardSpeech = false;
    run.quietSince = null;
    run.metered = false;
    stateRef.current = 'listening';
    setState('listening');
  }, [recorder, run]);

  /** The ✓ button: stop now and transcribe what there is. */
  const stop = useCallback(() => finish(true), [finish]);
  /** The ✕ button: throw the recording away. */
  const cancel = useCallback(() => finish(false), [finish]);

  // The end-of-speech watch, on every meter reading.
  useEffect(() => {
    if (state !== 'listening') return;
    const now = Date.now();
    const elapsed = now - run.startedAt;
    const level = status.metering;

    if (typeof level === 'number' && Number.isFinite(level) && level > -159) {
      run.metered = true;
      // Floored: one near-silent reading as the mic wakes up would otherwise
      // set the "room" so low that ordinary background noise counts as a
      // voice, and the recording would never end on its own.
      run.room = Math.min(run.room, Math.max(level, ROOM_FLOOR_DB));
      if (level > run.room + SPEECH_ABOVE_ROOM) {
        run.heardSpeech = true;
        run.quietSince = null;
      } else if (run.heardSpeech && level < run.room + QUIET_ABOVE_ROOM) {
        run.quietSince ??= now;
        if (now - run.quietSince >= END_OF_SPEECH_MS) {
          finish(true);
          return;
        }
      } else {
        run.quietSince = null;
      }
    }

    if (run.metered && !run.heardSpeech && elapsed > NOTHING_HEARD_MS) {
      finish(false, 'Didn’t hear anything. Tap the mic and try again.');
    } else if (elapsed > MAX_MS) {
      finish(true);
    }
  }, [status.metering, status.durationMillis, state, run, finish]);

  // Never leave the mic open behind a closed screen.
  useEffect(
    () => () => {
      if (stateRef.current === 'listening') {
        recorder.stop().catch(() => {});
        setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
    },
    [recorder]
  );

  // 0–1 for drawing: the room's level at the bottom, loud speech at the top.
  const level =
    state === 'listening' && typeof status.metering === 'number' && Number.isFinite(run.room)
      ? Math.max(0, Math.min(1, (status.metering - run.room) / 30))
      : 0;

  return { state, level, durationMillis: status.durationMillis, start, stop, cancel };
}
