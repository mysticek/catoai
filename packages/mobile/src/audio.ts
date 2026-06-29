/**
 * Audio capture — record a push-to-talk clip as 16 kHz mono WAV (what the desktop's
 * whisper.cpp expects) and read it back as base64 for the WebSocket.
 *
 * NOTE: iOS LINEARPCM + .wav yields a proper WAV. Android WAV via expo-av is less
 * reliable across devices — if the desktop STT rejects Android audio, either record
 * PCM and add a WAV header, or fall back to typing the command (the text path works
 * identically). This is the one piece that needs on-device verification.
 */

import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: ".wav",
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: ".wav",
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/wav", bitsPerSecond: 256000 },
};

export class PushToTalk {
  #recording: Audio.Recording | undefined;

  async start(): Promise<void> {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
    this.#recording = recording;
  }

  /** Stop recording and return the clip as a base64 WAV string. */
  async stopAndGetBase64(): Promise<string | null> {
    if (!this.#recording) return null;
    await this.#recording.stopAndUnloadAsync();
    const uri = this.#recording.getURI();
    this.#recording = undefined;
    if (!uri) return null;
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
}
