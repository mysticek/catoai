/**
 * Audio helper. Recording uses the `expo-audio` hook in App.tsx with these options;
 * here we also read the recorded clip as base64 for the WebSocket.
 *
 * We record LINEAR PCM WAV (16 kHz mono) instead of the default m4a: m4a/MP4 needs a
 * trailing "moov atom" written on finalize, which was arriving incomplete and breaking
 * ffmpeg. WAV has its header up front and is the exact format whisper wants anyway.
 */

import * as FileSystem from "expo-file-system/legacy";
import { IOSOutputFormat, AudioQuality, type RecordingOptions } from "expo-audio";

export const REC_OPTIONS: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 128000,
  android: {
    outputFormat: "default",
    audioEncoder: "default",
  },
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/wav", bitsPerSecond: 128000 },
};

export async function readBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
