(() => {
  const $ = s => document.querySelector(s);
  let token = '', email = '', busy = false;
  function message(text, kind = 'success') { const n = $('#auth-message'); n.textContent = text; n.dataset.kind = kind; n.hidden = false; n.focus(); }
  async function post(step, body) {
    const r = await fetch('/api/auth/password-reset/' + step, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const data = await r.json().catch(() => ({}));
    if (!r.ok && step === 'request' && ['USERNAME_NOT_FOUND','IDENTITY_MISMATCH','SOCIAL_ACCOUNT','MAIL_UNAVAILABLE'].includes(data.code))
      throw new Error(data.message);
    if (!r.ok) throw new Error(r.status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해주세요.' : r.status === 503 ? '메일 인증 설정을 확인 중입니다. 잠시 후 다시 시도해주세요.' : '인증 정보 또는 입력값을 확인해주세요. 만료된 경우 처음부터 다시 인증해주세요.');
    return data;
  }
  function bind(id, action) { $(id).addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return; busy = true;
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await action(); } catch (e) { message(e.message, 'error'); }
    finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
  }); }
  bind('#email-form', async () => {
    email = $('#reset-email').value.trim();
    const username = $('#reset-username').value;
    if (!username.trim()) throw new Error('아이디를 입력해주세요.');
    const r = await post('request', {username, email});
    if (r.code !== 'CODE_SENT') throw new Error('발송 상태를 확인하지 못했습니다. 다시 시도해주세요.');
    message(r.message);
    $('#reset-username').readOnly = true; $('#reset-email').readOnly = true; $('#code-form').hidden = false; $('#reset-code').focus();
  });
  bind('#code-form', async () => {
    const r = await post('verify', {email, code:$('#reset-code').value}); token = r.resetToken;
    $('#reset-code').value = ''; $('#email-form').hidden = true; $('#code-form').hidden = true;
    $('#password-form').hidden = false; message('인증되었습니다. 새 비밀번호를 입력해주세요.'); $('#new-password').focus();
  });
  bind('#password-form', async () => {
    const password = $('#new-password').value, confirm = $('#new-confirm').value;
    if (!password.trim() || password.length < 8 || password !== confirm || new TextEncoder().encode(password).length > 72) throw new Error('비밀번호는 8자 이상, UTF-8 72바이트 이하이며 확인 값과 같아야 합니다.');
    await post('complete', {token, password, confirm}); token = ''; $('#password-form').reset(); location.replace('/login?reset=1');
  });
  window.addEventListener('pagehide', () => { token = ''; document.querySelectorAll('form').forEach(f => f.reset()); });
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
})();
