// Shared service footer. No session, role, page routing or API dependencies.
(() => {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  footer.innerHTML = `
    <div class="site-footer-inner">
      <div class="site-footer-top">
        <div class="site-footer-brand">
          <a href="/" aria-label="REV.CC 홈"><img src="/img/logo.png" alt="REV.CC" width="112" height="32"></a>
          <p>차로 연결되는 일상</p>
        </div>
        <nav class="site-footer-services" aria-label="Footer 서비스">
          <h2>서비스</h2>
          <a href="/community">커뮤니티</a>
          <a href="/home">내 차고</a>
          <a href="/parts">부품 찾기</a>
        </nav>
        <div class="site-footer-info">
          <h2>REV.CC</h2>
          <dl>
            <div><dt>대표</dt><dd>남기주</dd></div>
            <div><dt>사업자등록번호</dt><dd>000-00-00000</dd></div>
            <div><dt>소재지</dt><dd>경기도 성남시 수정구 성남대로 1342<br>가천대학교 AI공학관</dd></div>
            <div><dt>이메일</dt><dd><a href="mailto:wjswkemd@gachon.ac.kr">wjswkemd@gachon.ac.kr</a></dd></div>
          </dl>
        </div>
      </div>
      <div class="site-footer-bottom">
        <div>
          <p class="site-footer-copyright"><span>© 2026 REV.CC</span><span>Built for car people.</span></p>
          <p class="site-footer-disclaimer">현재 개발 중인 프로젝트이며, 표시된 사업자 정보는 UI 테스트를 위한 임시 정보입니다.</p>
        </div>
        <button type="button" class="site-footer-to-top">맨 위로 ↑</button>
      </div>
    </div>`;
  footer.querySelector('.site-footer-to-top').addEventListener('click', () => {
    window.scrollTo({top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  });
})();
