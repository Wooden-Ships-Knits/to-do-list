import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useCreateUser, useMe, usePatchUser, useResetPassword, useUsers } from '../api/authHooks';
import { useMeta } from '../api/hooks';
import { ApiError } from '../api/client';
import type { AdminUser } from '../api/types';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Menu } from '../components/ui/Menu';
import { Overlay } from '../components/ui/Overlay';
import { TableSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/Toast';
import { userSchema } from '../lib/authSchema';
import type { UserValues } from '../lib/authSchema';
import { formatDateTime } from '../lib/dates';
import styles from './UsersPage.module.css';

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { username: '', name: '' },
  });

  const close = (): void => {
    reset();
    setFormError(null);
    onClose();
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await create.mutateAsync(values);
      toast.push({
        message: `Added ${user.person.name}. They log in as "${user.username}" with the password "${user.username}" and choose their own.`,
      });
      close();
    } catch (caught) {
      if (caught instanceof ApiError && caught.field === 'username') {
        setError('username', { type: 'server', message: caught.message });
      } else if (caught instanceof ApiError && caught.field === 'person_name') {
        setError('name', { type: 'server', message: caught.message });
      } else {
        setFormError(caught instanceof ApiError ? caught.message : 'Could not add the user.');
      }
    }
  });

  return (
    <Overlay
      open={open}
      onClose={close}
      variant="dialog"
      title="Add user"
      testId="add-user"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="add-user-form" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Adding...' : 'Add user'}
          </Button>
        </>
      }
    >
      <form
        id="add-user-form"
        className={styles.form}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        {formError && (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}
        <div className={styles.field}>
          <label htmlFor="new-user-name">Name</label>
          <input
            id="new-user-name"
            type="text"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={`new-user-name-hint${errors.name ? ' new-user-name-error' : ''}`}
            {...register('name')}
          />
          <p id="new-user-name-hint" className={styles.hint}>
            Shown as the PIC and in the history. An existing person is linked.
          </p>
          {errors.name && (
            <p id="new-user-name-error" className={styles.error} role="alert">
              {errors.name.message}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="new-user-username">Username</label>
          <input
            id="new-user-username"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={errors.username ? true : undefined}
            aria-describedby={`new-user-username-hint${errors.username ? ' new-user-username-error' : ''}`}
            {...register('username')}
          />
          <p id="new-user-username-hint" className={styles.hint}>
            The first password is the same as the username; it must be changed at the first login.
          </p>
          {errors.username && (
            <p id="new-user-username-error" className={styles.error} role="alert">
              {errors.username.message}
            </p>
          )}
        </div>
      </form>
    </Overlay>
  );
}

function UserRow({
  user,
  isMe,
  timeZone,
  onReset,
}: {
  user: AdminUser;
  isMe: boolean;
  timeZone: string;
  onReset: (user: AdminUser) => void;
}) {
  const patch = usePatchUser();
  const toast = useToast();
  const name = user.person.name;
  const change = (body: { is_admin?: boolean; is_active?: boolean }, done: string): void => {
    patch.mutate(
      { id: user.id, patch: body },
      {
        onSuccess: () => toast.push({ message: done }),
        onError: (error) => toast.push({ kind: 'error', message: error.message }),
      },
    );
  };
  return (
    <tr data-username={user.username} className={user.is_active ? undefined : styles.inactive}>
      <td data-label="User">
        <span className={styles.who}>
          <Avatar name={name} />
          <span className={styles.whoText}>
            <span className={styles.name}>
              {name}
              {isMe && <span className={styles.me}> (you)</span>}
            </span>
            <span className={styles.username}>{user.username}</span>
          </span>
        </span>
      </td>
      <td data-label="Role">{user.is_admin ? 'Admin' : 'Member'}</td>
      <td data-label="Status">
        <span className={user.is_active ? undefined : styles.muted}>
          {user.is_active ? 'Active' : 'Deactivated'}
        </span>
        {user.must_change_password && user.is_active && (
          <span className={styles.note}>Must choose a password</span>
        )}
      </td>
      <td data-label="Last login" className="num">
        {user.last_login_at ? formatDateTime(user.last_login_at, timeZone) : 'Never'}
      </td>
      <td className={styles.actions}>
        {isMe ? (
          <span className={styles.muted}>
            <Link to="/change-password" className={styles.link}>
              Change password
            </Link>
          </span>
        ) : (
          <Menu
            label={`Actions for ${name}`}
            items={[
              { label: 'Reset password', onSelect: () => onReset(user) },
              {
                label: user.is_admin ? 'Remove admin' : 'Make admin',
                onSelect: () =>
                  change(
                    { is_admin: !user.is_admin },
                    user.is_admin ? `${name} is no longer an admin.` : `${name} is now an admin.`,
                  ),
              },
              {
                label: user.is_active ? 'Deactivate' : 'Activate',
                danger: user.is_active,
                onSelect: () =>
                  change(
                    { is_active: !user.is_active },
                    user.is_active
                      ? `${name} is deactivated and logged out.`
                      : `${name} can log in again.`,
                  ),
              },
            ]}
          />
        )}
      </td>
    </tr>
  );
}

export function UsersPage() {
  const { data: me } = useMe();
  const isAdmin = me?.is_admin ?? false;
  const users = useUsers(isAdmin);
  const { data: meta } = useMeta();
  const reset = useResetPassword();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const timeZone = meta?.timezone ?? 'UTC';

  const confirmReset = (): void => {
    const user = resetting;
    if (!user) return;
    reset.mutate(user.id, {
      onSuccess: () =>
        toast.push({
          message: `Password reset. ${user.person.name} logs in with "${user.username}" and chooses a new one.`,
        }),
      onError: (error) => toast.push({ kind: 'error', message: error.message }),
      onSettled: () => setResetting(null),
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          Back to projects
        </Link>
        <div className={styles.titleRow}>
          <h1>Users</h1>
          {isAdmin && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus size={16} strokeWidth={1.75} aria-hidden="true" />
              Add user
            </Button>
          )}
        </div>
      </header>

      {!isAdmin && (
        <p className={styles.card} role="alert">
          Only admins can manage users.
        </p>
      )}
      {isAdmin && users.isPending && <TableSkeleton columns={5} />}
      {isAdmin && users.isError && (
        <div className={styles.card} role="alert">
          <p>Could not load users: {users.error.message}</p>
          <Button onClick={() => void users.refetch()}>Retry</Button>
        </div>
      )}
      {isAdmin && users.data && (
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="users-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last login</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isMe={user.id === me?.id}
                  timeZone={timeZone}
                  onReset={setResetting}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserDialog open={adding} onClose={() => setAdding(false)} />
      <Overlay
        open={resetting !== null}
        onClose={() => setResetting(null)}
        variant="dialog"
        title="Reset password?"
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmReset} disabled={reset.isPending}>
              Reset password
            </Button>
          </>
        }
      >
        {resetting && (
          <p>
            {resetting.person.name}&apos;s password becomes &quot;{resetting.username}&quot; and
            they choose a new one at the next login. They are logged out everywhere.
          </p>
        )}
      </Overlay>
    </div>
  );
}
