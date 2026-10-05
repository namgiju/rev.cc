import type {CommunityPost} from '../../lib/community-types';
import {imageUrl} from '../../lib/format';
import type {AuthorState} from './post-detail';
import BadgeList from './badge-list';
import MemberLink from './member-link';
import styles from './post-detail.module.css';

// Left sidebar: member-card.js's memberProfileCard() for post.authorId.
// The cover photo is the profile cover or the representative vehicle's photo
// (alt says which); the avatar falls back to the first letter of the name —
// a vehicle photo is never shown as the member's profile picture.
export default function AuthorCard({post, author}: {post: CommunityPost; author: AuthorState}) {
  if (author.status === 'withdrawn') return <p className={styles.muted}>{post.username}</p>;
  if (author.status === 'loading') return <p className={styles.muted}>정보를 불러오고 있어요.</p>;
  if (author.status === 'error') return <p className={styles.muted}>작성자 정보를 불러오지 못했어요.</p>;

  const {member} = author;
  const representative = member.representativeVehicle;
  const coverId = member.coverImageId || representative?.imageId || null;
  const stats: [string, string | number][] = [
    ['가입일', member.joinedAt ? new Date(member.joinedAt).toLocaleDateString('ko-KR') : '기록 없음'],
    ['게시글', member.postCount],
    ['댓글', member.commentCount],
    ['받은 추천', member.receivedLikes],
  ];

  return (
    <section className={styles.card}>
      {coverId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.authorCover}
          src={imageUrl(coverId)}
          alt={member.coverImageId ? '프로필 커버' : `작성자의 차량 · ${representative?.model}`}
        />
      )}
      <h3>작성자</h3>
      <div className={styles.authorIdentity}>
        {member.avatarImageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.avatar} src={imageUrl(member.avatarImageId)} alt={member.username} />
        ) : (
          <div className={styles.avatar} aria-label="프로필 사진 미등록">
            {[...member.username][0] || ''}
          </div>
        )}
        <MemberLink id={member.id} name={member.username} />
        {representative && <p className={styles.authorCar}>{representative.model}</p>}
        {member.verified && <span className={styles.verified}>✓ 오너 인증 완료</span>}
        {member.bio && <p className={styles.muted}>{member.bio}</p>}
      </div>
      <BadgeList badges={member.badges.slice(0, 3)} empty="표시할 인장이 없어요." compact />
      <dl className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>보유 차량 {member.vehicles.length}</h3>
      {member.vehicles.length ? (
        member.vehicles.map((vehicle) => (
          // Public vehicle view isn't in Next.js yet (STEP 2-5); legacy hash link.
          <a key={vehicle.id} className={styles.contextRow} href={`/community#car-${vehicle.id}`}>
            {vehicle.imageId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl(vehicle.imageId)} alt={vehicle.model} loading="lazy" />
            )}
            <div>
              <strong>{vehicle.nickname || vehicle.model}</strong>
              <p className={styles.muted}>
                {[vehicle.year, vehicle.model, vehicle.trim, vehicle.verified ? '인증' : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
          </a>
        ))
      ) : (
        <p className={styles.muted}>등록한 차량이 없어요.</p>
      )}
    </section>
  );
}
