/**
 * Lexi single-active-voice regression checks.
 *
 * Run: node scripts/test-lexi-single-voice.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const coordinator = read('src/utils/lexiVoiceCoordinator.js');
const native = read('src/components/ai/GeminiLiveNativeClient.jsx');
const lexiWorkspace = read('src/pages/LexiWorkspace.jsx');
const assistant = read('src/pages/AIAssistant.jsx');

const checks = [
  ['uses one shared coordinator for every browser voice surface', () => {
    for (const [name, source] of [['native', native], ['Lexi Workspace', lexiWorkspace], ['AI Assistant', assistant]]) {
      assert.match(source, /lexiVoiceCoordinator/, `${name} must use the shared voice coordinator`);
    }
    assert.match(coordinator, /acquireLexiVoiceOwner/);
    assert.match(coordinator, /releaseLexiVoiceOwner/);
    assert.match(coordinator, /BroadcastChannel/);
  }],
  ['starting a channel uses takeover semantics', () => {
    assert.match(coordinator, /Voice modes deliberately use takeover semantics/);
    assert.match(coordinator, /writeOwner\(owner, 'acquired'\)/);
    assert.match(coordinator, /notify\(owner, reason\)/);
  }],
  ['native voice rejects late callbacks after losing ownership', () => {
    assert.match(native, /isLexiVoiceOwner\('native', nativeVoiceOwnerRef\.current\?\.token\)/);
    assert.match(native, /Another voice channel took ownership; stopping native session/);
    assert.match(native, /stopSession\(\)/);
  }],
  ['legacy recognition and speech are stopped on native takeover', () => {
    for (const source of [lexiWorkspace, assistant]) {
      assert.match(source, /stopLegacyVoiceCapture/);
      assert.match(source, /window\.speechSynthesis\.cancel\(\)/);
      assert.match(source, /owner\?\.kind === 'native'/);
      assert.match(source, /setVoiceMode\(false\)/);
    }
  }],
  ['legacy sends are guarded against native ownership', () => {
    for (const source of [lexiWorkspace, assistant]) {
      assert.match(source, /isLexiVoiceOwner\('legacy', legacyVoiceOwnerRef\.current\?\.token\)/);
      assert.match(source, /isLexiVoiceOwner\('native'\)/);
      assert.match(source, /handleVoiceInput[\s\S]{0,160}ensureLegacyVoiceOwner/);
    }
  }],
  ['native cleanup releases the owner and reconnects keep the same owner', () => {
    assert.match(native, /startLexiVoiceOwnerHeartbeat\('native', owner\.token\)/);
    assert.match(native, /releaseNativeVoiceOwner\(\)/);
    assert.match(native, /if \(!isRecovery\)/);
    assert.match(native, /isLexiVoiceOwner\('native', nativeVoiceOwnerRef\.current\?\.token\)/);
  }],
  ['Drive Mode remains on the same native ownership path', () => {
    assert.match(native, /driveMode = false/);
    assert.match(native, /handsFreeMode.*driveMode/);
    assert.match(read('src/pages/GeminiLiveMode.jsx'), /GeminiLiveNativeClient/);
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

console.log(`\n${passed}/${checks.length} Lexi single-voice checks passed.`);
if (process.exitCode) console.error('FAILED');
else console.log('PASSED');