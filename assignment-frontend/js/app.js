// 상대 경로 fetch는 항상 Nginx를 통과하며 HttpOnly 쿠키는 브라우저가 전송한다.
const $ = selector => document.querySelector(selector);
async function api(path, body) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `요청 실패 (${response.status})`);
  return data;
}
function notify(message) { $('#notice').textContent = message; }
// 사용자 입력은 innerHTML 대신 textContent로 삽입해 저장형 XSS를 방지한다.
function element(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
async function refreshSession() {
  const results = await Promise.allSettled([api('/api/auth/me'), api('/api/board/me')]);
  ['#core-user', '#board-user'].forEach((selector, index) => {
    $(selector).textContent = results[index].status === 'fulfilled' ? results[index].value.username : '로그인 안 됨 / 연결 확인 필요';
  });
  $('#logout').hidden = results[0].status !== 'fulfilled';
}
async function refreshPosts() {
  const posts = await api('/api/board/posts');
  $('#posts').replaceChildren();
  if (!posts.length) $('#posts').append(element('p', '아직 게시글이 없습니다. 첫 이야기를 남겨보세요.'));
  posts.forEach(post => {
    const article = document.createElement('article');
    article.append(element('h3', post.title), element('small', `${post.username} · ${new Date(post.createdAt).toLocaleString('ko-KR')}`), element('p', post.content));
    $('#posts').append(article);
  });
}
$('#logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', {}); await refreshSession(); notify('로그아웃되었습니다.'); }
  catch (err) { notify(err.message); }
});
$('#post-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button'); button.disabled = true;
  try { await api('/api/board/posts', Object.fromEntries(new FormData(event.target))); event.target.reset(); await refreshPosts(); notify('게시글을 등록했습니다.'); }
  catch (err) { notify(err.message); }
  finally { button.disabled = false; }
});
$('#vehicle-select').addEventListener('change', async event => {
  $('#parts').replaceChildren();
  if (!event.target.value) return;
  try { const data = await api(`/api/parts/compatibility?vehicleId=${encodeURIComponent(event.target.value)}`); $('#parts').replaceChildren(...data.parts.map(part => element('li', part.name))); }
  catch (err) { notify(err.message); }
});
async function initialize() {
  await refreshSession();
  await refreshPosts();
  const vehicles = await api('/api/vehicles');
  vehicles.forEach(vehicle => {
    const label = `${vehicle.brand} ${vehicle.model}`;
    const row = element('div', `${label} · ${vehicle.year} · ${vehicle.power} hp`); row.className = 'vehicle';
    $('#vehicles').append(row);
    const option = element('option', label); option.value = vehicle.id; $('#vehicle-select').append(option);
  });
}
initialize().catch(err => notify(err.message));
