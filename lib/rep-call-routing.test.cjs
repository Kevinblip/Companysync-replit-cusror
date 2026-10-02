const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const routing = require('./rep-call-routing.cjs');

const EASTERN = 'America/New_York';
const BUSINESS_HOURS = {
  after_hours_enabled: true,
  after_hours_start: '08:00',
  after_hours_end: '18:00',
};
// 5:30pm Eastern is still on duty. A UTC server clock would see 21:30 and treat it as after hours.
const ON_DUTY = new Date('2026-10-02T21:30:00Z');
// 10:30pm Eastern is after hours.
const OFF_DUTY = new Date('2026-10-03T02:30:00Z');

const YICN = 'yicn-co';
const COMPANIESYNC = 'companysync_master_001';

function line(overrides) {
  return {
    companyId: YICN,
    availabilityStatus: 'available',
    hours: BUSINESS_HOURS,
    timeZone: EASTERN,
    now: ON_DUTY,
    callerPhone: '+12165550100',
    ...overrides,
  };
}

describe('known working lines stay on their current path while on duty', () => {
  it('Kevin 7081 stays with the AI (sarah_answers)', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'sarah_answers',
      cellPhone: '+12165550199',
      twilioNumber: '+12167777081',
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.mode, 'sarah_answers');
    assert.equal(plan.handoffReason, '');
  });

  it('Marlene 1408 stays on sarah_then_transfer during her hours', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'sarah_then_transfer',
      cellPhone: '+12165550140',
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.mode, 'sarah_then_transfer');
    assert.equal(plan.handoffReason, '');
  });

  it('CompanySync 7154 with no rep still reaches the AI for that company', () => {
    const plan = routing.planInboundCall(line({
      companyId: COMPANIESYNC,
      routingMode: 'sarah_answers',
      cellPhone: '',
      repName: '',
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.mode, 'sarah_answers');
  });

  it('480-1287 rings the rep cell with screening while on duty', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'forward_to_cell',
      cellPhone: '+18146515614',
    }));
    assert.equal(plan.action, 'dial');
    assert.equal(plan.screen, true);
    assert.equal(plan.mode, 'forward_to_cell');
  });
});

describe('after hours and unavailable', () => {
  it('uses the company time zone, not the server clock', () => {
    const minutes = routing.minutesInTimeZone(ON_DUTY, EASTERN);
    assert.equal(minutes, 17 * 60 + 30);
    assert.equal(routing.isOnDuty({
      hours: BUSINESS_HOURS,
      timeZone: EASTERN,
      now: ON_DUTY,
    }), true);
    assert.equal(routing.isOnDuty({
      hours: BUSINESS_HOURS,
      timeZone: EASTERN,
      now: OFF_DUTY,
    }), false);
  });

  it('sends a forward-to-cell rep to the AI after hours', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'forward_to_cell',
      cellPhone: '+18146515614',
      now: OFF_DUTY,
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.mode, 'sarah_answers');
    assert.equal(plan.handoffReason, 'after_hours');
  });

  it('sends sarah_then_transfer to message-taking after hours', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'sarah_then_transfer',
      cellPhone: '+12165550140',
      now: OFF_DUTY,
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.handoffReason, 'after_hours');
  });

  it('does not change an AI-only line just because the office is closed', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'sarah_answers',
      now: OFF_DUTY,
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.handoffReason, '');
  });

  it('treats availability unavailable as off duty even inside the window', () => {
    const plan = routing.planInboundCall(line({
      routingMode: 'forward_to_cell',
      cellPhone: '+18146515614',
      availabilityStatus: 'unavailable',
      now: ON_DUTY,
    }));
    assert.equal(plan.action, 'ai');
    assert.equal(plan.handoffReason, 'unavailable');
  });

  it('ignores hours until the rep turns the schedule on', () => {
    assert.equal(routing.isOnDuty({
      hours: { after_hours_enabled: false, after_hours_start: '08:00', after_hours_end: '18:00' },
      timeZone: EASTERN,
      now: OFF_DUTY,
    }), true);
  });

  it('reads hours off the staff data column the profile page saves', () => {
    const route = routing.routeFromStaffRow({
      company_id: YICN,
      full_name: 'Marlene Stone',
      user_email: 'marlene@example.com',
      cell_phone: '216-555-0140',
      call_routing_mode: 'sarah_then_transfer',
      availability_status: 'available',
      twilio_number: '(216) 777-1408',
      time_zone: EASTERN,
      staff_data: { after_hours_enabled: true, after_hours_start: '08:00', after_hours_end: '18:00' },
    });
    assert.equal(route.cellPhone, '216-555-0140');
    assert.equal(route.hours.after_hours_enabled, true);
    const plan = routing.planInboundCall({ ...route, callerPhone: '+12165550100', now: OFF_DUTY });
    assert.equal(plan.handoffReason, 'after_hours');
  });
});

describe('unanswered transfer, voicemail, and screening', () => {
  it('treats no-answer, busy, and failed as not answered', () => {
    for (const dialStatus of ['no-answer', 'busy', 'failed', 'canceled']) {
      assert.equal(routing.dialWasAnswered({ dialStatus, dialDuration: 0 }), false);
    }
  });

  it('treats a short completed dial as voicemail, not a conversation', () => {
    assert.equal(routing.dialWasAnswered({ dialStatus: 'completed', dialDuration: 8 }), false);
    assert.equal(routing.fallbackReason('completed'), 'voicemail');
  });

  it('treats a bridged conversation longer than 15 seconds as answered', () => {
    assert.equal(routing.dialWasAnswered({ dialStatus: 'completed', dialDuration: 40, dialBridged: 'true' }), true);
  });

  it('does not count an unbridged screening hangup as answered', () => {
    assert.equal(routing.dialWasAnswered({ dialStatus: 'completed', dialDuration: 40, dialBridged: 'false' }), false);
  });

  it('asks the rep to press 1 and hangs up if they do not', () => {
    const screen = routing.buildScreenTwiml({ host: 'getcompanysync.com', callerPhone: '+12165550100', companyId: 'co_1' });
    assert.match(screen, /Press 1 to accept/);
    assert.match(screen, /screen-result\?companyId=co_1/);
    assert.match(screen, /<Hangup\/>/);
    assert.equal(routing.screenAccepted('1'), true);
    assert.equal(routing.screenAccepted('2'), false);
    assert.match(routing.buildScreenResultTwiml('1'), /<Response\/>/);
    assert.match(routing.buildScreenResultTwiml(''), /<Hangup\/>/);
  });

  it('puts screening on the cell dial and returns the caller to the AI with the call ids', () => {
    const dial = routing.buildForwardDialTwiml({
      host: 'getcompanysync.com',
      calledNumber: '+12164801287',
      cellPhone: '+18146515614',
      companyId: YICN,
      callerPhone: '+12165550100',
      repName: 'Stone Enterprise',
      repEmail: 'stone@example.com',
      callSid: 'CA123',
      recordCallback: 'https://getcompanysync.com/api/twilio/recording-callback',
    });
    assert.match(dial, /timeout="20"/);
    assert.match(dial, /answerOnBridge="true"/);
    assert.match(dial, /\/api\/twilio\/screen/);
    assert.match(dial, /staffCellPhone=/);
    assert.match(dial, /callSid=/);

    const fallback = routing.buildAiFallbackTwiml({
      host: 'getcompanysync.com',
      companyId: YICN,
      callerPhone: '+12165550100',
      callSid: 'CA123',
      calledNumber: '+12164801287',
      staffCellPhone: '+18146515614',
      repName: 'Stone Enterprise',
      repEmail: 'stone@example.com',
      reason: 'no_answer',
    });
    const params = routing.missedHandoffParameters({
      companyId: YICN,
      callerPhone: '+12165550100',
      callSid: 'CA123',
      calledNumber: '+12164801287',
      staffCellPhone: '+18146515614',
      repName: 'Stone Enterprise',
      reason: 'no_answer',
    });
    assert.equal(params.callSid, 'CA123');
    assert.equal(params.calledNumber, '+12164801287');
    assert.equal(params.staffCellPhone, '+18146515614');
    assert.match(fallback, /name="callSid" value="CA123"/);
    assert.match(fallback, /name="calledNumber" value="\+12164801287"/);
    assert.match(fallback, /name="staffCellPhone" value="\+18146515614"/);
    assert.match(fallback, /take a message/);
  });

  it('keeps the caller on the AI when a transfer is not accepted', () => {
    const twiml = routing.buildTransferDialTwiml({
      host: 'getcompanysync.com',
      cellPhone: '+18146515614',
      callerId: '+12164801287',
      repName: 'Stone Enterprise',
      companyId: YICN,
      callerPhone: '+12165550100',
      calledNumber: '+12164801287',
      callSid: 'CA999',
    });
    assert.match(twiml, /forward-fallback/);
    assert.match(twiml, /callSid=CA999/);
    assert.match(twiml, /staffCellPhone=/);
    assert.match(twiml, /calledNumber=/);
    assert.match(twiml, /\/api\/twilio\/screen/);
    assert.doesNotMatch(twiml, /Please try again later/);
  });
});

describe('transfer target defaults to the dialed number owner', () => {
  const subscribers = [
    { company_id: YICN, rep_name: 'Kevin Stone', rep_email: 'kevin@example.com', cell_phone: '+12165551081', phone_number: '+12167777081' },
    { company_id: YICN, rep_name: 'Marlene Stone', rep_email: 'marlene@example.com', cell_phone: '+12165551408', phone_number: '+12167771408' },
    { company_id: 'other-co', rep_name: 'Marlene Stone', rep_email: 'other@example.com', cell_phone: '+19995550111', phone_number: '+19995550000' },
  ];

  it('rings the owner of the dialed number when no rep name is given', () => {
    const target = routing.resolveTransferTarget({
      targetPerson: '',
      subscribers,
      companyId: YICN,
      dialedOwner: { cell: '216-555-1408', name: 'Marlene Stone', email: 'marlene@example.com', twilioNumber: '+12167771408' },
    });
    assert.equal(target.cell, '+12165551408');
    assert.equal(target.name, 'Marlene Stone');
    assert.equal(target.source, 'dialed_number');
  });

  it('finds the dialed-number owner from the subscriber list when the cell was not passed in', () => {
    const target = routing.resolveTransferTarget({
      subscribers,
      companyId: YICN,
      dialedOwner: { twilioNumber: '(216) 777-1408' },
    });
    assert.equal(target.name, 'Marlene Stone');
    assert.equal(target.cell, '+12165551408');
  });

  it('still honors an explicit name inside the same company', () => {
    const target = routing.resolveTransferTarget({
      targetPerson: 'Kevin',
      subscribers,
      companyId: YICN,
      dialedOwner: { cell: '+12165551408', name: 'Marlene Stone', twilioNumber: '+12167771408' },
    });
    assert.equal(target.name, 'Kevin Stone');
    assert.equal(target.source, 'name');
  });

  it('does not ring a different company or a random teammate', () => {
    const named = routing.resolveTransferTarget({
      targetPerson: 'Marlene',
      subscribers,
      companyId: 'missing',
      dialedOwner: { cell: '+12165551081', name: 'Kevin Stone' },
    });
    assert.equal(named, null);
    const unnamed = routing.resolveTransferTarget({
      targetPerson: '',
      subscribers,
      companyId: YICN,
      dialedOwner: {},
    });
    assert.equal(unnamed, null);
  });
});

describe('number lookup normalization and company scope', () => {
  it('normalizes common formats to the same E.164 and digit keys', () => {
    for (const raw of ['+1 (216) 777-7081', '2167777081', '1-216-777-7081', '+12167777081']) {
      assert.equal(routing.toE164(raw), '+12167777081');
      assert.ok(routing.phoneLookupVariants(raw).includes('+12167777081'));
      assert.ok(routing.comparableDigits(raw).includes('2167777081'));
    }
    assert.equal(routing.phonesMatch('(216) 777-7081', '+12167777081'), true);
    assert.equal(routing.toE164('+63 991 854 1836'), '+639918541836');
  });

  it('prefers the hinted company when the same digits exist twice', () => {
    const rows = [
      { company_id: 'other', full_name: 'Someone Else' },
      { company_id: YICN, full_name: 'Kevin Stone' },
    ];
    assert.equal(routing.chooseCompanyRow(rows, YICN).full_name, 'Kevin Stone');
  });

  it('does not invent a company for an unknown number', () => {
    const plan = routing.planInboundCall({ companyId: '', routingMode: 'forward_to_cell', cellPhone: '+18146515614' });
    assert.equal(plan.action, 'unassigned');
    assert.match(routing.unassignedNumberTwiml(), /not assigned to a company/);
    assert.doesNotMatch(routing.unassignedNumberTwiml(), /695944e3c1fb00b7ab716c6f/);
  });
});

describe('rep SMS notifications', () => {
  it('includes the caller name, number, and message', () => {
    const body = routing.buildRepSmsBody({
      callerName: 'Pat Homeowner',
      callerPhone: '+12165550100',
      message: 'Roof is leaking over the kitchen.',
      companyName: 'YICN',
    });
    assert.match(body, /Pat Homeowner/);
    assert.match(body, /\+12165550100/);
    assert.match(body, /Roof is leaking over the kitchen/);
  });

  it('pulls the caller words out of a transcript', () => {
    const message = routing.callerMessageFromTranscript('Sarah: Hello\nCaller: The roof is leaking\nSarah: I will tell them');
    assert.match(message, /roof is leaking/);
    assert.doesNotMatch(message, /I will tell them/);
  });

  it('does not send Philippines SMS from a US long code and names Twilio 21612', () => {
    const plan = routing.planSmsDelivery({ to: '+639918541836', from: '+12164801287' });
    assert.equal(plan.skipSms, true);
    assert.equal(plan.code, 21612);
    assert.match(plan.reason, /21612/);
    assert.equal(routing.shouldEmailOnSmsFailure(21612, 400), true);
  });

  it('reads a Twilio 21612 error body and still allows a normal US SMS', () => {
    assert.equal(routing.twilioErrorCode('{"code":21612,"message":"Message cannot be sent"}'), 21612);
    const plan = routing.planSmsDelivery({ to: '+12165550199', from: '+12164801287' });
    assert.equal(plan.skipSms, false);
  });
});

describe('Twilio request signatures', () => {
  it('matches the documented HMAC over the exact URL plus sorted POST params', () => {
    const token = '12345';
    const url = 'https://getcompanysync.com/api/twilio/voice';
    const params = { From: '+12165550100', To: '+12167777081', CallSid: 'CA123' };
    const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
    const expected = crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
    assert.equal(routing.twilioSignature(token, url, params), expected);
    const urls = routing.webhookUrlCandidates({
      pathAndQuery: '/api/twilio/voice',
      hosts: ['getcompanysync.com', 'ignored.example'],
    });
    assert.equal(routing.twilioSignatureMatches({ tokens: [token], signature: expected, urls, params }), true);
    assert.equal(routing.twilioSignatureMatches({ tokens: [token], signature: 'nope', urls, params }), false);
    assert.equal(routing.twilioSignatureMatches({ tokens: [], signature: expected, urls, params }), false);
  });
});
