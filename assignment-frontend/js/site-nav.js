// Active navigation is determined by the URL; role only controls visibility.
function syncSiteNav() {
  const path = location.pathname;
  const matches = root => path === root || path.startsWith(root + '/');
  const destination = matches('/community') ? '/community'
    : matches('/home') || matches('/garage') ? '/home'
    : matches('/parts') ? '/parts'
    : matches('/admin') ? '/admin' : null;
  document.querySelectorAll('nav[aria-label="주 메뉴"] a').forEach(link => {
    const active = !link.hidden && new URL(link.href, location.origin).pathname === destination;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
syncSiteNav();
window.addEventListener('popstate', syncSiteNav);
window.addEventListener('hashchange', syncSiteNav);
window.addEventListener('pageshow', syncSiteNav);

// Role grants one extra destination; the personal garage is always /home.
function renderManagementNav(user) {
  const nav = document.querySelector('nav[aria-label="주 메뉴"]');
  if (!nav) return;
  let item = nav.querySelector('a[href="/admin"]');
  if (!item) { item = document.createElement('a'); item.id='admin-link'; item.href='/admin'; nav.append(item); }
  item.textContent='관리'; item.hidden=user?.role!=='ADMIN';
  syncSiteNav();
}

// Keep the current service URL when entering the local login page (including editor hashes).
document.addEventListener('click', event => {
  const anchor=event.target.closest('a[href]');
  if(!anchor)return;
  const url=new URL(anchor.href,location.origin);
  if(url.origin===location.origin && url.pathname==='/login' && !url.search){
    anchor.href='/login?'+new URLSearchParams({next:location.pathname+location.search+location.hash});
  }
},true);
