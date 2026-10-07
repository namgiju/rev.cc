import type {Listing} from '../../lib/parts-types';
import {LISTING_CATEGORIES, LISTING_STATUSES} from '../../lib/parts-types';
import {formatMoney, imageUrl, listingUrl, memberUrl} from '../../lib/format';
import styles from './parts.module.css';

// One card in the /parts grid (market.js's card()). The favorite button sits
// outside the link so clicking ♥ doesn't navigate to the detail page.
export default function ListingCard({
  item,
  favoriteBusy,
  onToggleFavorite,
}: {
  item: Listing;
  favoriteBusy: boolean;
  onToggleFavorite: (item: Listing) => void;
}) {
  return (
    <article className={styles.card}>
      <a className={styles.cardLink} href={listingUrl(item.id)}>
        <div className={styles.visual}>
          {item.imageIds.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl(item.imageIds[0])} alt="" loading="lazy" />
          ) : (
            <span className={styles.noPhoto}>등록된 사진 없음</span>
          )}
          <span className={`${styles.status} ${styles[item.status]}`}>{LISTING_STATUSES[item.status]}</span>
        </div>
        <div className={styles.cardBody}>
          <h3>{item.title}</h3>
          <strong className={styles.price}>{formatMoney(item.price)}</strong>
        </div>
      </a>
      <p className={styles.fitment}>{LISTING_CATEGORIES[item.category]}</p>
      <p className={styles.fitment}>판매자 제공 차종 · {item.vehicle}</p>
      <p className={styles.fitment}>
        {item.region} · {new Date(item.createdAt).toLocaleDateString('ko-KR')}
      </p>
      <div className={styles.cardFooter}>
        {item.sellerId == null ? (
          <span className={styles.muted}>{item.username}</span>
        ) : (
          <a href={memberUrl(item.sellerId)}>{item.username}</a>
        )}
        <button
          type="button"
          className={styles.favorite}
          aria-pressed={item.favorited}
          disabled={favoriteBusy}
          onClick={() => onToggleFavorite(item)}
        >
          {item.favorited ? '♥' : '♡'} 관심 {item.favoriteCount}
        </button>
      </div>
    </article>
  );
}
