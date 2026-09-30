// Existing Spring auth creates the HttpOnly cookie. No credential or session storage here.
(() => {
  const signup = /^\/signup\/?$/.test(location.pathname);
  const $ = (s) => document.querySelector(s);
  const form = $("#auth-form");
  let busy = false;
  let checkedUsername = null, checkGeneration = 0;
  const username = $('#username'), checkButton = $('#check-username'), checkStatus = $('#username-status');
  function invalidateUsername() {
    checkedUsername = null; checkGeneration++;
    checkStatus.textContent = ''; checkStatus.dataset.kind = '';
    checkButton.disabled = false;
  }
  username.addEventListener('input', invalidateUsername);
  username.addEventListener('change', invalidateUsername);
  checkButton.addEventListener('click', async () => {
    if (!signup || busy) return;
    const value = username.value;
    invalidateUsername();
    if (!value.trim() || value.length > 100) {
      checkStatus.textContent = '아이디는 공백만 입력할 수 없으며 최대 100자입니다.';
      checkStatus.dataset.kind = 'error'; return;
    }
    const generation = checkGeneration;
    checkButton.disabled = true; checkStatus.textContent = '확인 중…';
    try {
      const response = await fetch('/api/auth/check-username?' + new URLSearchParams({username:value}), {credentials:'same-origin',cache:'no-store'});
      if (generation !== checkGeneration || username.value !== value) return;
      if (!response.ok) throw new Error(response.status === 429 ? '요청이 많습니다. 잠시 후 다시 확인해주세요.' : '중복확인에 실패했습니다. 다시 시도해주세요.');
      const data = await response.json();
      if (generation !== checkGeneration || username.value !== value) return;
      checkedUsername = data.available === true ? value : null;
      checkStatus.textContent = checkedUsername !== null ? '사용 가능한 아이디입니다.' : '이미 사용 중인 아이디입니다.';
      checkStatus.dataset.kind = checkedUsername !== null ? 'success' : 'error';
    } catch (error) {
      if (generation === checkGeneration) { checkStatus.textContent = error.message; checkStatus.dataset.kind = 'error'; }
    } finally { if (generation === checkGeneration) checkButton.disabled = false; }
  });
  function safeReturn(value) {
    if (
      !value ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      /[\\\x00-\x20]/.test(value)
    )
      return null;
    try {
      const u = new URL(value, location.origin);
      if (
        u.origin !== location.origin ||
        !/^(?:\/|\/home\/?|\/admin\/?|\/parts\/?|\/garage\/?|\/community\/?|\/community\/(?:free|maintenance|parts|drive)\/[0-9]+)$/.test(
          u.pathname,
        )
      )
        return null;
      return u.pathname + u.search + u.hash;
    } catch {
      return null;
    }
  }
  const next = safeReturn(new URLSearchParams(location.search).get("next"));
  const route = (path) => next === null ? path : path + "?" + new URLSearchParams({ next });
  document.title = `REV.CC | ${signup ? "회원가입" : "로그인"}`;
  document
    .querySelectorAll(".signup-only")
    .forEach((n) => (n.hidden = !signup));
  for (const id of ["password-confirm", "terms", "privacy"]) {
    $("#" + id).disabled = !signup;
    $("#" + id).required = signup;
  }
  $("#password").autocomplete = signup ? "new-password" : "current-password";
  form.action = signup ? "/api/auth/signup" : "/api/auth/login";
  $("#auth-submit").textContent = signup ? "회원가입" : "로그인";
  $("#auth-submit").disabled = false;
  if (signup) {
    $("#auth-title").textContent = "Join REV.CC";
    $("#auth-description").textContent = "차로 연결되는 일상을 시작하세요.";
    $("#kakao-label").textContent = "카카오로 시작하기";
    $("#switch-description").textContent = "이미 회원이신가요?";
    $("#auth-switch").textContent = "로그인 →";
  }
  $("#auth-switch").href = route(signup ? "/login" : "/signup");
  function message(text, kind = "error") {
    const node = $("#auth-message");
    node.textContent = text;
    node.dataset.kind = kind;
    node.hidden = false;
    node.focus();
  }
  if (!signup && new URLSearchParams(location.search).get("joined") === "1")
    message(
      "회원가입이 완료되었습니다. 새 계정으로 로그인해주세요.",
      "success",
    );
  if (!signup && new URLSearchParams(location.search).get("reset") === "1")
    message("비밀번호가 변경되었습니다. 다시 로그인해주세요.", "success");
  document.querySelectorAll("[data-password]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = $("#" + button.dataset.password),
        show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "숨기기" : "보기";
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute(
        "aria-label",
        `${input.id === "password" ? "비밀번호" : "비밀번호 확인"} ${show ? "숨기기" : "표시"}`,
      );
    }),
  );
  const clearPasswords = () => {
    document.querySelectorAll(".password-field input").forEach((input) => {
      input.value = "";
      input.type = "password";
    });
    document.querySelectorAll("[data-password]").forEach((b) => {
      b.textContent = "보기";
      b.setAttribute("aria-pressed", "false");
      b.setAttribute(
        "aria-label",
        `${b.dataset.password === "password" ? "비밀번호" : "비밀번호 확인"} 표시`,
      );
    });
  };
  window.addEventListener("pagehide", clearPasswords);
  window.addEventListener("pageshow", () => {
    busy = false;
    invalidateUsername();
    form.inert = false;
    $("#auth-submit").disabled = false;
    $("#auth-submit").textContent = signup ? "회원가입" : "로그인";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (signup && checkedUsername !== username.value) {
      message('아이디 중복확인을 해주세요.'); checkButton.focus(); return;
    }
    if (signup && $("#password").value !== $("#password-confirm").value) {
      message("비밀번호 확인이 일치하지 않습니다.");
      $("#password-confirm").focus();
      return;
    }
    if (signup && $("#password").value.length < 8) {
      message("비밀번호는 8자 이상으로 입력해주세요.");
      $("#password").focus();
      return;
    }
    if (signup && new TextEncoder().encode($("#password").value).length > 72) {
      message("비밀번호는 UTF-8 72바이트 이하로 입력해주세요.");
      return;
    }
    if (!$("#username").value.trim() || !$("#password").value.trim()) {
      message("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    if (!form.reportValidity()) return;
    busy = true;
    form.inert = true;
    $("#auth-submit").disabled = true;
    $("#auth-submit").textContent = signup ? "가입 중..." : "로그인 중...";
    $("#auth-message").hidden = true;
    try {
      const response = await fetch(form.action, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: $("#username").value,
          password: $("#password").value,
          ...(signup && $("#email").value.trim() ? {email: $("#email").value.trim()} : {}),
        }),
      });
      if (!response.ok) {
        if (!signup && [400, 401].includes(response.status))
          message("아이디 또는 비밀번호가 올바르지 않습니다.");
        else if (signup && response.status === 409) {
          invalidateUsername();
          message("이미 사용 중인 아이디 또는 이메일입니다. 아이디 중복확인을 다시 해주세요.");
        }
        else if (response.status === 400)
          message(
            "입력 내용을 확인해주세요. 아이디는 최대 100자, 비밀번호는 8자 이상 UTF-8 72바이트까지 가능합니다.",
          );
        else message("요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      await response.json();
      clearPasswords();
      if (signup) location.replace(route("/login") + (next === null ? "?" : "&") + "joined=1");
      else {
        const me = await fetch("/api/auth/me", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!me.ok) {
          message(
            "로그인 세션을 확인하지 못했습니다. 쿠키 설정을 확인하고 다시 로그인해주세요.",
          );
          return;
        }
        const user = await me.json();
        location.replace(next ?? (user.role === "ADMIN" ? "/admin" : "/"));
      }
    } catch {
      message(
        "서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.",
      );
    } finally {
      clearPasswords();
      busy = false;
      form.inert = false;
      $("#auth-submit").disabled = false;
      $("#auth-submit").textContent = signup ? "회원가입" : "로그인";
    }
  });
})();
