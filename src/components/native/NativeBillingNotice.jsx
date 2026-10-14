import { NATIVE_BILLING_MESSAGE, NATIVE_SIGNUP_MESSAGE } from '@/lib/native/platform';

export default function NativeBillingNotice({ variant = 'billing' }) {
  const message = variant === 'signup' ? NATIVE_SIGNUP_MESSAGE : NATIVE_BILLING_MESSAGE;
  return (
    <div className="max-w-lg mx-auto p-6" data-testid={variant === 'signup' ? 'native-signup-notice' : 'native-billing-notice'}>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          {variant === 'signup' ? 'Sign in' : 'Subscription'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      </div>
    </div>
  );
}
