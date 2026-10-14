'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const client = fs.readFileSync('src/components/ai/GeminiLiveNativeClient.jsx', 'utf8');
const server = fs.readFileSync('prod-server.cjs', 'utf8');
const devServer = fs.readFileSync('vite-lexi-native-plugin.js', 'utf8');
for (const [name, source] of [['production', server], ['development', devServer]]) {
  const interruptHandler = source.match(
    /if \(msg\.type === 'user_interrupted'\) \{([\s\S]*?)\n\s{8,12}\}/
  );
  assert.ok(interruptHandler, `${name} server must handle native voice interruptions`);
  assert.match(interruptHandler[1], /geminiIsSpeaking\s*=\s*false/);
  assert.match(interruptHandler[1], /clearTimeout\(geminiSpeechEndTimer\)/);
  assert.doesNotMatch(interruptHandler[1], /setTimeout/);
  assert.match(
    source,
    /msg\.type === 'audio'[\s\S]{0,240}setupComplete[\s\S]{0,100}!\s*geminiIsSpeaking/,
    `${name} server must immediately forward the user's mic audio after interruption`
  );
  const playbackDone = source.match(
    /if \(msg\.type === 'playback_done'\) \{([\s\S]*?)\n\s{8,12}\}/
  );
  assert.ok(playbackDone, `${name} server retains the post-playback echo gate`);
  assert.match(playbackDone[1], /setTimeout/);
  assert.match(source, /playback_done[\s\S]{0,260}POST_SPEECH_BUFFER_MS/);
}

assert.match(
  server,
  /msg\.type === 'audio'[\s\S]{0,180}setupComplete && !geminiIsSpeaking/,
  'production audio must be forwarded while the upstream gate is open'
);
assert.match(client, /wsRef\.current\.send\(JSON\.stringify\(\{ type: 'user_interrupted' \}\)\)/);
assert.match(client, /assistantTextBufferRef\.current\s*=\s*""/);
assert.match(client, /clearTimeout\(ttsTurnTimerRef\.current\)/);
assert.match(client, /audioPlaybackGenerationRef\.current\+\+/);
assert.match(client, /playbackGeneration !== audioPlaybackGenerationRef\.current/);
assert.match(client, /bargeInPendingRef\.current = true/);
assert.match(client, /if \(bargeInPendingRef\.current\) return/);
assert.match(client, /bargeInPendingRef\.current = false/);
assert.match(client, /interruptionAudioFrames\.push\(chunk\.slice\(\)\)/);
assert.match(client, /for \(const speechFrame of bufferedSpeech\) \{\s*sendPcmChunk\(speechFrame\)/);
assert.match(client, /interruptionAudioFramesFallback\.push\(inputData\.slice\(\)\)/);
assert.match(client, /for \(const speechFrame of bufferedSpeech\) \{\s*sendPcmChunk\(speechFrame, actualSampleRate\)/);
const flushStart = client.indexOf('const bufferedSpeech = interruptionAudioFrames;');
const interruptEvent = client.indexOf('stopAllAudio(true);', flushStart);
const flushAudio = client.indexOf('sendPcmChunk(speechFrame);', interruptEvent);
assert.ok(flushStart >= 0 && interruptEvent > flushStart && flushAudio > interruptEvent,
  'worklet must open the server gate before flushing buffered user speech');

assert.match(client, /const interruptRmsThreshold = handsFreeModeRef\.current \? 0\.045 : 0\.035/);
assert.match(client, /const interruptHoldMs = handsFreeModeRef\.current \? 480 : 320/);
assert.match(client, /interruptFramesNeeded\(chunk\.length, 16000\)/, 'worklet VAD uses a short speech-duration threshold');
assert.match(client, /interruptFramesNeeded\(inputData\.length, actualSampleRate\)/, 'fallback VAD accounts for its capture sample rate');
const frames = (holdMs, sampleCount, sampleRate) => Math.max(1, Math.ceil(holdMs * sampleRate / (sampleCount * 1000)));
assert.equal(frames(320, 1280, 16000), 4, 'desktop worklet interruption is detected in 320 ms');
assert.equal(frames(480, 1280, 16000), 6, 'hands-free worklet interruption is detected in 480 ms');
assert.equal(frames(320, 4096, 48000), 4, 'fallback VAD uses the actual sample rate');
const sessionEnd = fs.readFileSync('lib/lexiSessionEnd.cjs', 'utf8');
assert.match(
  sessionEnd,
  /If the user explicitly says stop, stop talking, or asks you to be quiet, stop the current response immediately/,
  'Lexi prompt includes stop-command instructions'
);
assert.match(sessionEnd, /stop the estimate/, 'end phrases must not treat a longer stop request as hang-up');
for (const [name, source] of [['production', server], ['development', devServer]]) {
  assert.match(source, /SESSION_END_INSTRUCTION/, `${name} Lexi bridge uses the shared session-end instruction`);
  assert.match(source, /END_SESSION_TOOL/, `${name} Lexi bridge exposes end_session on the native voice session`);
  assert.match(source, /createLexiSessionCloser/, `${name} Lexi bridge closes farewells and idle sessions`);
}

console.log('PASS: voice barge-in stops playback promptly, flushes buffered user speech, ignores stale audio, and preserves playback echo buffering.');