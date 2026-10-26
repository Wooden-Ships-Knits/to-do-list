import { useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../../api/authHooks';
import { Avatar } from '../../components/ui/Avatar';
import { Menu } from '../../components/ui/Menu';
import styles from './Sidebar.module.css';

/** Who is logged in, at the bottom of the sidebar (and of the mobile drawer). */
export function UserMenu({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!me) return null;
  const name = me.person.name;
  const go = (path: string): void => {
    onNavigate?.();
    navigate(path);
  };
  return (
    <Menu
      label={`Account: ${name}`}
      align="start"
      triggerClassName={`${styles.item} ${styles.user}`}
      trigger={
        <>
          <span className={styles.leading}>
            <Avatar name={name} />
          </span>
          {!rail && (
            <span className={styles.userText}>
              <span className={styles.label}>{name}</span>
              <span className={styles.userRole}>{me.is_admin ? 'Admin' : me.username}</span>
            </span>
          )}
        </>
      }
      items={[
        { label: 'Change password', onSelect: () => go('/change-password') },
        { label: 'Users', onSelect: () => go('/users'), hidden: !me.is_admin },
        {
          label: 'Log out',
          onSelect: () =>
            logout.mutate(undefined, {
              onSettled: () => {
                onNavigate?.();
                navigate('/login', { replace: true });
              },
            }),
        },
      ]}
    />
  );
}
