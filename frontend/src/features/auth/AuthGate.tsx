import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authKeys, useMe } from '../../api/authHooks';
import { ApiError, setUnauthorizedHandler } from '../../api/client';
import type { CurrentUser } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { loginUrl, safeNext } from '../../lib/authSchema';
import styles from '../../pages/AuthPage.module.css';

const here = (): string => `${window.location.pathname}${window.location.search}`;

/** Sends the user to the login screen when any request finds the session gone, and to the
 *  password screen when the password still has to be changed. Renders nothing. */
export function UnauthorizedRedirect() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(
    () =>
      setUnauthorizedHandler((problem) => {
        const path = window.location.pathname;
        if (problem === 'password_change_required') {
          qc.setQueryData<CurrentUser>(authKeys.me, (user) =>
            user ? { ...user, must_change_password: true } : user,
          );
          if (path !== '/change-password') {
            navigate(`/change-password?next=${encodeURIComponent(safeNext(here()))}`, {
              replace: true,
            });
          }
          return;
        }
        if (path === '/login') return;
        const target = loginUrl(here());
        qc.clear(); // nothing from the old session stays on screen
        navigate(target, { replace: true });
      }),
    [navigate, qc],
  );
  return null;
}

export function FullPageStatus({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.status}>{children}</div>
    </div>
  );
}

/** Everything inside needs a logged-in user who has already chosen their own password. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const current = `${location.pathname}${location.search}`;

  if (me.isPending) {
    return (
      <FullPageStatus>
        <p role="status">Loading...</p>
      </FullPageStatus>
    );
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to={loginUrl(current)} replace />;
    }
    return (
      <FullPageStatus>
        <div role="alert" className={styles.statusAlert}>
          <p>Could not reach the server. {me.error.message}</p>
          <Button variant="primary" onClick={() => void me.refetch()}>
            Retry
          </Button>
        </div>
      </FullPageStatus>
    );
  }
  if (me.data.must_change_password) {
    return (
      <Navigate to={`/change-password?next=${encodeURIComponent(safeNext(current))}`} replace />
    );
  }
  return <>{children}</>;
}
