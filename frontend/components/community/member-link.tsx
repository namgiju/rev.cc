import styles from './post-detail.module.css';

// app.js's memberLink(). Withdrawn members come back with a null id and no
// public profile, so they get plain text. The member profile screen isn't in
// Next.js yet (STEP 2-5); same placeholder href as post-row.tsx.
export default function MemberLink({id, name}: {id: number | null; name: string}) {
  if (id == null) return <span className={styles.memberWithdrawn}>{name}</span>;
  return (
    <a className={styles.memberLink} href={`/community#member-${id}`}>
      {name}
    </a>
  );
}
