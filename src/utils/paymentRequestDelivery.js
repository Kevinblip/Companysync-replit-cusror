// functions.invoke resolves both successes and application errors. A 200 from the
// invoke endpoint is not proof that a provider accepted the message.
export function requireMessageSubmission(response, channel) {
  const result = response?.data ?? response;
  const error = response?.error || result?.error || result?.reason;
  const reference = channel === 'sms' ? result?.sid : result?.id;
  if (error || result?.success !== true ||
      (channel === 'sms' && ['failed', 'undelivered', 'canceled'].includes(String(result?.status || '').toLowerCase()))) {
    throw new Error(error || `${channel === 'sms' ? 'Text' : 'Email'} provider did not accept the request. No message was submitted.`);
  }
  if (!reference) throw new Error('Provider response had no tracking ID. Submission is uncertain; check activity before retrying.');
  return result;
}