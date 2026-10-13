#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('src/pages/Analytics.jsx', 'utf8');

assert.match(source, /Historical Revenue \(Actuals\)/, 'analytics must label the chart as historical actuals');
assert.match(source, /This chart does not include forecast amounts or invoice face values/, 'actuals must stay separate from projections and billing');
assert.match(source, /Collections Forecast — Next 3 Months/, 'forecast must identify the future projection window');
assert.match(source, /not guaranteed revenue/, 'forecast must explain its limits');
assert.match(source, /last 3 completed calendar months/, 'forecast must disclose its basis');
assert.match(source, /month is marked MTD/, 'the partial month must be identified');
assert.match(source, /Average Received Payment/, 'installments must not be called deal size');
assert.doesNotMatch(source, /InvokeLLM|pred\.confidence|Math\.max\(paymentTotal, invoiceTotal\)/, 'AI guesses and invoice fallback must not produce financial totals');
assert.match(source, /queries\.every\(query => query\.isSuccess\)/, 'forecast must wait for loaded data');
assert.match(source, /rows\.length >= 10000/, 'truncated data must not be reported as complete');
assert.match(source, /Historical window:<\/span> Last 12 months/, 'the visible historical window must match the chart data');
assert.doesNotMatch(source, /Last 30 Days/, 'analytics must not show an unused last-30-days selector');
assert.doesNotMatch(source, /Revenue Trend \(Last 12 Months\)/, 'analytics must not use the ambiguous chart title');

console.log('PASS: analytics labels cash actuals, partial months, baseline forecasts, and invoice due balances honestly');