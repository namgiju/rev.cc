// Ported from assignment-frontend/js/footer.js + css/footer.css — same
// copy/links/structure, restyled with this app's CSS Modules instead of the
// old global stylesheet. No session/role/API dependency, same as the
// original ("Shared service footer."). Usable on any page: import and
// render as the last child of the page's root element.
'use client';

import Logo from '../common/logo';
import styles from './site-footer.module.css';

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
}

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <a href="/" aria-label="REV.CC 홈">
              <Logo height={32} />
            </a>
            <p>차로 연결되는 일상</p>
          </div>
          <nav className={styles.services} aria-label="Footer 서비스">
            <h2>서비스</h2>
            <a href="/community">커뮤니티</a>
            <a href="/home">내 차고</a>
            <a href="/parts">부품 찾기</a>
          </nav>
          <div className={styles.info}>
            <h2>REV.CC</h2>
            <dl>
              <div>
                <dt>대표</dt>
                <dd>남기주</dd>
              </div>
              <div>
                <dt>사업자등록번호</dt>
                <dd>000-00-00000</dd>
              </div>
              <div>
                <dt>소재지</dt>
                <dd>
                  경기도 성남시 수정구 성남대로 1342
                  <br />
                  가천대학교 AI공학관
                </dd>
              </div>
              <div>
                <dt>이메일</dt>
                <dd>
                  <a href="mailto:wjswkemd@gachon.ac.kr">wjswkemd@gachon.ac.kr</a>
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className={styles.bottom}>
          <div>
            <p className={styles.copyright}>
              <span>© 2026 REV.CC</span>
              <span>Built for car people.</span>
            </p>
            <p className={styles.disclaimer}>
              현재 개발 중인 프로젝트이며, 표시된 사업자 정보는 UI 테스트를 위한 임시 정보입니다.
            </p>
          </div>
          <button type="button" className={styles.toTop} onClick={scrollToTop}>
            맨 위로 ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
