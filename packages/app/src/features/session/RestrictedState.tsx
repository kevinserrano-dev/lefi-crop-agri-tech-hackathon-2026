import { useNavigate } from '@tanstack/react-router';
import { Button, EmptyState } from '../../shared/ui';
import styles from './session.module.css';

export function RestrictedState({
  roleName,
  permission,
}: {
  roleName?: string | undefined;
  permission?: string | undefined;
}) {
  const navigate = useNavigate();
  return (
    <EmptyState
      mascot="sad"
      title="Access restricted"
      action={<Button onClick={() => void navigate({ to: '/' })}>Back to my workspace</Button>}
    >
      Your role
      {roleName ? (
        <>
          , <b>{roleName}</b>,
        </>
      ) : (
        ''
      )}{' '}
      doesn’t include
      {permission ? (
        <>
          {' '}
          the <code className={styles.code}>{permission}</code> permission
        </>
      ) : (
        ' this permission'
      )}
      . Ask an administrator if you need it.
    </EmptyState>
  );
}
