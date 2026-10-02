import type {GarageEntry} from '../../lib/home-types';
import {imageUrl} from '../../lib/format';
import styles from './home.module.css';

// "오늘의 차고": 실제 공개 차고 목록(GET /api/board/garage)에서 하루 단위로
// 고른 차량 한 대. 선정 기준은 lib/format.ts의 pickGarageSpotlight 주석 참고.
// 차량 하나를 보여주는 "공개 차고 페이지"가 따로 없어, 기존에 이미 있는
// /community#member-{id} 경로(오너 프로필 모달)로 연결한다.
export default function GarageSpotlight({vehicle}: {vehicle: GarageEntry | null}) {
  if (!vehicle) {
    return (
      <div className={styles.garageSpotlight} data-state="empty">
        <p className={styles.empty}>아직 등록된 차량이 없어요.</p>
      </div>
    );
  }
  const detail = [vehicle.year ? `${vehicle.year}년` : null, vehicle.trim || null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={styles.garageSpotlight}>
      <div className={styles.garageSpotlightMedia}>
        {vehicle.imageId ? (
          <img src={imageUrl(vehicle.imageId)} alt={vehicle.model} loading="lazy" />
        ) : (
          <span className={styles.postNoPhoto} aria-hidden="true" />
        )}
      </div>
      <strong className={styles.garageSpotlightModel}>{vehicle.model}</strong>
      {detail && <p className={styles.garageSpotlightDetail}>{detail}</p>}
      <p className={styles.garageSpotlightOwner}>
        {vehicle.username} 님
        {vehicle.recordCount > 0 ? ` · 기록 ${vehicle.recordCount}개` : ''}
      </p>
      <a className={styles.garageSpotlightLink} href={`/community#member-${vehicle.ownerId}`}>
        차고 구경하기 <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
