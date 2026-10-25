export const AUTH_COPY = {
  genericSignUp:
    'If this email can be registered, we sent a confirmation message. Check your inbox and spam.',
  genericRecovery:
    'If an account exists for that email, you will receive a reset link shortly. Check inbox and spam.',
  emailNotConfirmed: 'Confirm your email to continue. Open the message we sent, then return to the app.',
  invalidCredentials: 'Incorrect email or password.',
  rateLimited: 'Too many attempts. Wait a minute and try again.',
  offline: 'You appear to be offline. Check your connection and try again.',
  expiredLink: 'This link has expired. Request a new email and try again.',
  invalidLink: 'This link is invalid or has already been used.',
  weakPassword: 'Password must be at least 8 characters.',
  passwordMismatch: 'Password and confirm password must match.',
  googleCanceled: 'Google sign in canceled.',
  googleFailed: 'Google sign in did not complete. Please try again.',
  confirmationSent: 'Confirmation email sent.',
  recoverySent: 'Check your email for a reset link.',
  passwordUpdated: 'Your password has been updated. You are signed in.',
  accountDisabled: 'This account is disabled.',
  pendingTitle: 'Confirm your email',
  pendingBody:
    'We sent a confirmation link. Open it on this device to finish creating your Mystash account.',
  resend: 'Resend confirmation email',
  forgotPassword: 'Forgot password?',
  welcomeTitle: 'Welcome to Mystash',
  welcomeSignIn: 'Sign in to manage profile, wishlist, and creator earnings.',
  welcomeSignUp:
    'Create an account to save products, build Collections, and manage your creator profile.',
  landingHeadline: 'Your shopping in one place',
  landingBody: 'Save products, follow creators and build your own collections.',
  landingSignInHint: 'Welcome back to your stash',
  landingSignUpTitle: 'Create an account',
  landingSignUpHint: 'Join and start saving',
  formSignInTitle: 'Welcome back',
  formSignInBody: 'Sign in to access your stash, collections and more.',
  formSignUpTitle: 'Create an account',
  createAccount: 'Create account',
  signIn: 'Sign in',
  continueGoogle: 'Continue with Google',
  displayName: 'Display name',
  displayNamePlaceholder: 'How should we call you?',
  email: 'Email',
  emailPlaceholderSignIn: 'you@domain.com',
  emailPlaceholderSignUp: 'you@example.com',
  password: 'Password',
  passwordPlaceholderSignIn: 'Enter your password',
  passwordPlaceholderSignUp: 'Create a password',
  confirmPassword: 'Confirm password',
  confirmPasswordPlaceholder: 'Confirm your password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  termsLead: 'By continuing, you agree to our',
  terms: 'Terms',
  privacyPolicy: 'Privacy Policy',
  resetTitle: 'Set a new password',
  resetBody: 'Choose a new password for your Mystash account.',
  resetSubmit: 'Update password',
  forgotTitle: 'Reset password',
  forgotBody: 'Enter the email for your account. If it exists, we will send a reset link.',
  forgotSubmit: 'Send reset link',
  backToSignIn: 'Back to sign in',
} as const;

const RATE_LIMIT_CODES = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
]);

function isOfflineMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('network error') ||
    m.includes('internet connection')
  );
}

export function formatAuthError(
  err: { message?: string; code?: string } | null | undefined,
  context: 'signin' | 'signup' | 'resend' | 'recovery' | 'callback' | 'update-password' | 'google' = 'signin',
): string {
  if (!err) return 'Something went wrong. Please try again.';
  const code = err.code ?? '';
  const message = err.message ?? '';

  if (isOfflineMessage(message)) return AUTH_COPY.offline;
  if (RATE_LIMIT_CODES.has(code) || /rate limit|too many/i.test(message)) return AUTH_COPY.rateLimited;
  if (code === 'email_not_confirmed') return AUTH_COPY.emailNotConfirmed;
  if (code === 'invalid_credentials') return AUTH_COPY.invalidCredentials;
  if (code === 'user_banned') return AUTH_COPY.accountDisabled;
  if (code === 'weak_password' || /password.*(?:8|least)/i.test(message)) return AUTH_COPY.weakPassword;
  if (
    code === 'otp_expired' ||
    code === 'flow_state_expired' ||
    /expired/i.test(message)
  ) {
    return AUTH_COPY.expiredLink;
  }
  if (
    code === 'otp_disabled' ||
    code === 'flow_state_not_found' ||
    /already been used|invalid.*(otp|token|link)/i.test(message)
  ) {
    return AUTH_COPY.invalidLink;
  }
  if (/code verifier not found/i.test(message)) {
    return AUTH_COPY.googleFailed;
  }

  if (context === 'signup' || context === 'resend') {
    if (
      code === 'user_already_exists' ||
      /already registered|already exists|user already/i.test(message)
    ) {
      return AUTH_COPY.genericSignUp;
    }
  }

  if (context === 'recovery') {
    return AUTH_COPY.genericRecovery;
  }

  if (context === 'google') {
    return message || AUTH_COPY.googleFailed;
  }

  return message || 'Something went wrong. Please try again.';
}
