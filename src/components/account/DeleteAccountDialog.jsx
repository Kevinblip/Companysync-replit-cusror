import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { logoutKeepingBundle } from '@/lib/native/navigation';
import { isNativeApp } from '@/lib/native/platform';

export default function DeleteAccountDialog({ open, onOpenChange, email }) {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const matches = confirmation.trim().toLowerCase() === normalizedEmail && normalizedEmail.length > 0;

  const close = () => {
    if (pending) return;
    setConfirmation('');
    setError('');
    onOpenChange(false);
  };

  const submit = async () => {
    setError('');
    if (!matches) {
      setError('Type your account email to confirm.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmation.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not delete the account. Please try again.');
        setPending(false);
        return;
      }
      if (isNativeApp()) {
        await logoutKeepingBundle();
        return;
      }
      window.location.replace('/login');
    } catch (err) {
      setError(err?.message || 'Could not delete the account. Please try again.');
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AlertDialogContent data-testid="dialog-delete-account">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete account</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes your login and removes you from your company. If you are the only person
            on a company you created, that company is closed. Other people&apos;s accounts are not deleted.
            Type your email to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            Account: <span className="font-medium">{normalizedEmail || 'your email'}</span>
          </p>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            placeholder="Type your email"
            data-testid="input-delete-account-confirmation"
            disabled={pending}
          />
          {error && <p className="text-sm text-red-600" data-testid="text-delete-account-error">{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="button-delete-account-cancel">Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!matches || pending}
            data-testid="button-delete-account-confirm"
          >
            {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Delete my account
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
