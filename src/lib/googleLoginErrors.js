export function googleLoginErrorMessage(errorCode) {
  switch (errorCode) {
    case 'google_auth_failed':
      return 'Google sign-in failed. Please try again. If the problem continues, sign in with your email and password instead.';
    case 'access_denied':
      return 'Google sign-in was cancelled.';
    case 'google_not_configured':
      return 'Google sign-in is temporarily unavailable. Please sign in with your email and password.';
    default:
      return '';
  }
}
