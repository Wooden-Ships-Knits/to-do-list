import { zodResolver } from '@hookform/resolvers/zod';
import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useLogin, useMe } from '../api/authHooks';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { APP_NAME } from '../features/layout/Sidebar';
import { loginSchema, safeNext } from '../lib/authSchema';
import type { LoginValues } from '../lib/authSchema';
import styles from './AuthPage.module.css';

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  // Already logged in (e.g. the login page was bookmarked): straight to the app.
  if (me.data && !login.isPending) {
    if (me.data.must_change_password) {
      return <Navigate to={`/change-password?next=${encodeURIComponent(next)}`} replace />;
    }
    return <Navigate to={next} replace />;
  }

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login.mutateAsync(values);
      navigate(
        user.must_change_password ? `/change-password?next=${encodeURIComponent(next)}` : next,
        { replace: true },
      );
    } catch (caught) {
      setFormError(
        caught instanceof ApiError ? caught.message : 'Could not log in. Please try again.',
      );
    }
  });

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>
          <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" className={styles.logo} />
          {APP_NAME}
        </p>
        <h1 className={styles.title}>Log in</h1>
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          {formError && (
            <p className={styles.formError} role="alert" data-testid="login-error">
              {formError}
            </p>
          )}
          <div className={styles.field}>
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={errors.username ? true : undefined}
              aria-describedby={errors.username ? 'login-username-error' : undefined}
              {...register('username')}
            />
            {errors.username && (
              <p id="login-username-error" className={styles.error} role="alert">
                {errors.username.message}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <p id="login-password-error" className={styles.error} role="alert">
                {errors.password.message}
              </p>
            )}
          </div>
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              className={styles.submit}
              disabled={login.isPending}
            >
              {login.isPending ? 'Logging in...' : 'Log in'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
