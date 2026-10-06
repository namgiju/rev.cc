'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import {ApiError} from '../../lib/admin-api';
import type {Page} from '../../lib/admin-types';
import styles from './admin.module.css';

export type AdminColumn<T> = {
  header: string;
  render: (item: T) => ReactNode;
};

type Props<T> = {
  searchPlaceholder: string;
  searchLabel: string;
  // Extra filter controls (selects) owned by the caller. Their onChange
  // handlers should update state that `load` closes over, so a new `load`
  // identity is what tells this component to reload at page 1 — see below.
  extraFilters?: ReactNode;
  columns: AdminColumn<T>[];
  // Called with this component's own search text + page. Must have a stable
  // identity per filter combination (wrap with useCallback keyed on the
  // caller's own filter state) — a new `load` reloads at page 1, exactly
  // like assignment-frontend/js/admin.js's loadList() resetting page on
  // filter submit.
  load: (params: {q: string; page: number}) => Promise<Page<T>>;
  getRowKey: (item: T) => number | string;
  onAccessDenied: () => void;
  emptyText: string;
};

export type AdminListHandle = {
  // Reloads the current page in place (no filter/page reset) — for after a
  // row's own detail dialog changes it (member edit, report review).
  reload: () => void;
};

// Generic "search + filters + table + pager" list, modeled on
// assignment-frontend/js/admin.js's loadList()/listState — the four
// operational panels (members/posts/logs/reports) share this exact shape.
function AdminListInner<T>(
  {searchPlaceholder, searchLabel, extraFilters, columns, load, getRowKey, onAccessDenied, emptyText}: Props<T>,
  ref: ForwardedRef<AdminListHandle>,
) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const ticketRef = useRef(0);
  const pageRef = useRef(1);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const runLoad = useCallback(
    (targetPage: number) => {
      const ticket = ++ticketRef.current;
      setLoading(true);
      setError('');
      load({q, page: targetPage})
        .then((res) => {
          if (ticket !== ticketRef.current) return;
          setResult(res);
          setPage(targetPage);
        })
        .catch((e) => {
          if (ticket !== ticketRef.current) return;
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            onAccessDenied();
            return;
          }
          setError(e instanceof Error ? e.message : '목록을 불러오지 못했어요.');
        })
        .finally(() => {
          if (ticket === ticketRef.current) setLoading(false);
        });
    },
    [q, load, onAccessDenied],
  );

  // `load`'s identity changes whenever the caller's own filter state changes
  // (category/status/field selects) — that, and a new search term, both
  // reset to page 1.
  useEffect(() => {
    runLoad(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, load]);

  useImperativeHandle(ref, () => ({reload: () => runLoad(pageRef.current)}), [runLoad]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQ(qInput.trim());
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div>
      <form
        className={styles.filters}
        onSubmit={submitSearch}
        role="search"
        aria-label={searchLabel}
      >
        <input
          name="q"
          maxLength={100}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        {extraFilters}
        <button type="submit" className={styles.secondary}>
          검색 / 새로고침
        </button>
      </form>

      {error ? (
        <p className={styles.empty}>{error}</p>
      ) : (
        <>
          <p className={styles.count} aria-live="polite">
            {result ? `총 ${result.total}개 · ${result.page} / ${pages} 페이지` : loading ? '불러오는 중…' : ''}
          </p>
          <div className={styles.tableWrap} aria-busy={loading}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.header}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!result || loading ? (
                  <tr>
                    <td colSpan={columns.length}>불러오는 중…</td>
                  </tr>
                ) : result.items.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length}>{emptyText}</td>
                  </tr>
                ) : (
                  result.items.map((item) => (
                    <tr key={getRowKey(item)}>
                      {columns.map((c) => (
                        <td key={c.header}>{c.render(item)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <nav className={styles.pager} aria-label="페이지">
            <button type="button" className={styles.secondary} disabled={loading || page <= 1} onClick={() => runLoad(page - 1)}>
              이전
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={loading || !result || page * result.pageSize >= result.total}
              onClick={() => runLoad(page + 1)}
            >
              다음
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

const AdminList = forwardRef(AdminListInner) as <T>(
  props: Props<T> & {ref?: ForwardedRef<AdminListHandle>},
) => ReturnType<typeof AdminListInner>;
export default AdminList;
