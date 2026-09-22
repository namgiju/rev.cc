// Role grants one extra destination; the personal garage is always /home.
function renderManagementNav(user) {
  const nav = document.querySelector('nav[aria-label="주 메뉴"]');
  if (!nav) return;
  let item = nav.querySelector('a[href="/admin"]');
  if (!item) { item = document.createElement('a'); item.id='admin-link'; item.href='/admin'; nav.append(item); }
  item.textContent='관리'; item.hidden=user?.role!=='ADMIN';
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
