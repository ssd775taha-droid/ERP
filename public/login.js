(function () {
  var $ = function (id) { return document.getElementById(id); };
  var setup = false;
  function err(m) { var e = $('err'); e.textContent = m || ''; e.style.display = m ? 'block' : 'none'; }
  fetch('/api/auth/state', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (s) {
    if (s.user) { location.replace('/'); return; }
    setup = s.needsSetup;
    if (setup) {
      $('sub').textContent = 'إعداد أول مرة: أنشئ حساب مالك المنصة';
      $('nameRow').hidden = false; $('go').textContent = 'إنشاء الحساب'; $('p').autocomplete = 'new-password';
    }
  });
  $('f').addEventListener('submit', function (e) {
    e.preventDefault(); err('');
    var b = $('go'); b.disabled = true;
    fetch(setup ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('u').value, password: $('p').value, name: $('name').value })
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'تعذّر الدخول'); }); })
      .then(function () { location.replace('/'); })
      .catch(function (x) { err(x.message); b.disabled = false; });
  });
})();
