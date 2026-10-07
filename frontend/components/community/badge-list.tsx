import type {CommunityBadge} from '../../lib/community-types';
import styles from './post-detail.module.css';

// member-card.js's authorBadge(). There is no badge artwork yet, so the mark is
// a text check. `compact` hides the description (shown as a tooltip instead).
export default function BadgeList({
  badges,
  empty,
  compact = false,
}: {
  badges: CommunityBadge[];
  empty: string;
  compact?: boolean;
}) {
  if (!badges.length) return <p className={styles.muted}>{empty}</p>;
  return (
    <div className={styles.badgeList}>
      {badges.map((badge) => (
        <div
          key={badge.code}
          className={compact ? styles.badgeCompact : styles.badge}
          title={compact ? badge.description : undefined}
        >
          <span className={styles.badgeMark} aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>{badge.name}</strong>
            {!compact && <p className={styles.muted}>{badge.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
