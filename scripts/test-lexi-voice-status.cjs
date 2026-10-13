/**
 * Lexi native-voice response status regression checks.
 *
 * Run: node scripts/test-lexi-voice-status.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'src/components/ai/GeminiLiveNativeClient.jsx'), 'utf8');
const devBridge = fs.readFileSync(path.join(root, 'vite-lexi-native-plugin.js'), 'utf8');
const prodBridge = fs.readFileSync(path.join(root, 'prod-server.cjs'), 'utf8');

const checks = [
  ['renders messaging-style activity dots', () => {
    assert.match(client, /function ActivityDots\(\)/);
    assert.match(client, /animate-bounce/);
    assert.match(client, /aria-hidden="true"/);
  }],
  ['announces every user-visible voice state', () => {
    for (const label of ['Listening…', 'Thinking', 'Checking', 'Lexi is responding', 'Reconnecting to Lexi']) {
      assert.ok(client.includes(label), `missing activity label: ${label}`);
    }
    assert.match(client, /aria-live="polite"/);
    assert.match(client, /aria-atomic="true"/);
  }],
  ['moves from user transcript to thinking and tool call to checking', () => {
    assert.match(client, /msg\.role === 'user'[\s\S]{0,100}setVoiceActivity\('thinking'\)/);
    assert.match(client, /msg\.type === 'tool_call'[\s\S]{0,100}setVoiceActivity\('checking'\)/);
  }],
  ['moves audio and text fallback playback to responding', () => {
    assert.match(client, /msg\.type === 'speak_text'[\s\S]{0,100}setVoiceActivity\('responding'\)/);
    assert.match(client, /msg\.type === 'audio'[\s\S]{0,180}setVoiceActivity\('responding'\)/);
  }],
  ['clears stale processing status on interruption and reconnect', () => {
    assert.match(client, /msg\.type === 'interrupted'[\s\S]{0,120}setListeningActivity\(\)/);
    assert.match(client, /setStatus\('reconnecting'\);\s*setVoiceActivity\('reconnecting'\)/);
    assert.match(client, /cleanupSession[\s\S]*setVoiceActivity\('idle'\)/);
  }],
  ['development and production both emit tool-call lifecycle events', () => {
    for (const [name, source] of [['development', devBridge], ['production', prodBridge]]) {
      assert.match(source, /type: 'tool_call'/, `${name} bridge must emit tool_call`);
      assert.match(source, /type: 'turn_complete'/, `${name} bridge must emit turn_complete`);
      assert.match(source, /type: 'interrupted'/, `${name} bridge must emit interrupted`);
    }
  }],
];

let passed = 0;
for (const [name, run] of checks) {
  try {
    run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${checks.length} Lexi voice-status checks passed.`);
if (process.exitCode) console.error('FAILED');
else console.log('PASSED');