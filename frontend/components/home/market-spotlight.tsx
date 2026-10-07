import type {Listing} from '../../lib/home-types';
import {formatMoney, imageUrl, listingUrl, timeAgo} from '../../lib/format';
import styles from './home.module.css';

// "장터 새 매물": 최근 등록된 판매중 매물 상위 2건. 부품장터 메인(/parts)과
// 매물 상세(/parts/{id})는 기존 라우팅을 그대로 쓴다.
export default function MarketSpotlight({listings}: {listings: Listing[]}) {
  if (!listings.length) {
    return <p className={styles.empty}>아직 등록된 매물이 없어요.</p>;
  }
  return (
    <div className={styles.marketList}>
      {listings.map((item) => (
        <a key={item.id} className={styles.marketRow} href={listingUrl(item.id)}>
          <div className={styles.marketThumb}>
            {item.imageIds?.length ? (
              <img src={imageUrl(item.imageIds[0])} alt="" loading="lazy" />
            ) : (
              <span className={styles.postNoPhoto} aria-hidden="true" />
            )}
          </div>
          <div className={styles.marketBody}>
            <strong>{item.title}</strong>
            <span className={styles.marketPrice}>{formatMoney(item.price)}</span>
            <span className={styles.marketTime}>{timeAgo(item.createdAt)}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
