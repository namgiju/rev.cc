import {memberUrl} from '../../lib/format';
import styles from './post-detail.module.css';

// app.js's memberLink(). Withdrawn members come back with a null id and no
// public profile, so they get plain text; everyone else links to their public
// garage page.
export default function MemberLink({id, name}: {id: number | null; name: string}) {
  if (id == null) return <span className={styles.memberWithdrawn}>{name}</span>;
  return (
    <a className={styles.memberLink} href={memberUrl(id)}>
      {name}
    </a>
  );
}
