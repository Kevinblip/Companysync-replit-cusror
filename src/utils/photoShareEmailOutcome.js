export function getPhotoShareEmailOutcome(response) {
  const result = response?.data && typeof response.data === 'object'
    ? response.data
    : response;

  if (result?.skipped) {
    return {
      status: 'not-sent',
      message: 'The email was skipped and was not sent.',
    };
  }

  if (result?.success === false || result?.error) {
    return {
      status: 'not-sent',
      message: result.error || 'The email provider did not accept the request.',
    };
  }

  if (!result?.success || !result?.id) {
    return {
      status: 'unconfirmed',
      message: 'The send result could not be confirmed. Check email delivery history before retrying.',
      communicationId: result?.communicationId || null,
    };
  }

  const deliveryStatus = String(result.deliveryStatus || result.delivery_status || 'submitted').toLowerCase();
  if (deliveryStatus === 'delivered') {
    return {
      status: 'delivered',
      provider: result.provider || null,
      communicationId: result.communicationId || null,
    };
  }

  if (['failed', 'bounced', 'undelivered', 'rejected'].includes(deliveryStatus)) {
    return {
      status: 'not-sent',
      message: `The provider reports this email as ${deliveryStatus}.`,
      communicationId: result.communicationId || null,
    };
  }

  return {
    status: 'submitted',
    provider: result.provider || null,
    communicationId: result.communicationId || null,
  };
}