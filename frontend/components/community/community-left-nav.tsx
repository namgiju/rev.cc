'use client';

import {CATEGORY_TABS, HEADINGS, newPostHref, SCOPE_LABELS, type Category, type Scope} from './categories';
import styles from './community.module.css';

type Props = {
  category: Category;
  scope: Scope;
  onCategory: (value: Category) => void;
  onScope: (value: Exclude<Scope, ''>) => void;
};

// Left navigation shared by the list and the editor: board categories,
// "＋ 글쓰기", activity shortcuts and the jump to "최근 본 글".
export default function CommunityLeftNav({category, scope, onCategory, onScope}: Props) {
  return (
    <aside className={styles.leftNav} aria-label="커뮤니티 메뉴">
      <h2 className={styles.leftNavHeading}>커뮤니티</h2>
      <div className={styles.categoryList} role="group" aria-label="게시판 분류">
        {CATEGORY_TABS.map((value) => (
          <button
            key={value || 'all'}
            type="button"
            className={category === value ? styles.categoryActive : styles.categoryButton}
            aria-pressed={category === value}
            onClick={() => onCategory(value)}
          >
            {HEADINGS[value][0]}
          </button>
        ))}
      </div>
      <a className={styles.writeLink} href={newPostHref(category)}>
        ＋ 글쓰기
      </a>
      <div className={styles.shortcuts}>
        <h3>빠른 이동</h3>
        {(['mine', 'commented', 'bookmarks'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={scope === s ? styles.shortcutActive : styles.shortcutButton}
            aria-pressed={scope === s}
            onClick={() => onScope(s)}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
        <a className={styles.shortcutLink} href="#community-recent">
          최근 본 글
        </a>
      </div>
    </aside>
  );
}
