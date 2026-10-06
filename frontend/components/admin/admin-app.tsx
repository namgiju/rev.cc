'use client';

import {useCallback, useState} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {useCommunitySession} from '../community/use-community-session';
import CommunityHeader from '../community/community-header';
import SiteFooter from '../footer/site-footer';
import OverviewPanel from './overview-panel';
import MembersPanel from './members-panel';
import PostsPanel from './posts-panel';
import LogsPanel from './logs-panel';
import ReportsPanel from './reports-panel';
import VehiclesPanel from './vehicles-panel';
import TagsPanel from './tags-panel';
import styles from './admin.module.css';

const PANELS = [
  {key: 'overview', label: '대시보드'},
  {key: 'members', label: '회원 관리'},
  {key: 'posts', label: '게시글 관리'},
  {key: 'logs', label: '운영 로그'},
  {key: 'reports', label: '신고 관리'},
  {key: 'vehicles', label: '차량 인증 관리'},
  {key: 'tags', label: '인장 현황'},
] as const;
type PanelKey = (typeof PANELS)[number]['key'];

function isPanelKey(value: string | null): value is PanelKey {
  return PANELS.some((p) => p.key === value);
}

// /admin — 단일 페이지 + ?panel= 탭 구조로 legacy
// assignment-frontend/admin/index.html + js/admin.js를 포팅. 관리자 권한은
// 서버가 매 요청마다 다시 검증하므로(AdminController/AdminMemberController의
// requireAdmin(), board-service의 requireCurrentAdmin()), 화면은 그 결과를
// 그대로 반영한다 — 어느 패널의 API 호출이든 401/403을 받으면 즉시 접근
// 거부 화면으로 전환한다(legacy의 api() 공용 핸들러와 동일).
export default function AdminApp() {
  const auth = useCommunitySession();
  const {session} = auth;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [denied, setDenied] = useState(false);

  const panelParam = searchParams.get('panel');
  const panel: PanelKey = isPanelKey(panelParam) ? panelParam : 'overview';

  function setPanel(next: PanelKey) {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('panel');
    else params.set('panel', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, {scroll: false});
  }

  const onAccessDenied = useCallback(() => setDenied(true), []);

  const isAdmin = !!session && session.role === 'ADMIN' && !denied;

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search=""
        onSearchChange={() => {}}
        onSearchSubmit={(value) => {
          window.location.href = value ? `/community?q=${encodeURIComponent(value)}` : '/community';
        }}
        loginNext={encodeURIComponent(pathname)}
      />
      <main className={styles.main}>
        {session === undefined && !denied && <p className={styles.notice}>관리자 정보를 확인하고 있어요.</p>}
        {session === null && !denied && (
          <div className={styles.loginRequired}>
            <p>이 페이지는 관리자 계정으로 로그인해야 접근할 수 있습니다.</p>
            <a href={`/login?next=${encodeURIComponent(pathname)}`}>로그인하기</a>
          </div>
        )}
        {session !== undefined && session !== null && !isAdmin && (
          <div className={styles.loginRequired}>
            <h1>관리자만 볼 수 있어요</h1>
            <p>이 페이지는 관리자 계정으로 로그인해야 접근할 수 있습니다.</p>
            <a href="/home">내 홈으로 돌아가기</a>
          </div>
        )}
        {isAdmin && (
          <>
            <div className={styles.heading}>
              <p className={styles.eyebrow}>ADMIN</p>
              <h1>REV.CC 관리자</h1>
            </div>
            <nav className={styles.tabs} aria-label="관리자 메뉴">
              {PANELS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.tabButton} ${panel === p.key ? styles.tabActive : ''}`}
                  aria-current={panel === p.key ? 'page' : undefined}
                  onClick={() => setPanel(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </nav>
            {panel === 'overview' && <OverviewPanel onAccessDenied={onAccessDenied} />}
            {panel === 'members' && <MembersPanel onAccessDenied={onAccessDenied} />}
            {panel === 'posts' && <PostsPanel onAccessDenied={onAccessDenied} />}
            {panel === 'logs' && <LogsPanel onAccessDenied={onAccessDenied} />}
            {panel === 'reports' && <ReportsPanel onAccessDenied={onAccessDenied} />}
            {panel === 'vehicles' && <VehiclesPanel onAccessDenied={onAccessDenied} />}
            {panel === 'tags' && <TagsPanel onAccessDenied={onAccessDenied} />}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
