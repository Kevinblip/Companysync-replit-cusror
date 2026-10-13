const assert = require('assert');
const fs = require('fs');

for (const file of ['vite-functions-plugin.js', 'prod-server.cjs']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /data_type === 'payments'/, `${file} must have a dedicated payment-detail response`);
  assert.match(source, /customer_name/, `${file} must return payment customer names`);
  assert.match(source, /payment_count/, `${file} must return a payment count`);
  assert.match(source, /total_collected/, `${file} must return collected payment totals`);
  assert.match(source, /start_date/, `${file} must support a start-date payment filter`);
  assert.match(source, /end_date/, `${file} must support an end-date payment filter`);
}

const prompt = fs.readFileSync('lib/lexiSystemPrompt.cjs', 'utf8');
assert.match(prompt, /who paid, who we collected from/i, 'Lexi must be instructed to use the payment payer breakdown');
assert.match(prompt, /paid in full/i, 'Lexi must be instructed to use the individual customer payment lookup');
assert.match(prompt, /get_customer_payment_status/, 'Lexi must declare an individual customer payment-status tool');

for (const file of ['vite-functions-plugin.js', 'db/prod-integrations.cjs']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /fname === 'get_customer_payment_status'/, `${file} must execute the customer payment-status lookup`);
  assert.match(source, /paid_in_full/, `${file} must return an explicit paid-in-full result`);
  assert.match(source, /fname === 'find_documents'/, `${file} must search the ordinary Documents library`);
  assert.match(source, /entity_type='Document' AND company_id=\$1/, `${file} must company-scope document searches`);
}

console.log('PASS: Lexi payment details — payer names and date filters are preserved');