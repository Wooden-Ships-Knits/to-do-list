import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useChangePassword, useLogout, useMe } from '../api/authHooks';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/Toast';
import { FullPageStatus } from '../features/auth/AuthGate';
import { loginUrl, makePasswordSchema, PASSWORD_MIN, safeNext } from '../lib/authSchema';
import type { PasswordValues } from '../lib/authSchema';
import styles from './AuthPage.module.css';

const FIELDS: { name: keyof PasswordValues; label: string; autoComplete: string }[] = [
  { name: 'current', label: 'Current password', autoComplete: 'current-password' },
  { name: 'next', label: 'New password', autoComplete: 'new-password' },
  { name: 'confirm', label: 'Confirm password', autoComplete: 'new-password' },
];

function PasswordForm({ username, forced }: { username: string; forced: boolean }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const toast = useToast();
  const change = useChangePassword();
  const logout = useLogout();
  const schema = useMemo(() => makePasswordSchema(username), [username]);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { current: '', next: '', confirm: '' },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await change.mutateAsync({ current: values.current, next: values.next });
      toast.push({ message: 'Password changed.' });
      navigate(next, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.field === 'current_password') {
        setError('current', { type: 'server', message: caught.message });
      } else if (caught instanceof ApiError && caught.field === 'new_password') {
        setError('next', { type: 'server', message: caught.message });
      } else {
        setFormError(caught instanceof ApiError ? caught.message : 'Could not save the password.');
      }
    }
  });

  const signOut = (): void => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>
          <KeyRound size={18} strokeWidth={1.75} aria-hidden="true" className={styles.logo} />
          {username}
        </p>
        <h1 className={styles.title}>{forced ? 'Choose a new password' : 'Change password'}</h1>
        {forced && (
          <p className={styles.intro}>
            Your password was set for you. Choose your own before you continue.
          </p>
        )}
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          {formError && (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          )}
          {FIELDS.map(({ name, label, autoComplete }) => {
            const id = `pw-${name}`;
            const error = errors[name]?.message;
            const hintId = name === 'next' ? 'pw-next-hint' : undefined;
            const describedBy = [error ? `${id}-error` : null, hintId].filter(Boolean).join(' ');
            return (
              <div className={styles.field} key={name}>
                <label htmlFor={id}>{label}</label>
                <input
                  id={id}
                  type="password"
                  autoComplete={autoComplete}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={describedBy || undefined}
                  {...register(name)}
                />
                {name === 'next' && (
                  <p id="pw-next-hint" className={styles.hint}>
                    At least {PASSWORD_MIN} characters, and not your username.
                  </p>
                )}
                {error && (
                  <p id={`${id}-error`} className={styles.error} role="alert">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          <div className={styles.actions}>
            {forced ? (
              <Button onClick={signOut} disabled={logout.isPending}>
                Log out
              </Button>
            ) : (
              <Link to={next} className={styles.link}>
                Cancel
              </Link>
            )}
            <Button type="submit" variant="primary" disabled={change.isPending}>
              {change.isPending ? 'Saving...' : 'Save password'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

/** Forced after the first login (or a reset), and reachable from the user menu any time. */
export function ChangePasswordPage() {
  const me = useMe();
  if (me.isPending) {
    return (
      <FullPageStatus>
        <p role="status">Loading...</p>
      </FullPageStatus>
    );
  }
  if (me.isError) return <Navigate to={loginUrl('/')} replace />;
  return (
    <PasswordForm
      key={me.data.id}
      username={me.data.username}
      forced={me.data.must_change_password}
    />
  );
}
