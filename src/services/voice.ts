// src/services/voice.ts
//
// Speech to text for the chat's microphone. The phone only records; the words
// come from the server (routes/chat.ts's /transcribe), which keeps the
// transcription key off the device the same way every other AI call is.

import { File } from 'expo-file-system';
import { apiFetch, ApiError } from '../config/api';

export class VoiceError extends Error {}

export async function transcribe(uri: string): Promise<string> {
  const file = new File(uri);
  const format = (uri.split('.').pop() ?? 'm4a').toLowerCase();
  let audio: string;
  try {
    audio = await file.base64();
  } catch {
    throw new VoiceError('Couldn’t read the recording. Try again.');
  }

  try {
    const { text } = await apiFetch<{ text: string }>('/api/chat/transcribe', { audio, format });
    return text;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'unreachable') throw new VoiceError(err.message);
    throw new VoiceError('Couldn’t turn that into text. Check your connection and try again.');
  } finally {
    // The recording has done its job once it's text; nothing keeps it.
    try {
      file.delete();
    } catch {}
  }
}
