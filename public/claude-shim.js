/* جسر المنصة: يوفّر window.claude.use(...) الذي تعتمد عليه الأقسام، فوق خادم تمام برو.
   db: واجهة مستندات/مجموعات بأسلوب Firestore · user · downloads. أما sample (الذكاء الاصطناعي) فغير متاح. */
(function () {
  'use strict';
  var enc = function (v) {
    if (v instanceof Date) return { __d: +v };
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = enc(v[k]); }); return o;
    }
    return v;
  };
  var dec = function (v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      if (Object.keys(v).length === 1 && typeof v.__d === 'number') return new Date(v.__d);
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = dec(v[k]); }); return o;
    }
    return v;
  };
  var clone = function (d) { return d === undefined ? d : dec(JSON.parse(JSON.stringify(enc(d)))); };

  function api(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    }).then(function (r) {
      if (r.status === 401) { location.href = '/login.html'; throw new Error('unauthorized'); }
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'http ' + r.status); return j; });
    });
  }
  function rpc(op, path, extra) { return api('/api/db', Object.assign({ op: op, path: path }, extra)); }

  /* ---- تنبيهات التغيير ---- */
  var subs = new Set(), es = null;
  function bus() {
    if (es || typeof EventSource === 'undefined') return;
    es = new EventSource('/api/events');
    es.onmessage = function (e) {
      var p; try { p = JSON.parse(e.data).path; } catch (_) { return; }
      subs.forEach(function (s) { s.hit(p); });
    };
    es.onopen = function () { subs.forEach(function (s) { s.refresh(); }); };
  }
  function listen(path, isDoc, load, next, err) {
    var prev = null, timer = null, dead = false;
    var parent = path.split('/').slice(0, -1).join('/');
    function refresh() {
      Promise.resolve(load()).then(function (snap) {
        if (dead) return;
        var key = JSON.stringify(snap.key);
        if (prev && prev.key === key) return;
        var old = prev; prev = { key: key, docs: snap.map };
        next(snap.build(old ? old.docs : null));
      }, function (e) { if (!dead && err) err(e); });
    }
    var s = {
      refresh: refresh,
      hit: function (p) {
        if (isDoc ? p !== path : p.split('/').slice(0, -1).join('/') !== path) return;
        clearTimeout(timer); timer = setTimeout(refresh, 20);
      }
    };
    subs.add(s); bus(); refresh();
    void parent;
    return function () { dead = true; clearTimeout(timer); subs.delete(s); };
  }

  /* ---- لقطات ---- */
  var meta = { hasPendingWrites: false, fromCache: false };
  function docSnap(id, data) {
    var d = data == null ? undefined : data;
    return { id: id, exists: d !== undefined, metadata: meta, data: function () { return clone(d); } };
  }

  function DocRef(path) {
    var id = path.split('/').pop();
    return {
      id: id, path: path,
      get: function () { return rpc('get', path).then(function (r) { return docSnap(id, r.exists ? dec(r.data) : undefined); }); },
      set: function (d) { return rpc('set', path, { data: enc(d) }).then(function () {}); },
      update: function (d) { return rpc('update', path, { data: enc(d) }).then(function () {}); },
      delete: function () { return rpc('delete', path).then(function () {}); },
      acquire: function () { return Promise.resolve({ release: function () { return Promise.resolve(); } }); },
      onSnapshot: function (next, err) {
        return listen(path, true, function () {
          return rpc('get', path).then(function (r) {
            return { key: r.exists ? r.data : null, map: null, build: function () { return docSnap(id, r.exists ? dec(r.data) : undefined); } };
          });
        }, next, err);
      },
      collection: function (p) { return Query(path + '/' + p, {}); }
    };
  }

  function Query(path, spec) {
    var q = {
      path: path, id: path.split('/').pop(),
      where: function (f, op, v) { return Query(path, merge({ where: (spec.where || []).concat([[f, op, enc(v)]]) })); },
      orderBy: function (f, d) { return Query(path, merge({ orderBy: (spec.orderBy || []).concat([[f, d === 'desc' ? 'desc' : 'asc']]) })); },
      limit: function (n) { return Query(path, merge({ limit: n })); },
      get: function () { return run().then(function (r) { return build(r.docs, null); }); },
      onSnapshot: function (next, err) {
        return listen(path, false, function () {
          return run().then(function (r) {
            var map = {}; r.docs.forEach(function (d) { map[d.id] = JSON.stringify(d.data); });
            return { key: r.docs, map: map, build: function (old) { return build(r.docs, old); } };
          });
        }, next, err);
      },
      doc: function (id) {
        id = id === undefined ? Date.now().toString(36) + Math.random().toString(36).slice(2, 10) : String(id);
        return DocRef(path + '/' + id);
      },
      add: function (d) { return rpc('add', path, { data: enc(d) }).then(function (r) { return DocRef(r.path); }); }
    };
    function merge(x) { return Object.assign({}, spec, x); }
    function run() { return rpc('query', path, spec); }
    return q;
  }
  function build(rows, old) {
    var docs = rows.map(function (r) { return docSnap(r.id, dec(r.data)); });
    var index = {}; rows.forEach(function (r, i) { index[r.id] = i; });
    return {
      docs: docs, size: docs.length, empty: !docs.length, metadata: meta,
      forEach: function (f) { docs.forEach(f); },
      docChanges: function () {
        var out = [], oldIds = old ? Object.keys(old) : [];
        docs.forEach(function (d, i) {
          if (!old || !(d.id in old)) out.push({ type: 'added', doc: d, oldIndex: -1, newIndex: i });
          else if (old[d.id] !== JSON.stringify(rows[i].data)) out.push({ type: 'modified', doc: d, oldIndex: oldIds.indexOf(d.id), newIndex: i });
        });
        oldIds.forEach(function (id) { if (!(id in index)) out.push({ type: 'removed', doc: docSnap(id, undefined), oldIndex: oldIds.indexOf(id), newIndex: -1 }); });
        return out;
      }
    };
  }

  /* ---- المستخدم والتنزيلات ---- */
  var me = null;
  function who() {
    return me || (me = fetch('/api/auth/state', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (s) {
      if (!s.user) { location.href = '/login.html'; throw new Error('unauthorized'); }
      return s.user;
    }));
  }
  var user = {
    id: function () { return who().then(function (u) { return u.id; }); },
    name: function () { return who().then(function (u) { return u.name; }); },
    isOwner: function () { return who().then(function (u) { return u.role === 'owner'; }); },
    profiles: function (ids) { return api('/api/profiles', { ids: ids }).then(function (r) { return r.profiles; }); },
    can: function () { return Promise.resolve(true); },
    me: function () { return who().then(function (u) { return { id: u.id, name: u.name, avatarUrl: '' }; }); }
  };
  var downloads = {
    save: function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data]);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = o.filename || 'download';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve({ saved: true });
    }
  };
  var db = { doc: DocRef, collection: function (p) { return Query(p, {}); } };

  /* شريط المنصة: إدارة الحسابات (للمالك) وخروج الخادم */
  function bar() {
    if (document.getElementById('tp-srv')) return;
    var b = document.createElement('div');
    b.id = 'tp-srv';
    b.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;display:flex;gap:6px;font:12px "IBM Plex Sans Arabic",sans-serif;opacity:.55';
    b.onmouseenter = function () { b.style.opacity = 1; };
    b.onmouseleave = function () { b.style.opacity = .55; };
    var mk = function (t, f) {
      var a = document.createElement('button');
      a.type = 'button'; a.textContent = t; a.onclick = f;
      a.style.cssText = 'padding:4px 9px;border:1px solid #888;border-radius:6px;background:#fff;color:#222;cursor:pointer;font:inherit';
      return a;
    };
    b.appendChild(mk('خروج من المنصة', function () {
      api('/api/auth/logout').then(function () { location.href = '/login.html'; });
    }));
    who().then(function (u) {
      if (u.role === 'owner') b.insertBefore(mk('حسابات المنصة', function () { window.open('/admin.html', '_blank'); }), b.firstChild);
    }, function () {});
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();

  window.claude = {
    use: function (name) {
      if (name === 'db') return Promise.resolve(db);
      if (name === 'user') return Promise.resolve(user);
      if (name === 'downloads') return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };
})();
