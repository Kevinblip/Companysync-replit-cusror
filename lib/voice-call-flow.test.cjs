const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const flow = require('./voice-call-flow.cjs');

function mockRes() {
  return {
    headersSent: false,
    writableEnded: false,
    statusCode: null,
    body: '',
    writeHead(code) { this.statusCode = code; this.headersSent = true; },
    end(body) { this.body = body || ''; this.writableEnded = true; },
  };
}

describe('turn taking from the 2026-10-01 test call', () => {
  it('drops the next assistant turn after a question until the caller speaks', () => {
    const state = flow.createVoiceTurnState();
    state.callerId = '+12167771602';
    flow.onAssistantTranscript(state, "What's a good number to reach you back on?");
    flow.onModelAudio(state);
    const done = flow.onTurnComplete(state);
    assert.equal(done.awaitingCaller, true);
    assert.equal(done.sendHangupMark, false);

    const fabricated = flow.onModelAudio(state);
    assert.equal(fabricated.forward, false, 'Got it / I have you in our system must not play with no caller reply');

    flow.onCallerTranscript(state, 'You can use the number I am calling from');
    assert.equal(state.awaitingCaller, false);
    assert.equal(flow.onModelAudio(state).forward, true);
  });

  it('does not inject a second Gemini turn when a tool finishes', () => {
    const msg = flow.buildGeminiToolMessage([
      { id: '1', name: 'save_lead_details', response: { success: true } },
    ]);
    assert.deepEqual(Object.keys(msg), ['tool_response']);
    assert.equal(msg.client_content, undefined);
  });

  it('refuses a confirmation email when nothing was booked and no email was collected', () => {
    const state = flow.createVoiceTurnState();
    const line = "No problem, we'll send you a confirmation email.";
    assert.equal(flow.promisesDisallowedConfirmation(line, flow.confirmationFacts(state)), true);
    const flagged = flow.onAssistantTranscript(state, line);
    assert.equal(flagged.clearPlayback, true);
    assert.equal(flow.onModelAudio(state).forward, false);
  });

  it('allows a confirmation email only after a booked appointment and an email', () => {
    const state = flow.createVoiceTurnState();
    const args = flow.prepareToolArgs('book_appointment', {
      slot_time: '2026-10-02T14:00:00Z',
      name: 'Test Caller',
      email: 'test@example.com',
      phone: '2165550199',
    }, '+12167771602');
    flow.noteToolResult(state, 'book_appointment', args, { success: true });
    const facts = flow.confirmationFacts(state);
    assert.equal(facts.appointmentBooked, true);
    assert.equal(facts.confirmationEmailAllowed, true);
    assert.equal(flow.promisesDisallowedConfirmation("We'll send you a confirmation email.", facts), false);
  });

  it('stores caller ID on the lead but does not treat it as a spoken callback number', () => {
    const state = flow.createVoiceTurnState();
    state.callerId = '+12167771602';
    const args = flow.prepareToolArgs('save_lead_details', { name: 'Test Caller', address: '123 Main Street' }, state.callerId);
    assert.equal(args.phone, '+12167771602');
    assert.equal(args.phone_source, 'caller_id');
    flow.noteToolResult(state, 'save_lead_details', args, { success: true });
    const facts = flow.confirmationFacts(state);
    assert.equal(facts.confirmationSmsAllowed, false);
    assert.equal(facts.callbackNumber, '+12167771602');
  });
});

describe('goodbye hangup', () => {
  it('waits for a new closing line after the caller says goodbye mid-monologue', () => {
    const state = flow.createVoiceTurnState();
    flow.onAssistantTranscript(state, "No problem, we'll send you a confirmation email.");
    flow.onModelAudio(state);
    const bye = flow.onCallerTranscript(state, 'Okay, thank you. Goodbye.');
    assert.equal(bye.goodbye, true);
    assert.equal(bye.clearPlayback, true);
    assert.equal(bye.armHangup, true);

    const discarded = flow.onTurnComplete(state);
    assert.equal(discarded.sendHangupMark, false);

    assert.equal(flow.onModelAudio(state).forward, true);
    const closing = flow.onTurnComplete(state);
    assert.equal(closing.sendHangupMark, true);
  });

  it('does not treat a bare thank-you as goodbye', () => {
    assert.equal(flow.callerSaidGoodbye('Okay, thank you'), false);
    assert.equal(flow.callerSaidGoodbye('Okay, thank you. Goodbye.'), true);
  });

  it('marks hangup after end_call once the goodbye audio turn finishes', () => {
    const state = flow.createVoiceTurnState();
    flow.onModelAudio(state);
    flow.onAssistantTranscript(state, 'Thanks for calling. Goodbye.');
    const tool = flow.onEndCallTool(state);
    assert.equal(tool.sendHangupMark, false);
    const done = flow.onTurnComplete(state);
    assert.equal(done.sendHangupMark, true);
  });

  it('does not hang up on earlier audio when end_call arrives between turns', () => {
    const state = flow.createVoiceTurnState();
    flow.onModelAudio(state);
    flow.onAssistantTranscript(state, 'Would tomorrow at 10 work?');
    flow.onTurnComplete(state);
    const early = flow.onEndCallTool(state);
    assert.equal(early.sendHangupMark, false);
    flow.noteToolResult(state, 'end_call', {}, { success: true });
    assert.equal(flow.onTurnComplete(state).sendHangupMark, false);
    flow.onModelAudio(state);
    assert.equal(flow.onTurnComplete(state).sendHangupMark, true);
  });

  it('hangs up on a finished closing line when end_call arrives after that turn', () => {
    const state = flow.createVoiceTurnState();
    flow.onModelAudio(state);
    flow.onAssistantTranscript(state, 'Thanks for calling. Goodbye.');
    flow.onTurnComplete(state);
    const end = flow.onEndCallTool(state);
    assert.equal(end.sendHangupMark, true);
  });
});

describe('sarah-missed-call status callback', () => {
  it('classifies the completed test call as completed, not missed', () => {
    const parsed = flow.parseTwilioBody(
      'CallStatus=completed&From=%2B12167771602&To=%2B12167777154&CallSid=CA010117d27e2bd0579b47fb327d982565&CallDuration=81',
      ''
    );
    assert.equal(parsed.kind, 'completed');
    assert.equal(parsed.callerPhone, '+12167771602');
    assert.equal(parsed.calledNumber, '+12167777154');
    assert.equal(parsed.callDuration, '81');
    assert.equal(flow.classifyCallStatus('no-answer'), 'missed');
    assert.equal(flow.classifyCallStatus('busy'), 'missed');
    assert.equal(flow.classifyCallStatus('failed'), 'missed');
    assert.equal(flow.classifyCallStatus('ringing'), 'ignore');
    assert.equal(flow.classifyCallStatus('in-progress'), 'ignore');
  });

  it('returns 200 before background work finishes', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    const res = mockRes();
    let release;
    const gate = new Promise((r) => { release = r; });
    let seen = null;
    const pending = flow.handleMissedCallRequest(req, res, {
      processCall: async (parsed) => { seen = parsed; await gate; },
      timeoutMs: 500,
    });
    req.emit('data', Buffer.from('CallStatus=completed&CallSid=CA123&From=%2B15555550100&To=%2B12167777154'));
    req.emit('end');
    await new Promise((r) => setImmediate(r));
    assert.equal(res.statusCode, 200);
    assert.equal(res.writableEnded, true);
    assert.equal(res.body, 'OK');
    release();
    await pending;
    assert.equal(seen.kind, 'completed');
    assert.equal(seen.callSid, 'CA123');
  });

  it('returns 200 when the body never ends and when background work throws', async () => {
    const hung = new EventEmitter();
    hung.method = 'POST';
    const hungRes = mockRes();
    await flow.handleMissedCallRequest(hung, hungRes, {
      processCall: async () => {},
      timeoutMs: 30,
    });
    assert.equal(hungRes.statusCode, 200);
    assert.equal(hungRes.body, 'OK');

    const req = new EventEmitter();
    req.method = 'POST';
    const res = mockRes();
    const pending = flow.handleMissedCallRequest(req, res, {
      processCall: async () => { throw new Error('db down'); },
      timeoutMs: 200,
    });
    req.emit('data', 'CallStatus=no-answer&From=%2B15555550100&To=%2B12167777154');
    req.emit('end');
    await pending;
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'OK');
  });

  it('acks an aborted request that never emits end', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    const res = mockRes();
    const pending = flow.handleMissedCallRequest(req, res, {
      processCall: async () => {},
      timeoutMs: 1000,
    });
    req.emit('aborted');
    await pending;
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'OK');
  });
});
