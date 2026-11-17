/*!
 * apn-core.js — núcleo compartido de los HTML de REGISTRO de APN
 * ------------------------------------------------------------------------------------
 * Lo usan control_personal.html, control_vehicular.html, control_visitas.html y cualquier
 * HTML de registro futuro. Se encarga de:
 *   · Sesión del agente (usuario/contraseña creados en el dashboard). Una sola vez para todos
 *     los HTML (si están en el mismo sitio).
 *   · Turno (Día / Noche) al entrar; se avisa al backend con "iniciarServicio".
 *   · Cola sin conexión: todo se guarda en el celular y se sube solo cuando vuelve el Internet,
 *     en orden y sin duplicar (reenviar el mismo registro no lo repite).
 *   · Datos que crea el dashboard: personal, vehículos y los registros ya guardados.
 *
 * Uso en un HTML:
 *   <script src="apn-core.js"></script>
 *   APN.init({ api: API_URL, modulo: 'personal', toast: showToast, onDatos: function () { ... } });
 *   APN.enviar('personal', { nombre, tipo, fecha, hora, motivo });   // guarda + sube
 *   APN.registros('personal'); APN.personas(['trabajador','limpieza']); APN.vehiculos();
 */
(function (g) {
  'use strict';

  var LS = { tok: 'apn_token', user: 'apn_user', serv: 'apn_servicio', cache: 'apn_cache', cola: 'apn_cola', fall: 'apn_cola_fallidos' };
  var C = { api: '', modulo: '', turno: true, autoLogin: true, toast: null, onDatos: null, onListo: null, poll: 15000, tz: 'America/Lima' };
  var cache = { modifiedAt: '', personas: [], vehiculos: [], config: {}, modulos: {} };
  var oyentes = {}, subiendo = false, refrescando = false, iniciado = false, timer = null;
  try { var guardado = JSON.parse(localStorage.getItem('apn_cache') || 'null'); if (guardado) cache = Object.assign(cache, guardado); } catch (e) { /* sin copia */ }   // copia local: personal y vehículos disponibles aun sin Internet

  // ---------------------------------------------------------------- utilidades
  function leer(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } }
  function borrar(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function emitir(ev, d) { (oyentes[ev] || []).forEach(function (f) { try { f(d); } catch (e) { console.error(e); } }); }
  function on(ev, f) { (oyentes[ev] = oyentes[ev] || []).push(f); }
  function aviso(t, m, tipo) { if (typeof C.toast === 'function') C.toast(t, m, tipo || 'success'); else console.log(t + ': ' + m); }
  function idUnico() { return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // Hora de Lima (la fecha del turno noche NO cambia a medianoche: lo resuelve el turno)
  function ahora() {
    var p = new Intl.DateTimeFormat('sv-SE', { timeZone: C.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
    return { fecha: p.slice(0, 10), hora: p.slice(11, 16), min: Number(p.slice(11, 13)) * 60 + Number(p.slice(14, 16)) };
  }
  function sumarDias(f, n) { var d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function apiLista() { return !!C.api && C.api !== 'AQUI_VA_MI_LINK'; }

  // ---------------------------------------------------------------- red
  function llamar(action, data) {
    return fetch(C.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: leer(LS.tok, ''), data: data || {} }) })
      .then(function (r) { return r.json(); });
  }
  function leerRed(action, params) {
    var q = '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(leer(LS.tok, ''));
    Object.keys(params || {}).forEach(function (k) { if (params[k]) q += '&' + k + '=' + encodeURIComponent(params[k]); });
    return fetch(C.api + q).then(function (r) { return r.json(); });
  }

  // ---------------------------------------------------------------- sesión
  function usuario() { return leer(LS.user, null); }
  function haySesion() { return !!leer(LS.tok, '') && !!usuario(); }
  function salir() {
    borrar(LS.tok); borrar(LS.user); borrar(LS.serv);
    emitir('sesion', null); pintarSesion(); mostrarLogin();
  }

  // ---------------------------------------------------------------- turno
  function servicio() {
    var s = leer(LS.serv, null), u = usuario();
    if (!s || !u || s.usuarioId !== u.id) return null;
    if (Date.now() - s.iniciadoEn > 16 * 3600 * 1000) return null;    // un turno dura 12 h; 16 h de margen
    return s;
  }
  function elegirTurno(turno) {
    var n = ahora(), fecha = n.fecha;
    if (turno === 'noche' && n.min < 7 * 60) fecha = sumarDias(fecha, -1);   // pasada la medianoche sigue siendo la fecha del turno
    var s = { turno: turno, fecha: fecha, hora: n.hora, usuarioId: usuario().id, iniciadoEn: Date.now() };
    guardar(LS.serv, s);
    encolar('iniciarServicio', { turno: turno, fecha: fecha, hora: n.hora });
    cerrarOverlay(); pintarSesion(); emitir('sesion', usuario());
    aviso('Turno ' + (turno === 'dia' ? 'Día' : 'Noche'), 'Servicio iniciado el ' + fecha + ' a las ' + n.hora + '.', 'success');
    listo();
  }

  // ---------------------------------------------------------------- interfaz propia (no toca el diseño del HTML)
  var CSS = '#apn-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(10,14,30,.62);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",system-ui,sans-serif}' +
    '#apn-ov .c{width:100%;max-width:380px;background:rgba(255,255,255,.88);border:1px solid rgba(255,255,255,.8);border-radius:28px;padding:26px 22px;box-shadow:0 24px 70px rgba(0,0,0,.4);color:#0b1220;-webkit-backdrop-filter:blur(26px) saturate(180%);backdrop-filter:blur(26px) saturate(180%)}' +
    '#apn-ov h2{margin:0 0 4px;font-size:1.3rem;letter-spacing:-.02em}#apn-ov p{margin:0 0 16px;color:#475569;font-size:.9rem}' +
    '#apn-ov label{display:block;font-size:.78rem;font-weight:600;color:#334155;margin:12px 0 4px}' +
    '#apn-ov input{width:100%;padding:13px 14px;border-radius:14px;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.9);font-size:1rem;outline:none}' +
    '#apn-ov input:focus{border-color:#0a84ff;box-shadow:0 0 0 3px rgba(10,132,255,.25)}' +
    '#apn-ov button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:999px;font-size:1rem;font-weight:700;color:#fff;background:linear-gradient(180deg,#38a0ff,#0a84ff);cursor:pointer}' +
    '#apn-ov button.sec{background:rgba(15,23,42,.08);color:#0b1220;margin-top:10px}#apn-ov button.rojo{background:linear-gradient(180deg,#ff6b6b,#ef4444)}' +
    '#apn-ov .t2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}#apn-ov .t2 button{margin:0;padding:22px 8px;border-radius:22px;font-size:1.05rem}' +
    '#apn-ov .t2 button.dia{background:linear-gradient(180deg,#fbbf24,#f59e0b)}#apn-ov .t2 button.noche{background:linear-gradient(180deg,#6366f1,#4338ca)}' +
    '#apn-ov .err{color:#b91c1c;font-size:.85rem;min-height:1.2em;margin-top:8px}';
  function inyectarCSS() {
    if (document.getElementById('apn-core-css')) return;
    var s = document.createElement('style'); s.id = 'apn-core-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function abrirOverlay(html, bloquea) {
    inyectarCSS(); cerrarOverlay();
    var d = document.createElement('div'); d.id = 'apn-ov'; d.innerHTML = '<div class="c">' + html + '</div>';
    if (!bloquea) d.addEventListener('click', function (e) { if (e.target === d) cerrarOverlay(); });
    document.body.appendChild(d); return d;
  }
  function cerrarOverlay() { var o = document.getElementById('apn-ov'); if (o) o.remove(); }

  function mostrarLogin(msg) {
    var o = abrirOverlay('<h2>Iniciar sesión</h2><p>Ingresa con tu usuario de agente.</p>' +
      '<label for="apnU">Usuario</label><input id="apnU" autocomplete="username" autocapitalize="none">' +
      '<label for="apnP">Contraseña</label><input id="apnP" type="password" autocomplete="current-password">' +
      '<div class="err" id="apnE">' + esc(msg || '') + '</div><button id="apnB">Ingresar</button>', true);
    var enviar = function () {
      var u = o.querySelector('#apnU').value.trim(), p = o.querySelector('#apnP').value, e = o.querySelector('#apnE'), b = o.querySelector('#apnB');
      if (!u || !p) { e.textContent = 'Escribe usuario y contraseña.'; return; }
      if (!apiLista()) { e.textContent = 'Falta configurar el link del Apps Script (API_URL).'; return; }
      if (!navigator.onLine) { e.textContent = 'Necesitas Internet para iniciar sesión.'; return; }
      b.disabled = true; b.textContent = 'Verificando…';
      llamar('login', { usuario: u, clave: p }).then(function (r) {
        if (r.status !== 'success') { e.textContent = r.message || 'No se pudo iniciar sesión.'; b.disabled = false; b.textContent = 'Ingresar'; return; }
        if (r.user.rol !== 'agente' && r.user.rol !== 'admin') { e.textContent = 'Este usuario no es agente de seguridad.'; b.disabled = false; b.textContent = 'Ingresar'; return; }
        guardar(LS.tok, r.token); guardar(LS.user, r.user); cerrarOverlay(); emitir('sesion', r.user); pintarSesion();
        arrancarConSesion();
      }).catch(function () { e.textContent = 'No hay conexión con el servidor.'; b.disabled = false; b.textContent = 'Ingresar'; });
    };
    o.querySelector('#apnB').onclick = enviar;
    o.querySelector('#apnP').onkeydown = function (ev) { if (ev.key === 'Enter') enviar(); };
    setTimeout(function () { var i = o.querySelector('#apnU'); if (i) i.focus(); }, 50);
  }

  function pedirTurno() {
    var n = ahora(), sug = (n.min >= 7 * 60 && n.min < 19 * 60) ? 'dia' : 'noche', u = usuario();
    var o = abrirOverlay('<h2>Hola, ' + esc(u.nombre.split(' ')[0]) + '</h2><p>¿En qué turno estás? Sugerido según la hora: <b>' + (sug === 'dia' ? 'Día' : 'Noche') + '</b>.</p>' +
      '<div class="t2"><button class="dia" data-t="dia">☀️ Día<br><small>07:00 – 19:00</small></button><button class="noche" data-t="noche">🌙 Noche<br><small>19:00 – 07:00</small></button></div>' +
      '<button class="sec" id="apnSalir">Cerrar sesión</button>', true);
    o.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { elegirTurno(b.dataset.t); }; });
    o.querySelector('#apnSalir').onclick = salir;
  }

  function menu() {
    var u = usuario(), s = servicio(); if (!u) return;
    var o = abrirOverlay('<h2>' + esc(u.nombre) + '</h2><p>' + (s ? 'Turno ' + (s.turno === 'dia' ? 'Día' : 'Noche') + ' · ' + esc(s.fecha) : 'Sin turno iniciado') + '<br>Pendientes por subir: <b>' + colaLista().length + '</b></p>' +
      '<button id="apnCT">Cambiar turno</button><button class="sec" id="apnSync">Sincronizar ahora</button><button class="rojo" id="apnLo">Cerrar sesión</button><button class="sec" id="apnX">Cerrar</button>', false);
    o.querySelector('#apnCT').onclick = function () { pedirTurno(); };
    o.querySelector('#apnSync').onclick = function () { cerrarOverlay(); refrescar(true); };
    o.querySelector('#apnLo').onclick = function () {
      if (colaLista().length && !confirm('Hay ' + colaLista().length + ' registro(s) sin subir. Si cierras sesión se subirán cuando inicies sesión de nuevo con Internet. ¿Cerrar sesión?')) return;
      cerrarOverlay(); salir();
    };
    o.querySelector('#apnX').onclick = cerrarOverlay;
  }

  // Pinta las insignias que ya existen en el diseño de cada HTML
  function pintarSesion() {
    var dot = document.getElementById('sesionDot'), txt = document.getElementById('sesionText'), btn = document.getElementById('btnSesionAccion');
    var u = usuario(), s = servicio();
    if (dot) dot.classList.toggle('connected', !!u);
    if (txt) txt.textContent = u ? (u.nombre.split(' ')[0] + (s ? ' · Turno ' + (s.turno === 'dia' ? 'Día' : 'Noche') : ' · sin turno')) : 'Sin sesión';
    if (btn) { btn.textContent = u ? 'Opciones' : 'Iniciar sesión'; btn.onclick = u ? menu : function () { mostrarLogin(); }; }
    pintarEstado();
  }
  function pintarEstado() {
    var dot = document.getElementById('syncStatusDot'), txt = document.getElementById('syncStatusText');
    if (!dot || !txt) return;
    var n = colaLista().length;
    if (!apiLista()) { dot.classList.remove('connected'); txt.textContent = 'Falta configurar API_URL'; return; }
    if (!navigator.onLine) { dot.classList.remove('connected'); txt.textContent = n ? 'Sin conexión · ' + n + ' pendiente(s)' : 'Sin conexión (modo local)'; return; }
    if (n) { dot.classList.remove('connected'); txt.textContent = n + ' pendiente(s) por subir'; return; }
    dot.classList.add('connected'); txt.textContent = 'Sheets Sincronizado';
  }

  // ---------------------------------------------------------------- cola sin conexión
  function colaLista() { return leer(LS.cola, []); }
  function encolar(action, data) {
    var c = colaLista(); c.push({ action: action, data: data, ts: Date.now() }); guardar(LS.cola, c);
    pintarEstado(); emitir('cola', c.length);
    subirCola();
  }
  function subirCola() {
    if (subiendo || !apiLista() || !navigator.onLine || !haySesion()) return Promise.resolve(false);
    subiendo = true; var enviados = 0;
    function paso() {
      var c = colaLista(); if (!c.length) return Promise.resolve();
      var it = c[0];
      return llamar(it.action, it.data).then(function (r) {
        if (r.status === 'auth') { subiendo = false; mostrarLogin('Tu sesión venció. Vuelve a ingresar; lo pendiente se subirá solo.'); throw 'auth'; }
        if (r.status !== 'success') {                       // error permanente: se aparta para no bloquear el resto
          var f = leer(LS.fall, []); f.push({ item: it, error: r.message || r.status, ts: Date.now() }); guardar(LS.fall, f);
          aviso('No se pudo guardar un registro', (r.message || 'Error del servidor') + '. Quedó apartado.', 'danger');
        } else enviados++;
        c.shift(); guardar(LS.cola, c); pintarEstado(); emitir('cola', c.length);
        return paso();
      });
    }
    return paso().then(function () { subiendo = false; if (enviados) { aviso('Nube sincronizada', enviados + ' registro(s) subido(s) a Google Sheets.', 'success'); if (!refrescando) refrescar(true); } pintarEstado(); return true; },
      function (e) { subiendo = false; pintarEstado(); return false; });   // sin Internet o sesión vencida: se reintenta luego
  }

  // ---------------------------------------------------------------- datos del dashboard
  function refrescar(forzar) {
    if (!apiLista() || !navigator.onLine || !haySesion() || refrescando) return Promise.resolve();
    refrescando = true;
    return subirCola().then(function () {
      if (colaLista().length) return null;                    // nunca se pisan datos locales sin subir
      return leerRed('getData', forzar ? {} : { since: cache.modifiedAt });
    }).then(function (r) {
      refrescando = false;
      if (!r) return;
      if (r.status === 'auth') { mostrarLogin('Tu sesión venció. Vuelve a ingresar.'); return; }
      if (r.status !== 'success') return;
      if (r.unchanged) { pintarEstado(); return; }
      cache = { modifiedAt: r.modifiedAt, personas: r.personas || [], vehiculos: r.vehiculos || [], config: r.config || {}, modulos: r.modulos || {} };
      guardar(LS.cache, cache); pintarEstado(); emitir('datos', cache); if (typeof C.onDatos === 'function') C.onDatos(cache);
    }).catch(function () { refrescando = false; pintarEstado(); });
  }

  function personas(roles) {
    return (cache.personas || []).filter(function (p) { return String(p.activo).toLowerCase() !== 'false' && (!roles || roles.indexOf(p.rol) !== -1); });
  }
  function vehiculos() { return (cache.vehiculos || []).filter(function (v) { return String(v.activo).toLowerCase() !== 'false'; }); }
  // Registros del servidor + los que están en cola (se ven al instante, aun sin Internet)
  function registrosBase(modulo) {
    var base = ((cache.modulos || {})[modulo] || []).slice(), pos = {}, yo = usuario();
    base.forEach(function (r, i) { pos[String(r.id)] = i; });
    colaLista().forEach(function (it) {
      if (!it.data || it.data.modulo !== modulo) return;
      if (it.action === 'addRegistro') {
        var r = Object.assign({}, it.data.registro), i = pos[String(r.id)];
        if (i === undefined) { r._local = true; if (yo) r.registradoPorId = yo.id; pos[String(r.id)] = base.length; base.push(r); }
        else base[i] = Object.assign({}, base[i], r);
      } else if (it.action === 'updateMiRegistro') {
        var c = it.data.registro || {}, j = pos[String(c.id)];
        if (j !== undefined && base[j]) base[j] = Object.assign({}, base[j], c);
      } else if (it.action === 'deleteMiRegistro') {
        var k = pos[String(it.data.id)];
        if (k !== undefined) base[k] = null;
      }
    });
    return base.filter(Boolean);
  }

  // El conductor y los pasajeros que salen en un vehículo cuentan también como SALIDA de personal
  // (e INGRESO cuando el vehículo retorna), con el motivo del control vehicular. Son registros virtuales.
  function derivarPersonal(viajes) {
    var lista = function (v) {
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = v ? [v] : []; } }
      return (Array.isArray(v) ? v : []).map(function (x) { return String(x).trim(); }).filter(Boolean);
    };
    var uniq = function (a) { return a.filter(function (n, i) { return n && a.indexOf(n) === i; }); };
    var out = [];
    (viajes || []).forEach(function (r) {
      if (!r || String(r.eliminado).toLowerCase() === 'true') return;
      var cond = String(r.conductor || '').trim();
      var ida = uniq([cond].concat(lista(r.pasajeros)));
      var ret = uniq([cond].concat(r.pasajerosRetorno === undefined || r.pasajerosRetorno === '' ? lista(r.pasajeros) : lista(r.pasajerosRetorno)));
      var motivo = String(r.motivo || r.destino || 'En vehículo').trim();
      if (r.fechaSalida && r.horaSalida) ida.forEach(function (n, i) { out.push({ id: 'dv_' + r.id + '_s_' + i, nombre: n, tipo: 'Salida', fecha: r.fechaSalida, hora: String(r.horaSalida).slice(0, 5), motivo: motivo, derivado: 'vehicular', viajeId: r.id, registradoPor: 'Control vehicular' }); });
      if (r.fechaIngreso && r.horaIngreso) ret.forEach(function (n, i) { out.push({ id: 'dv_' + r.id + '_i_' + i, nombre: n, tipo: 'Ingreso', fecha: r.fechaIngreso, hora: String(r.horaIngreso).slice(0, 5), motivo: '', derivado: 'vehicular', viajeId: r.id, registradoPor: 'Control vehicular' }); });
    });
    return out;
  }
  function registros(modulo) {
    var base = registrosBase(modulo);
    if (modulo === 'personal') base = base.filter(function (r) { return !r.derivado; }).concat(derivarPersonal(registrosBase('vehicular')));
    return base;
  }
  // El agente solo puede corregir lo que él mismo registró (y nunca lo derivado de un viaje)
  function puedeEditar(r) {
    var u = usuario();
    return !!(u && r && !r.derivado && (r._local || String(r.registradoPorId) === String(u.id)));
  }
  function editar(modulo, cambios) { encolar('updateMiRegistro', { modulo: modulo, registro: cambios }); }
  function eliminar(modulo, id) { encolar('deleteMiRegistro', { modulo: modulo, id: id }); }
  // Guarda un registro: id propio (reenviar no duplica), local al instante y a la cola
  function enviar(modulo, registro) {
    var r = Object.assign({}, registro); if (!r.id) r.id = idUnico();
    encolar('addRegistro', { modulo: modulo, registro: r });
    return r;
  }

  // ---------------------------------------------------------------- arranque
  function listo() {
    if (typeof C.onListo === 'function') C.onListo();
    refrescar(true);
    clearInterval(timer); timer = setInterval(function () { if (!document.hidden) refrescar(); }, C.poll);
  }
  function arrancarConSesion() {
    pintarSesion();
    if (C.turno && !servicio()) { pedirTurno(); return; }
    listo();
  }
  function init(opts) {
    Object.assign(C, opts || {});
    if (iniciado) return; iniciado = true;
    if (cache.modifiedAt && typeof C.onDatos === 'function') C.onDatos(cache);
    window.addEventListener('online', function () { pintarEstado(); refrescar(); });
    window.addEventListener('offline', pintarEstado);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
    var arrancar = function () {
      pintarSesion();
      if (!haySesion()) { if (C.autoLogin) mostrarLogin(); return; }
      arrancarConSesion();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
  }

  g.APN = {
    init: init, on: on, enviar: enviar, editar: editar, eliminar: eliminar, puedeEditar: puedeEditar, login: function (m) { mostrarLogin(m); }, registros: registros, personas: personas, vehiculos: vehiculos,
    config: function () { return cache.config || {}; }, usuario: usuario, servicio: servicio,
    hoy: function () { return ahora().fecha; }, ahora: ahora, refrescar: refrescar, salir: salir, menu: menu,
    pendientes: function () { return colaLista().length; }, fallidos: function () { return leer(LS.fall, []); }
  };
})(window);
