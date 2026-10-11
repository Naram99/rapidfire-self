import { useEffect, useState } from 'react';
import { adminAccessSchema } from '@rapidfire/contracts';
import { read } from '../lib/api';
import { t } from '../lib/copy';
import { Link } from '../lib/router';

export function AdminLink({
  userId,
  pathname,
}: {
  userId: string;
  pathname: string;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void read('/api/admin/access', adminAccessSchema, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setIsAdmin(result.isAdmin);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIsAdmin(false);
      });
    return () => controller.abort();
  }, [userId, pathname]);
  return isAdmin ? (
    <Link
      href="/admin/lol-data"
      aria-current={pathname === '/admin/lol-data' ? 'page' : undefined}
    >
      {t('admin')}
    </Link>
  ) : null;
}
