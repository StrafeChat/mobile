#!/usr/bin/env node
/**
 * Renders ringtone.wav: the web client's synthesised ringtone (web/src/lib/voice/ringtone.ts)
 * as a file, because React Native has no oscillators to play it live. One 2-second period -
 * C5 for 0.35 s at 0.05 s, E5 for 0.35 s at 0.45 s, the same 20 ms attack, hold and
 * exponential release as the web's gain envelope - which the player loops.
 *
 * Run: node src/platform/voice/assets/make-ringtone.mjs
 */
import { writeFileSync } from 'node:fs';

const RATE = 24_000;
const PERIOD = 2.0;
const PEAK = 0.98;
const samples = new Float64Array(Math.round(RATE * PERIOD));

function note(freq, start, dur) {
  const end = start + dur;
  for (let i = Math.floor(start * RATE); i < Math.min(samples.length, Math.ceil((end + 0.02) * RATE)); i++) {
    const t = i / RATE;
    let g;
    if (t < start) g = 0;
    else if (t < start + 0.02) g = (t - start) / 0.02; // linearRampToValueAtTime(1, start + 0.02)
    else if (t < end - 0.05) g = 1; // setValueAtTime(1, start + dur - 0.05)
    else if (t < end) g = Math.pow(0.001, (t - (end - 0.05)) / 0.05); // exponentialRamp to 0.001
    else g = 0; // osc.stop(start + dur + 0.02)
    samples[i] += g * Math.sin(2 * Math.PI * freq * (t - start));
  }
}

note(523.25, 0.05, 0.35);
note(659.25, 0.45, 0.35);

const data = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i++) {
  const v = Math.max(-1, Math.min(1, samples[i] * PEAK));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(new URL('./ringtone.wav', import.meta.url), Buffer.concat([header, data]));
console.log(`ringtone.wav: ${samples.length} samples at ${RATE} Hz`);
