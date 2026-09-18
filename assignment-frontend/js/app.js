const $ = selector => document.querySelector(selector);
let allPosts = [];
let currentQuery = '';
async function api(path, body) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `요청 실패 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}
function notify(message) { $('#notice').textContent = message; }
function element(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function refreshSession() {
  const [core, board] = await Promise.allSettled([api('/api/auth/me'), api('/api/board/me')]);
  const loggedIn = core.status === 'fulfilled';
  $('#core-user').textContent = loggedIn ? `${core.value.username} 님` : '';
  $('#logout').hidden = !loggedIn;
  $('#kakao-login').hidden = loggedIn;
  $('#board-user').textContent = board.status === 'fulfilled'
    ? `${board.value.username} 님, 오늘의 이야기를 남겨주세요.`
    : board.reason.status === 401 ? '이야기를 쓰려면 먼저 로그인해주세요.' : '로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.';
  if (!loggedIn && core.reason.status !== 401) notify('로그인 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
}
function renderPosts() {
  const query = currentQuery.toLocaleLowerCase();
  const posts = allPosts.filter(post => `${post.title} ${post.content} ${post.username}`.toLocaleLowerCase().includes(query));
  $('#posts').replaceChildren();
  $('#search-summary').textContent = currentQuery ? `“${currentQuery}” 검색 결과 ${posts.length}개` : '';
  if (!posts.length) $('#posts').append(element('p', currentQuery ? '일치하는 이야기가 없어요. 다른 검색어로 찾아보세요.' : '아직 이야기가 없어요. 첫 이야기를 남겨주세요.', 'empty'));
  posts.forEach((post, index) => {
    const article = element('article', '', 'post');
    const body = element('div', '', 'post-body');
    body.append(element('h3', post.title), element('p', post.content), element('small', `${post.username} · ${new Date(post.createdAt).toLocaleDateString('ko-KR')}`));
    article.append(element('span', String(index + 1).padStart(2, '0'), 'post-number'), body, element('span', '오너 이야기', 'post-tag'));
    $('#posts').append(article);
  });
}
async function refreshPosts() { allPosts = await api('/api/board/posts'); renderPosts(); }
function search(query, scroll = true) {
  currentQuery = query.trim();
  $('#search-input').value = currentQuery;
  document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button.dataset.query === currentQuery));
  renderPosts();
  if (scroll) $('#community').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
$('#search-form').addEventListener('submit', event => { event.preventDefault(); search($('#search-input').value); });
$('#search-input').addEventListener('input', event => { if (!event.target.value) search('', false); });
document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => search(button.dataset.query)));
$('#logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', {}); await refreshSession(); notify('로그아웃되었습니다.'); }
  catch (err) { notify(err.message); }
});
$('#post-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    await api('/api/board/posts', Object.fromEntries(new FormData(event.target)));
    event.target.reset();
    await refreshPosts();
    search('');
    notify('새로운 이야기를 등록했어요.');
  } catch (err) { notify(err.message); $('#notice').scrollIntoView({ block: 'center' }); }
  finally { button.disabled = false; }
});
let partsRequest = 0;
$('#vehicle-select').addEventListener('change', async event => {
  const request = ++partsRequest;
  $('#parts').replaceChildren();
  if (!event.target.value) return;
  try {
    const data = await api(`/api/parts/compatibility?vehicleId=${encodeURIComponent(event.target.value)}`);
    if (request === partsRequest) $('#parts').replaceChildren(...data.parts.map(part => element('li', part.name)));
  } catch (err) { if (request === partsRequest) notify(err.message); }
});
async function refreshVehicles() {
  const vehicles = await api('/api/vehicles');
  vehicles.forEach(vehicle => {
    const label = `${vehicle.brand} ${vehicle.model}`;
    const row = element('div', '', 'vehicle');
    const icon = element('div', '', 'vehicle-icon'); icon.setAttribute('aria-hidden', 'true');
    row.append(icon, element('strong', label), element('small', `${vehicle.year}년 · ${vehicle.power} hp`));
    $('#vehicles').append(row);
    const option = element('option', label); option.value = vehicle.id; $('#vehicle-select').append(option);
  });
}
async function initialize() {
  const results = await Promise.allSettled([refreshSession(), refreshPosts(), refreshVehicles()]);
  if (results[1].status === 'rejected') $('#posts').replaceChildren(element('p', '이야기를 불러오지 못했어요. 새로고침해서 다시 시도해주세요.', 'empty'));
  if (results[2].status === 'rejected') $('#vehicles').append(element('p', '차량 정보를 불러오지 못했어요.', 'empty'));
  if (results.some(result => result.status === 'rejected')) notify('일부 정보를 불러오지 못했어요. 잠시 후 새로고침해주세요.');
}
initialize();
