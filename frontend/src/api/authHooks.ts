import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AdminUser, CurrentUser } from './types';

export const authKeys = {
  me: ['me'] as const,
  users: ['users'] as const,
};

/** The logged-in user. A 401 (no session) is an answer here, not an error to retry. */
export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: api.me,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.login(username, password),
    onSuccess: (user) => {
      // Whatever was cached belonged to the previous session.
      qc.clear();
      qc.setQueryData<CurrentUser>(authKeys.me, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear();
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      api.changePassword(current, next),
    onSuccess: () => {
      qc.setQueryData<CurrentUser>(authKeys.me, (user) =>
        user ? { ...user, must_change_password: false } : user,
      );
    },
  });
}

export function useUsers(enabled: boolean) {
  return useQuery({ queryKey: authKeys.users, queryFn: api.users, enabled });
}

function useUserListUpdate() {
  const qc = useQueryClient();
  return (user: AdminUser): void => {
    qc.setQueryData<AdminUser[]>(authKeys.users, (list) => {
      if (!list) return list;
      const others = list.filter((u) => u.id !== user.id);
      return [...others, user].sort((a, b) => a.username.localeCompare(b.username));
    });
    // A new person may have been created with the account.
    void qc.invalidateQueries({ queryKey: ['persons'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
  };
}

export function useCreateUser() {
  const update = useUserListUpdate();
  return useMutation({
    mutationFn: ({ username, name }: { username: string; name: string }) =>
      api.createUser(username, name),
    onSuccess: update,
  });
}

export function usePatchUser() {
  const update = useUserListUpdate();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { is_admin?: boolean; is_active?: boolean };
    }) => api.patchUser(id, patch),
    onSuccess: update,
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.resetPassword(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authKeys.users }),
  });
}
