/*!
 * apn-reportes.js — hojas A4 de APN (control de personal, control vehicular, cuaderno de ocurrencias)
 * ---------------------------------------------------------------------------------------------
 * Se carga con <script src=".../apn-reportes.js"> y expone window.APNReportes:
 *
 *   renderPersonal(contenedor, {registros, personas, config, fechaInicio, trabajador?, dias?}) -> {hojas}
 *   renderVehicular(contenedor, {records, vehiculos, config, fechaInicio})              -> {hojas}
 *   renderVisitas(contenedor, {registros, config, fechaInicio, dias?})                  -> {hojas}   // solo días con visitas (o los de "dias")
 *   renderCuaderno(contenedor, cuaderno, {libro?:true})                                  -> {hojas}
 *   descargarPNG(contenedor, nombre)   // una imagen por hoja
 *   descargarPDF(contenedor, nombre)   // una página por hoja (A4 fijo)
 *   activarLibro(contenedor) / quitarLibro(contenedor)   // vista previa tipo libro
 *   listo  (Promise)  // fuentes y librerías cargadas
 *
 * Las hojas son <div class="apn-hoja"> de tamaño FIJO en píxeles (96 dpi):
 *   vertical 794 x 1123  |  horizontal 1123 x 794   (= A4). El contenido NUNCA agranda la hoja:
 *   si no cabe, continúa en otra hoja.
 *
 * Configuración opcional (config del backend): logoUrl (logo del cuaderno), logoPieUrl (logo de pie
 * de las hojas de personal y vehicular; si no hay, se usa logoUrl).
 */
(function (global) {
  'use strict';

  // ===========================================================================
  //  Constantes de diseño
  // ===========================================================================
  var ROJO = '#ff3b3b', ROSA = '#ff9a9a', ROSA_SUAVE = '#ffb3b3', TXT = '#111';
  var AZUL = '#1b0fa6', DATO = '#ff4545', HORA = '#e8222a';
  var V = { w: 794, h: 1123 }, H = { w: 1123, h: 794 };
  var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var CDN = {
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  };
  var FUENTES = 'https://fonts.googleapis.com/css2?family=Bitter:wght@500;700&family=Bree+Serif&family=DM+Serif+Display&display=swap';

  var CSS = [
    '.apn-hoja{position:relative;background:#fff;color:' + TXT + ';overflow:hidden;box-sizing:border-box;margin:0 auto 18px;font-family:"Bree Serif",Georgia,serif;-webkit-font-smoothing:antialiased}',
    '.apn-hoja *{box-sizing:border-box}',
    '.apn-hoja.apn-v{width:794px;height:1123px}.apn-hoja.apn-h{width:1123px;height:794px}',
    '.apn-hoja img{display:block}',
    '.apn-tit{font-family:"DM Serif Display",Georgia,serif;text-align:center;color:#000;white-space:nowrap}',
    '.apn-tit span.s{display:inline-block;margin:0 .45em;font-size:.7em;vertical-align:.12em}',
    '.apn-tit span.c{font-family:"Bree Serif",Georgia,serif;font-size:.42em;margin-left:.8em;color:#777;vertical-align:.5em}',
    /* tablas con rejilla */
    '.apn-t{border-collapse:collapse;table-layout:fixed;width:100%;border:3px solid ' + ROJO + '}',
    '.apn-t th{background:' + ROSA + ';border:2px solid ' + ROJO + ';font-family:"Bitter",Georgia,serif;font-weight:700;font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;padding:0 3px;height:30px;color:#111;text-align:center}',
    '.apn-t td{border:2px solid ' + ROSA + ';padding:2px 5px;text-align:center;vertical-align:middle;font-size:12px;line-height:1.3;word-break:break-word}',
    '.apn-t td.n{font-size:12px}',
    /* tablas de personal y visitas: filas en cuadrícula con alto por contenido (se exportan bien a imagen y PDF) */
    '.apn-g{border:3px solid ' + ROJO + ';background:#fff}',
    '.apn-g .r{display:grid}',
    '.apn-g .r>div{min-width:0;padding:6px 5px;line-height:1.35;font-size:12px;text-align:center;border-right:2px solid ' + ROSA + ';border-bottom:2px solid ' + ROSA + ';word-break:break-word}',
    '.apn-g .r>div:last-child{border-right:0}',
    '.apn-g .r:last-child>div{border-bottom:0}',
    '.apn-g .r>div.l{text-align:left}',
    '.apn-g .r>div small.cg{display:block;font-size:10px;color:#555;line-height:1.2;margin-top:2px}',
    '.apn-g .r>div.m{font-size:11px}',
    '.apn-g .r.h>div{background:' + ROSA + ';border-color:' + ROJO + ';border-bottom:2px solid ' + ROJO + ';font-family:"Bitter",Georgia,serif;font-weight:700;font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;padding:7px 3px;color:#111}',
    '.apn-g .r.h:last-child>div{border-bottom:2px solid ' + ROJO + '}',
    /* personal */
    '.apn-p .apn-t td{height:30px}',
    '.apn-p .apn-t td.nom{text-align:left;font-weight:400}',
    '.apn-p .apn-t td.mot{font-size:11px}',
    '.apn-vs .apn-t td{height:30px}',
    '.apn-vs .apn-t td.tx{text-align:left;font-size:11.5px}',
    /* vehicular */
    '.apn-vh .apn-t{margin:0}',
    '.apn-vh .apn-t th{height:34px}',
    '.apn-vh .apn-t td{border:2px solid ' + ROJO + ';height:67px;font-size:14.5px;line-height:1.45}',
    '.apn-vh .apn-t td small{display:block;color:#666;font-size:10px;line-height:1.1;margin-top:2px}',
    '.apn-vh .nms .nm{display:block;line-height:1.3}',
    '.apn-vh .nms.mu .nm{font-size:12.5px;line-height:1.25}',
    '.apn-pie{position:absolute;left:0;right:0;display:flex;justify-content:center;align-items:center}',
    '.apn-pie img{height:70px;width:auto;max-width:90%}',
    /* cuaderno */
    '.apn-cq .tit{position:absolute;left:52px;top:44px;font-family:"DM Serif Display",Georgia,serif;font-size:30px;letter-spacing:.02em;color:' + HORA + ';white-space:nowrap}',
    '.apn-cq .fecha{position:absolute;right:38px;top:28px;width:150px;text-align:center;color:' + HORA + ';line-height:1.3}',
    '.apn-cq .fecha b{display:block;font-family:"Bree Serif",Georgia,serif;font-weight:400;font-size:20px}',
    '.apn-cq .fecha span{display:block;font-family:"Bitter",Georgia,serif;font-weight:500;font-size:18px}',
    '.apn-cq .datos{position:absolute;left:52px;top:120px;font-family:"DM Serif Display",Georgia,serif;font-size:19px;line-height:25.5px;color:' + HORA + '}',
    '.apn-cq .datos i{font-style:normal;color:#111;font-family:"Bree Serif",Georgia,serif;font-size:16px;margin-left:6px}',
    '.apn-cq .logo{position:absolute;left:52px;top:8px;height:34px}',
    '.apn-cq .tabla{position:absolute;left:38px;width:718px;border:3px solid ' + ROJO + ';overflow:hidden;background:#fff}',
    '.apn-cq .tabla:before,.apn-cq .tabla:after{content:"";position:absolute;top:0;bottom:0;width:3px;background:' + ROJO + ';z-index:2}',
    '.apn-cq .tabla:before{left:52px}.apn-cq .tabla:after{left:101px}',
    '.apn-cq .cab{display:grid;grid-template-columns:52px 49px 1fr;height:34px;background:' + ROSA + ';border-bottom:3px solid ' + ROJO + ';position:relative;z-index:1}',
    '.apn-cq .cab div{display:flex;align-items:center;justify-content:center;font-family:"Bitter",Georgia,serif;font-weight:700;font-size:10px;letter-spacing:.12em;color:#111}',
    '.apn-cq .cab div:last-child{letter-spacing:.9em;padding-left:.9em}',
    '.apn-cq .cuerpo{position:absolute;left:0;right:0;top:34px;bottom:0;overflow:hidden}',
    '.apn-cq .filas{width:100%}',
    '.apn-cq .fila{display:grid;grid-template-columns:52px 49px 1fr;min-height:38px;align-items:center}',
    '.apn-cq .fila .h{text-align:center;color:' + HORA + ';font-size:12.5px}',
    '.apn-cq .fila .o{padding:8px 14px 8px 24px;font-size:13.5px;line-height:1.35;position:relative;word-break:break-word}',
    '.apn-cq .fila.sistema .o{color:' + AZUL + '}.apn-cq .fila.dato .o{color:' + DATO + '}',
    '.apn-cq .fila .firma{position:absolute;right:22px;top:50%;transform:translateY(-50%);height:34px;max-width:150px;object-fit:contain}',
    '.apn-cq .firmas{position:absolute;left:0;right:0;bottom:0;height:170px}',
    '.apn-cq .firmas .bloque{position:absolute;bottom:34px;width:230px;margin-left:-115px;text-align:center;font-family:"Bitter",Georgia,serif;font-weight:700;font-size:17px;color:' + HORA + '}',
    '.apn-cq .firmas .bloque img{height:62px;max-width:200px;object-fit:contain;margin:0 auto 6px}',
    '.apn-cq .firmas .bloque .linea{height:62px;margin-bottom:6px}',
    '.apn-cq .firmas .bloque small{display:block;font-family:"Bree Serif",Georgia,serif;font-weight:400;font-size:11.5px;color:#444;margin-top:2px;min-height:14px}',
    /* libro */
    '.apn-libro{position:relative;perspective:3200px;margin:0 auto;user-select:none;transition:transform .9s cubic-bezier(.645,.045,.355,1)}',
    '.apn-libro.cerrado{transform:translateX(-50%)}',
    '.apn-libro.cerrado .hoja-izq-vacia,.apn-libro.cerrado .lomo{opacity:0}',
    '.apn-libro .hoja-izq-vacia,.apn-libro .lomo{transition:opacity .6s}',
    '.apn-libro.rapido .apn-hoja-libro{transition-duration:.42s}',
    '.apn-portada{position:absolute;inset:0;border-radius:4px 12px 12px 4px;background:linear-gradient(135deg,#27304a,#12151f);box-shadow:inset 0 0 0 6px rgba(255,255,255,.06),0 18px 40px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#f3e7c9;text-align:center;padding:40px}',
    '.apn-portada.img{background-size:cover;background-position:center;background-repeat:no-repeat}',
    '.apn-portada .t{font-family:"DM Serif Display",Georgia,serif;font-size:44px;line-height:1.15;text-shadow:0 2px 10px rgba(0,0,0,.4)}',
    '.apn-portada .h{font:600 14px -apple-system,Segoe UI,sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.8;border:1px solid rgba(243,231,201,.5);border-radius:999px;padding:8px 18px}',
    '.apn-portada.img .h{background:rgba(0,0,0,.45);color:#fff;border-color:rgba(255,255,255,.4)}',
    '.apn-interior{position:absolute;inset:0;background:linear-gradient(90deg,#c9ced9,#e7eaf1);box-shadow:inset -12px 0 22px rgba(0,0,0,.1)}',
    '.apn-libro .lomo{position:absolute;left:50%;top:0;bottom:0;width:30px;margin-left:-15px;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.18) 50%,rgba(0,0,0,0));z-index:900;pointer-events:none}',
    '.apn-libro .hoja-izq-vacia{position:absolute;left:0;top:0;bottom:0;width:50%;background:linear-gradient(90deg,#d9dde6,#eceff5);box-shadow:inset -10px 0 18px rgba(0,0,0,.08);border-radius:6px 0 0 6px}',
    '.apn-hoja-libro{position:absolute;top:0;left:50%;transform-origin:left center;transform-style:preserve-3d;transition:transform .95s cubic-bezier(.645,.045,.355,1);cursor:pointer}',
    '.apn-hoja-libro.volteada{transform:rotateY(-180deg)}',
    '.apn-hoja-libro .cara{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;background:#fff}',
    '.apn-hoja-libro .cara .apn-hoja{margin:0}',
    '.apn-hoja-libro .cara.dorso{transform:rotateY(180deg)}',
    '.apn-hoja-libro .cara:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .95s;background:linear-gradient(90deg,rgba(0,0,0,.28),rgba(0,0,0,0) 45%)}',
    '.apn-hoja-libro.volteada .cara.dorso:after{opacity:0}.apn-hoja-libro:not(.volteada) .cara.dorso:after{opacity:1}',
    '.apn-libro-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin:14px auto 0;font:600 15px -apple-system,Segoe UI,sans-serif;color:#333}',
    '.apn-libro-nav button{border:0;border-radius:999px;background:#15171d;color:#fff;font:600 15px -apple-system,Segoe UI,sans-serif;padding:9px 20px;cursor:pointer}',
    '.apn-libro-nav button:disabled{opacity:.35;cursor:default}'
  ].join('\n');

  // ===========================================================================
  //  Utilidades
  // ===========================================================================
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function normFecha(v) {
    v = v == null ? '' : v;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return String(v).slice(0, 10);
    var m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    var d = new Date(v);
    return isNaN(d) ? '' : ymd(d);
  }
  function normHora(v) { var m = String(v == null ? '' : v).match(/(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] : ''; }
  function ts(f, h) { return f + 'T' + (h || '00:00'); }
  function tituloDia(f) {
    var p = f.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return { dia: DIAS[d.getDay()], d: p[2], m: p[1], y: p[0] };
  }
  function htmlTitulo(f, cont) {
    var t = tituloDia(f);
    return t.dia + '<span class="s"></span>' + t.d + '<span class="s">-</span>' + t.m + '<span class="s">-</span>' + t.y + (cont ? '<span class="c">(continuación)</span>' : '');
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function img(src, cls) { var i = document.createElement('img'); i.crossOrigin = 'anonymous'; i.src = src; if (cls) i.className = cls; return i; }
  function logoPie(cfg) { return (cfg && (cfg.logoPieUrl || cfg.logoUrl)) || ''; }

  // ===========================================================================
  //  Carga de estilos, fuentes y librerías de exportación
  // ===========================================================================
  var cargadas = {};
  function cargarScript(url) {
    if (cargadas[url]) return cargadas[url];
    return (cargadas[url] = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = ok; s.onerror = function () { delete cargadas[url]; mal(new Error('No se pudo cargar ' + url)); };
      document.head.appendChild(s);
    }));
  }
  function iniciar() {
    if (!document.getElementById('apn-reportes-css')) {
      var st = document.createElement('style'); st.id = 'apn-reportes-css'; st.textContent = CSS; document.head.appendChild(st);
      var lk = document.createElement('link'); lk.rel = 'stylesheet'; lk.href = FUENTES; document.head.appendChild(lk);
    }
  }
  iniciar();
  var fuentesListas = false;
  var listo = (function () {
    var fs = document.fonts;
    if (!fs || !fs.load) { fuentesListas = true; return Promise.resolve(); }
    return Promise.all(['16px "DM Serif Display"', '16px "Bree Serif"', '700 16px "Bitter"'].map(function (f) { return fs.load(f).catch(function () {}); }))
      .then(function () { return fs.ready; }).then(function () { fuentesListas = true; });
  })();
  var rerender = [];   // re-dibuja una vez cuando llegan las fuentes (las medidas cambian)
  listo.then(function () { rerender.forEach(function (fn) { try { fn(); } catch (e) {} }); rerender = []; });
  function registrarRerender(cont, fn) {
    if (fuentesListas) return;
    rerender = rerender.filter(function (r) { return r.cont !== cont; });
    var f = function () { var r = fn(); try { cont.dispatchEvent(new CustomEvent('apnrender', { detail: r })); } catch (e) {} };
    f.cont = cont; rerender.push(f);
  }

  // ===========================================================================
  //  Paginado: la hoja nunca crece; lo que no cabe pasa a la hoja siguiente
  // ===========================================================================
  function nuevaHoja(cont, orient, extraCls) {
    var h = el('div', 'apn-hoja ' + (orient === 'h' ? 'apn-h' : 'apn-v') + (extraCls ? ' ' + extraCls : ''));
    cont.appendChild(h);
    return h;
  }
  // true si el contenido de "caja" (alto fijo, overflow oculto) cabe sin recortarse
  function cabe(caja) { return caja.scrollHeight <= caja.clientHeight + 0.5; }

  // ===========================================================================
  //  1) CONTROL DE PERSONAL — A4 HORIZONTAL
  // ===========================================================================
  // Días elegidos a mano (si alguno cae en esa semana); si no, los automáticos
  function elegirDias(auto, sel, inicio) {
    if (!sel || !sel.length) return auto;
    var fin = addDays(inicio, 6), en = sel.filter(function (f) { return f >= inicio && f <= fin; }).sort();
    return en.length ? en : auto;
  }
  function diasDeSemana(inicio, conDatos) {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var f = addDays(inicio, i);
      if (i < 5 || conDatos[f]) out.push(f);   // lunes a viernes siempre; sábado y domingo solo si hay registros
    }
    return out;
  }

  // Une ingresos y salidas de cada persona en "grupos" (H.I, H.S, motivo)
  function gruposDePersona(movs) {
    var g = [], abierto = null;
    movs.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    movs.forEach(function (m) {
      if (m.ing) { if (abierto) g.push(abierto); abierto = { hi: m.hora, hs: '', mot: '' }; }
      else if (abierto && !abierto.hs) { abierto.hs = m.hora; abierto.mot = m.motivo; g.push(abierto); abierto = null; }
      else g.push({ hi: '', hs: m.hora, mot: m.motivo });
    });
    if (abierto) g.push(abierto);
    return g;
  }

  function filasPersonalDelDia(regsDia) {
    var porNombre = {}, orden = [];
    regsDia.forEach(function (r) {
      if (!porNombre[r.nombre]) { porNombre[r.nombre] = []; orden.push(r.nombre); }
      porNombre[r.nombre].push(r);
    });
    var filas = [];
    orden.forEach(function (n) {
      var g = gruposDePersona(porNombre[n]);
      for (var i = 0; i < g.length; i += 3) filas.push({ nombre: n, grupos: g.slice(i, i + 3), cont: i > 0 });   // >3 movimientos: sigue abajo, mismo trabajador
    });
    return filas;
  }

  function normPersonal(r) {
    var tipo = String(r.tipo || r.movimiento || r.accion || '');
    return {
      nombre: String(r.nombre || r.trabajador || r.persona || '').trim(),
      fecha: normFecha(r.fecha || r.date), hora: normHora(r.hora || r.time),
      ing: /ingres|entrad/i.test(tipo), motivo: String(r.motivo || '').trim(),
      t: ts(normFecha(r.fecha || r.date), normHora(r.hora || r.time))
    };
  }

  function marcar(hoja, f) {
    var l = hoja.dataset.fechas ? hoja.dataset.fechas.split(',') : [];
    if (l.indexOf(f) === -1) l.push(f);
    hoja.dataset.fechas = l.join(',');
  }
  function personalSemana(cont, o, inicio) {
    var cfg = o.config || {};
    var filtro = o.trabajador;
    var fin = addDays(inicio, 6);
    var regs = (o.registros || []).map(normPersonal).filter(function (r) { return r.nombre && r.fecha >= inicio && r.fecha <= fin && (!filtro || r.nombre === filtro); });
    var conDatos = {}; regs.forEach(function (r) { conDatos[r.fecha] = true; });
    var dias = elegirDias(diasDeSemana(inicio, conDatos), o.dias, inicio);

    var TOP = 14, SIDE = 66, GAP = 12;
    var pag = null, hojas = 0;
    function nueva() {
      var h = nuevaHoja(cont, 'h', 'apn-p'); hojas++;
      var cuerpo = el('div'); cuerpo.style.cssText = 'position:absolute;left:' + SIDE + 'px;right:' + SIDE + 'px;top:' + TOP + 'px;bottom:' + TOP + 'px;overflow:hidden';
      h.appendChild(cuerpo); pag = { hoja: h, cuerpo: cuerpo };
      return pag;
    }
    var COLS = '16.3fr 5.8fr 5.8fr 16.3fr 5.8fr 5.8fr 16.3fr 5.8fr 5.8fr 16.3fr';
    var vacio = function (s) { return s ? esc(s) : '&nbsp;'; };
    function bloque(f, cont2) {
      var b = el('div'); b.style.paddingBottom = GAP + 'px';
      var t2 = el('div', 'apn-tit', htmlTitulo(f, cont2)); t2.style.cssText += ';font-size:30px;line-height:1.1;height:56px;padding-top:3px';
      var g = el('div', 'apn-g'), hd = el('div', 'r h'); hd.style.gridTemplateColumns = COLS;
      hd.innerHTML = '<div>Nombres y apellidos</div><div>H. I</div><div>H. S</div><div>Motivo</div><div>H. I</div><div>H. S</div><div>Motivo</div><div>H. I</div><div>H. S</div><div>Motivo</div>';
      g.appendChild(hd); b.appendChild(t2); b.appendChild(g); b.tb = g; return b;
    }
    function fila(d) {
      var r = el('div', 'r'); r.style.gridTemplateColumns = COLS;
      var h = '<div class="l">' + vacio(d ? d.nombre : '') + '</div>';
      for (var i = 0; i < 3; i++) { var g = d && d.grupos[i]; h += '<div>' + vacio(g ? g.hi : '') + '</div><div>' + vacio(g ? g.hs : '') + '</div><div class="m">' + vacio(g ? g.mot : '') + '</div>'; }
      r.innerHTML = h; return r;
    }
    nueva();
    dias.forEach(function (f) {
      var filas = filasPersonalDelDia(regs.filter(function (r) { return r.fecha === f; }));
      while (filas.length < 5) filas.push(null);        // como la hoja en blanco: mínimo 5 filas por día
      var i = 0, primera = true;
      while (i < filas.length) {
        var b = bloque(f, !primera);
        pag.cuerpo.appendChild(b);
        var puestas = 0, minimo = Math.min(5, filas.length);
        while (i < filas.length) {
          var tr = fila(filas[i]); b.tb.appendChild(tr);
          if (!cabe(pag.cuerpo)) { b.tb.removeChild(tr); break; }
          i++; puestas++;
        }
        // un día no debe empezar con menos de 5 filas al pie de la hoja: pasa completo a la siguiente
        if (puestas < minimo && i < filas.length && pag.cuerpo.children.length > 1) { pag.cuerpo.removeChild(b); i -= puestas; nueva(); continue; }
        if (!puestas) { b.tb.appendChild(fila(filas[i])); i++; }   // hoja vacía: se fuerza para no ciclar
        marcar(pag.hoja, f);
        // las filas en blanco de relleno son opcionales: si no caben, no se continúan en otra hoja
        if (i < filas.length && filas.slice(i).every(function (x) { return x === null; })) i = filas.length;
        if (i < filas.length) nueva();
        primera = false;
      }
    });
    // logo al final de la última hoja (si no hay espacio, hoja propia)
    var url = logoPie(cfg);
    if (url) {
      // El logo va SIEMPRE en el mismo lugar, abajo de la hoja (como en la plantilla): no sube aunque falten tablas.
      // Si las tablas llegan hasta esa zona, el logo va en una hoja propia (también se descarga).
      var ZONA = 197;                                  // 98 px de logo + 99 px de margen inferior
      var fin2 = 0;
      Array.prototype.forEach.call(pag.cuerpo.children, function (c) { fin2 = Math.max(fin2, c.offsetTop + c.offsetHeight); });
      if (TOP + fin2 - GAP > pag.hoja.offsetHeight - ZONA - 6) { nueva(); if (dias.length) marcar(pag.hoja, dias[dias.length - 1]); }
      var pie = el('div', 'apn-pie'); pie.style.cssText += ';bottom:99px;height:98px';
      var im = img(url); im.style.height = '98px'; im.style.maxWidth = '90%'; pie.appendChild(im);
      pag.hoja.appendChild(pie);
    }
    return { hojas: hojas };
  }
  function renderPersonal(cont, o) {
    o = o || {}; iniciar(); cont.innerHTML = '';
    var n = o.semanas || 1, total = 0;
    for (var k = 0; k < n; k++) total += personalSemana(cont, o, addDays(o.fechaInicio, 7 * k)).hojas;
    if (o.libro) activarLibro(cont, { inicio: o.libroInicio, portada: o.portada, titulo: o.tituloPortada, tipo: 'personal', fechaInicial: o.fechaInicial });
    registrarRerender(cont, function () { return renderPersonal(cont, o); });
    return { hojas: total };
  }

  // ===========================================================================
  //  2) CONTROL VEHICULAR — A4 VERTICAL (un día por hoja, 4 viajes por hoja)
  // ===========================================================================
  function normViaje(r) {
    return {
      placa: r.vehiculoPlaca || r.placa || '', conductor: String(r.conductor || '').trim(),
      destino: r.destino || '', motivo: r.motivo || '',
      fs: normFecha(r.fechaSalida), hs: normHora(r.horaSalida), ks: r.kmSalida,
      fi: normFecha(r.fechaIngreso), hi: normHora(r.horaIngreso), ki: r.kmLlegada,
      os: r.obsSalida || '', oi: r.obsIngreso || '',
      pas: listaNombres(r.pasajeros), pasRet: r.pasajerosRetorno === undefined ? null : listaNombres(r.pasajerosRetorno)
    };
  }
  function listaNombres(v) {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = v ? [v] : []; } }
    return (Array.isArray(v) ? v : []).map(function (x) { return String(x).trim(); }).filter(Boolean);
  }
  // Compatibilidad: registros "sueltos" (tipo Salida / Ingreso) se emparejan por placa
  function emparejarSueltos(lista) {
    var viajes = [], abiertos = {};
    lista.map(function (r) {
      return { placa: r.placa || r.vehiculoPlaca || '', conductor: r.conductor || '', f: normFecha(r.fecha), h: normHora(r.hora), tipo: String(r.tipo || ''),
        km: r.kilometraje != null ? r.kilometraje : '', destino: r.destino || '', motivo: r.motivo || '' };
    }).sort(function (a, b) { return ts(a.f, a.h) < ts(b.f, b.h) ? -1 : 1; }).forEach(function (x) {
      if (/sal/i.test(x.tipo)) { var v = { placa: x.placa, conductor: x.conductor, destino: x.destino, motivo: x.motivo, fs: x.f, hs: x.h, ks: x.km, fi: '', hi: '', ki: '', os: '', oi: '', pas: [], pasRet: null }; viajes.push(v); abiertos[x.placa] = v; }
      else if (abiertos[x.placa]) { var a = abiertos[x.placa]; a.fi = x.f; a.hi = x.h; a.ki = x.km; delete abiertos[x.placa]; }
    });
    return viajes;
  }

  function vehicularSemana(cont, o, inicio) {
    var cfg = o.config || {};
    var fin = addDays(inicio, 6);
    var crudos = o.records || [];
    var viajes = crudos.length && crudos[0].fechaSalida === undefined && crudos[0].tipo !== undefined ? emparejarSueltos(crudos) : crudos.map(normViaje);
    viajes = viajes.filter(function (v) { return v.fs && v.fs >= inicio && v.fs <= fin; });
    var conDatos = {}; viajes.forEach(function (v) { conDatos[v.fs] = true; });
    var dias = elegirDias(diasDeSemana(inicio, conDatos), o.dias, inicio);
    var url = logoPie(cfg), hojas = 0;
    var PIE = url ? 120 : 30;

    function nueva(f, cont2) {
      var h = nuevaHoja(cont, 'v', 'apn-vh'); hojas++; h.dataset.fechas = f;
      var t = el('div', 'apn-tit', htmlTitulo(f, cont2)); t.style.cssText += ';position:absolute;left:0;right:0;top:60px;font-size:34px;line-height:44px';
      h.appendChild(t);
      var cuerpo = el('div'); cuerpo.style.cssText = 'position:absolute;left:38px;right:38px;top:121px;bottom:' + PIE + 'px;overflow:hidden';
      h.appendChild(cuerpo);
      if (url) { var pie = el('div', 'apn-pie'); pie.style.cssText += ';bottom:36px;height:70px'; pie.appendChild(img(url)); h.appendChild(pie); }
      return cuerpo;
    }
    function bloque(v) {
      var cajaB = el('div'); cajaB.style.paddingBottom = '35px';
      var t = el('table', 'apn-t'); cajaB.appendChild(t);
      var km = function (x) { return x === '' || x == null ? '' : esc(x); };
      var otraFecha = v && v.fi && v.fi !== v.fs ? ' <small>' + v.fi.slice(8, 10) + '/' + v.fi.slice(5, 7) + '</small>' : '';
      // Conductor y pasajeros juntos (sin distinguir), uno por línea; la placa va pequeña al final
      var nombresIda = v ? [v.conductor].concat(v.pas).filter(Boolean) : [];
      var nombresRet = v ? [v.conductor].concat(v.pasRet === null ? v.pas : v.pasRet).filter(Boolean) : [];
      var lista = function (arr) {
        if (!arr.length) return '';
        var uniq = arr.filter(function (n, i) { return arr.indexOf(n) === i; });
        var html = uniq.map(function (n) { return '<span class="nm">' + esc(n) + '</span>'; }).join('') + (v && v.placa ? '<small>' + esc(v.placa) + '</small>' : '');
        return '<div class="nms' + (uniq.length > 2 ? ' mu' : '') + '">' + html + '</div>';
      };
      var nombre = lista(nombresIda), nombreRet = lista(nombresRet);
      var obsS = v ? esc(v.os || [v.destino, v.motivo].filter(Boolean).join(' - ')) : '';
      var obsI = v ? esc(v.oi || (v.destino ? 'Retorna de ' + v.destino + (v.motivo ? ' - ' + v.motivo : '') : (v.hi ? 'Retorna' : ''))) : '';
      var hayIngreso = v && (v.hi || v.ki !== '' && v.ki != null);
      t.innerHTML = '<colgroup><col style="width:56px"><col style="width:56px"><col style="width:170px"><col style="width:102px"><col style="width:102px"><col></colgroup>' +
        '<thead><tr><th>H. S</th><th>H. I</th><th>Nombres y apellidos</th><th>K. M / S</th><th>K. M / I</th><th>Observaciones</th></tr></thead><tbody>' +
        '<tr><td>' + (v ? esc(v.hs) : '') + '</td><td></td><td>' + nombre + '</td><td>' + (v ? km(v.ks) : '') + '</td><td></td><td>' + obsS + '</td></tr>' +
        '<tr><td></td><td>' + (v ? esc(v.hi) + otraFecha : '') + '</td><td>' + (hayIngreso ? nombreRet : '') + '</td><td></td><td>' + (v ? km(v.ki) : '') + '</td><td>' + (hayIngreso ? obsI : '') + '</td></tr></tbody>';
      return cajaB;
    }
    var cuerpo;
    dias.forEach(function (f) {
      var lista = viajes.filter(function (v) { return v.fs === f; }).sort(function (a, b) { return a.hs < b.hs ? -1 : 1; });
      var bloques = lista.slice(); while (bloques.length < 4) bloques.push(null);   // mínimo 4 bloques, como la hoja en blanco
      cuerpo = nueva(f, false);
      bloques.forEach(function (v) {
        var b = bloque(v); cuerpo.appendChild(b);
        if (!cabe(cuerpo) && cuerpo.children.length > 1) { cuerpo.removeChild(b); cuerpo = nueva(f, true); cuerpo.appendChild(b); }
      });
    });
    return { hojas: hojas };
  }
  function renderVehicular(cont, o) {
    o = o || {}; iniciar(); cont.innerHTML = '';
    var n = o.semanas || 1, total = 0;
    for (var k = 0; k < n; k++) total += vehicularSemana(cont, o, addDays(o.fechaInicio, 7 * k)).hojas;
    if (o.libro) activarLibro(cont, { inicio: o.libroInicio, portada: o.portada, titulo: o.tituloPortada, tipo: 'vehicular', fechaInicial: o.fechaInicial });
    registrarRerender(cont, function () { return renderVehicular(cont, o); });
    return { hojas: total };
  }


  // ===========================================================================
  //  4) CONTROL DE VISITAS — A4 HORIZONTAL (solo se crea la tabla de los días con visitas)
  // ===========================================================================
  function normVisita(r) {
    return {
      nombre: String(r.nombre || '').trim(), cargo: String(r.cargo || '').trim(), dni: String(r.dni || r.documento || '').trim(),
      entidad: String(r.entidad || r.empresa || '').trim(), motivo: String(r.motivo || '').trim(),
      obs: String(r.observaciones || r.obs || '').trim(),
      fecha: normFecha(r.fecha), hi: normHora(r.horaIngreso || r.hora), hs: normHora(r.horaSalida)
    };
  }
  function visitasSemana(cont, o, inicio) {
    var cfg = o.config || {};
    var fin = addDays(inicio, 6);
    var vis = (o.registros || []).map(normVisita).filter(function (v) { return v.fecha >= inicio && v.fecha <= fin && (v.nombre || v.dni); });
    var conDatos = {}; vis.forEach(function (v) { conDatos[v.fecha] = true; });
    // Por defecto: solo los días con visitas. Con "dias" se elige exactamente cuáles mostrar.
    var dias = elegirDias(Object.keys(conDatos).sort(), o.dias, inicio);
    var TOP = 14, SIDE = 66, GAP = 12, pag = null, hojas = 0;
    function nueva() {
      var h = nuevaHoja(cont, 'h', 'apn-p apn-vs'); hojas++;
      var cuerpo = el('div'); cuerpo.style.cssText = 'position:absolute;left:' + SIDE + 'px;right:' + SIDE + 'px;top:' + TOP + 'px;bottom:' + TOP + 'px;overflow:hidden';
      h.appendChild(cuerpo); pag = { hoja: h, cuerpo: cuerpo }; return pag;
    }
    var COLS = '5.7fr 5.7fr 15.4fr 26.6fr 11.8fr 17.4fr 17.4fr';
    var vacio = function (s) { return s ? esc(s) : '&nbsp;'; };
    function bloque(f, cont2) {
      var b = el('div'); b.style.paddingBottom = GAP + 'px';
      var t2 = el('div', 'apn-tit', htmlTitulo(f, cont2)); t2.style.cssText += ';font-size:30px;line-height:1.1;height:56px;padding-top:3px';
      var g = el('div', 'apn-g'), hd = el('div', 'r h'); hd.style.gridTemplateColumns = COLS;
      hd.innerHTML = '<div>H. I</div><div>H. S</div><div>Empresa / Entidad</div><div>Nombres y apellidos</div><div>D. N. I</div><div>Motivo</div><div>Observaciones</div>';
      g.appendChild(hd); b.appendChild(t2); b.appendChild(g); b.tb = g; return b;
    }
    function fila(v) {
      var r = el('div', 'r'); r.style.gridTemplateColumns = COLS;
      r.innerHTML = '<div>' + vacio(v ? v.hi : '') + '</div><div>' + vacio(v ? v.hs : '') + '</div><div class="l">' + vacio(v ? v.entidad : '') + '</div><div class="l">' + vacio(v ? v.nombre : '') + (v && v.cargo ? '<small class="cg">' + esc(v.cargo) + '</small>' : '') +
        '</div><div>' + vacio(v ? v.dni : '') + '</div><div class="l m">' + vacio(v ? v.motivo : '') + '</div><div class="l m">' + vacio(v ? v.obs : '') + '</div>';
      return r;
    }
    if (!dias.length) return { hojas: 0 };
    nueva();
    dias.forEach(function (f) {
      var filas = vis.filter(function (v) { return v.fecha === f; }).sort(function (a, b2) { return a.hi < b2.hi ? -1 : a.hi > b2.hi ? 1 : 0; });
      while (filas.length < 5) filas.push(null);        // como la hoja en blanco: mínimo 5 filas por día
      var i = 0, primera = true;
      while (i < filas.length) {
        var b = bloque(f, !primera); pag.cuerpo.appendChild(b);
        var puestas = 0, minimo = Math.min(5, filas.length);
        while (i < filas.length) {
          var tr = fila(filas[i]); b.tb.appendChild(tr);
          if (!cabe(pag.cuerpo)) { b.tb.removeChild(tr); break; }
          i++; puestas++;
        }
        if (puestas < minimo && i < filas.length && pag.cuerpo.children.length > 1) { pag.cuerpo.removeChild(b); i -= puestas; nueva(); continue; }
        if (!puestas) { b.tb.appendChild(fila(filas[i])); i++; }
        marcar(pag.hoja, f);
        if (i < filas.length && filas.slice(i).every(function (x) { return x === null; })) i = filas.length;
        if (i < filas.length) nueva();
        primera = false;
      }
    });
    var url = logoPie(cfg);
    if (url) {
      // El logo va SIEMPRE en el mismo lugar, abajo de la hoja (como en la plantilla): no sube aunque falten tablas.
      // Si las tablas llegan hasta esa zona, el logo va en una hoja propia (también se descarga).
      var ZONA = 197;                                  // 98 px de logo + 99 px de margen inferior
      var fin2 = 0;
      Array.prototype.forEach.call(pag.cuerpo.children, function (c) { fin2 = Math.max(fin2, c.offsetTop + c.offsetHeight); });
      if (TOP + fin2 - GAP > pag.hoja.offsetHeight - ZONA - 6) { nueva(); if (dias.length) marcar(pag.hoja, dias[dias.length - 1]); }
      var pie = el('div', 'apn-pie'); pie.style.cssText += ';bottom:99px;height:98px';
      var im = img(url); im.style.height = '98px'; im.style.maxWidth = '90%'; pie.appendChild(im);
      pag.hoja.appendChild(pie);
    }
    return { hojas: hojas };
  }
  function renderVisitas(cont, o) {
    o = o || {}; iniciar(); cont.innerHTML = '';
    var n = o.semanas || 1, total = 0;
    for (var k = 0; k < n; k++) total += visitasSemana(cont, o, addDays(o.fechaInicio, 7 * k)).hojas;
    if (o.libro) activarLibro(cont, { inicio: o.libroInicio, portada: o.portada, titulo: o.tituloPortada, tipo: 'visitas', fechaInicial: o.fechaInicial });
    registrarRerender(cont, function () { return renderVisitas(cont, o); });
    return { hojas: total };
  }

  // ===========================================================================
  //  3) CUADERNO DE OCURRENCIAS — A4 VERTICAL (hojas siguientes sin encabezado)
  // ===========================================================================
  function cuadernoUno(cont, q) {
    var hojas = 0, pagina = null;
    var TABLA1 = { top: 212, h: 871 }, TABLAN = { top: 38, h: 1047 };
    var FIRMAS_H = 170;

    function nueva(primera) {
      var h = nuevaHoja(cont, 'v', 'apn-cq'); hojas++; h.dataset.fechas = q.fecha || ''; h.dataset.turno = q.turno || '';
      if (primera) {
        if (q.logoUrl) h.appendChild(img(q.logoUrl, 'logo'));
        var tt = el('div', 'tit', esc(q.tituloEmpresa || '')); h.appendChild(tt);
        h.__ajustarTitulo = function () { var fs = 30; tt.style.fontSize = fs + 'px'; while (tt.scrollWidth > 540 && fs > 14) { fs--; tt.style.fontSize = fs + 'px'; } };
        h.appendChild(el('div', 'fecha', '<b>' + esc(q.diaSemana || '') + '</b><span>' + esc(q.fechaTexto || '') + '</span>'));
        h.appendChild(el('div', 'datos', 'UNIDAD:<i>' + esc(q.unidad || '') + '</i><br>AGENTE:<i>' + esc(q.agente || '') + '</i><br>TURNO:<i>' + esc(q.turnoTexto || '') + '</i>'));
      }
      var g = primera ? TABLA1 : TABLAN;
      var t = el('div', 'tabla'); t.style.top = g.top + 'px'; t.style.height = g.h + 'px';
      t.appendChild(el('div', 'cab', '<div>H.I</div><div>H.S</div><div>OCURRENCIAS</div>'));
      var cuerpo = el('div', 'cuerpo'); var filas = el('div', 'filas'); cuerpo.appendChild(filas); t.appendChild(cuerpo);
      h.appendChild(t);
      pagina = { hoja: h, tabla: t, cuerpo: cuerpo, filas: filas };
      return pagina;
    }
    function filaEl(f) {
      var d = el('div', 'fila ' + (f.tipo === 'sistema' ? 'sistema' : 'dato'));
      d.innerHTML = '<div class="h">' + esc(f.hi || '') + '</div><div class="h">' + esc(f.hs || '') + '</div><div class="o">' + esc(f.texto || '') + '</div>';
      if (f.firma && q.firmas && q.firmas.supervisor && q.firmas.supervisor.firmaUrl) d.querySelector('.o').appendChild(img(q.firmas.supervisor.firmaUrl, 'firma'));
      return d;
    }
    function bloqueFirma(titulo, f, x) {
      var b = el('div', 'bloque'); b.style.left = x + 'px';
      b.appendChild(f && f.firmaUrl ? img(f.firmaUrl) : el('div', 'linea'));
      b.appendChild(el('div', '', esc(titulo)));
      b.appendChild(el('small', '', esc((f && f.nombre) || '')));
      return b;
    }
    function ponerFirmas(pg) {
      var fm = el('div', 'firmas');
      fm.appendChild(bloqueFirma('AVP SALIENTE', q.firmas && q.firmas.agenteSaliente, 168));
      fm.appendChild(bloqueFirma('AVP ENTRANTE', q.firmas && q.firmas.agenteEntrante, 427));
      // las dos columnas de horas ocupan 101px a la izquierda; las firmas quedan donde las marca la hoja de referencia
      fm.style.left = '101px'; pg.tabla.appendChild(fm);
    }

    nueva(true);
    if (pagina.hoja.__ajustarTitulo) pagina.hoja.__ajustarTitulo();
    (q.filas || []).forEach(function (f) {
      var e = filaEl(f); pagina.filas.appendChild(e);
      if (pagina.filas.offsetHeight > pagina.cuerpo.clientHeight + 0.5 && pagina.filas.children.length > 1) {
        pagina.filas.removeChild(e); nueva(false); pagina.filas.appendChild(e);
      }
    });
    // firmas al final de la última hoja; si no hay espacio, hoja propia (sin encabezado)
    if (pagina.filas.offsetHeight > pagina.cuerpo.clientHeight - FIRMAS_H) nueva(false);
    ponerFirmas(pagina);
    return { hojas: hojas };
  }
  function renderCuaderno(cont, q, opts) {
    opts = opts || {}; iniciar(); cont.innerHTML = '';
    var lista = Array.isArray(q) ? q : (q ? [q] : []), total = 0;
    lista.forEach(function (x) { total += cuadernoUno(cont, x).hojas; });
    if (opts.libro) activarLibro(cont, { inicio: opts.libroInicio, portada: opts.portada, titulo: opts.tituloPortada, tipo: 'cuaderno', fechaInicial: opts.fechaInicial, turnoInicial: opts.turnoInicial });
    registrarRerender(cont, function () { return renderCuaderno(cont, q, opts); });
    return { hojas: total };
  }

  // ===========================================================================
  //  Vista previa tipo libro (solo para ver; la descarga usa siempre las hojas planas)
  // ===========================================================================
  function quitarLibro(cont) {
    var lib = cont.querySelector('.apn-libro'); if (!lib) return;
    var hojas = Array.prototype.slice.call(lib.querySelectorAll('.apn-hoja'));
    cont.innerHTML = ''; hojas.forEach(function (h) { cont.appendChild(h); });
  }
  function portadaEl(o) {
    var p = el('div', 'apn-portada' + (o.portada ? ' img' : ''));
    if (o.portada) p.style.backgroundImage = 'url("' + String(o.portada).replace(/"/g, '%22') + '")';
    else p.appendChild(el('div', 't', esc(o.titulo || 'Cuaderno')));
    p.appendChild(el('div', 'h', 'Toca para abrir'));
    return p;
  }
  // Hojas: la portada es la hoja 0 del libro; después, de a dos por hoja de papel.
  function activarLibro(cont, o) {
    o = o || {};
    quitarLibro(cont);
    var hojas = Array.prototype.slice.call(cont.querySelectorAll(':scope > .apn-hoja'));
    if (!hojas.length) return null;
    var W = hojas[0].offsetWidth, Hh = hojas[0].offsetHeight;
    var lib = el('div', 'apn-libro cerrado'); lib.style.width = (2 * W) + 'px'; lib.style.height = Hh + 'px'; lib.dataset.tipo = o.tipo || '';
    lib.appendChild(el('div', 'hoja-izq-vacia')); lib.appendChild(el('div', 'lomo'));
    var maxA = Math.floor(hojas.length / 2) + 1, hojasLibro = [];
    for (var j = 0; j <= maxA; j++) {
      if (j > 0 && !hojas[2 * j - 2]) break;
      var L = el('div', 'apn-hoja-libro'); L.style.width = W + 'px'; L.style.height = Hh + 'px';
      var fr = el('div', 'cara'), dv = el('div', 'cara dorso');
      if (j === 0) { fr.appendChild(portadaEl(o)); dv.appendChild(el('div', 'apn-interior')); }
      else { fr.appendChild(hojas[2 * j - 2]); if (hojas[2 * j - 1]) dv.appendChild(hojas[2 * j - 1]); }
      L.appendChild(fr); L.appendChild(dv); lib.appendChild(L); hojasLibro.push(L);
    }
    var nav = el('div', 'apn-libro-nav');
    var bP = el('button', '', '‹ Anterior'), bN = el('button', '', 'Abrir ›'), lab = el('span');
    nav.appendChild(bP); nav.appendChild(lab); nav.appendChild(bN);
    cont.innerHTML = ''; cont.appendChild(lib); cont.appendChild(nav);
    var actual = 0, timer = null, n = hojasLibro.length;
    function ir(k) {
      actual = Math.max(0, Math.min(maxA, k)); lib.dataset.actual = actual;
      lib.classList.toggle('cerrado', actual === 0);
      try { cont.dispatchEvent(new CustomEvent('apnlibro', { detail: { abierto: actual > 0 } })); } catch (e) {}
      hojasLibro.forEach(function (L, i) { L.classList.toggle('volteada', i < actual); L.style.zIndex = i < actual ? i + 1 : n - i + 1; });
      bP.disabled = actual === 0; bN.disabled = actual >= maxA; bN.textContent = actual === 0 ? 'Abrir ›' : 'Siguiente ›';
      var izq = actual >= 2 ? 2 * actual - 2 : 0, der = actual >= 1 ? 2 * actual - 1 : 0;
      lab.textContent = actual === 0 ? 'Portada · ' + hojas.length + (hojas.length === 1 ? ' hoja' : ' hojas')
        : (izq ? 'Hojas ' + izq + ' – ' + (der <= hojas.length ? der : izq) : 'Hoja ' + der) + ' de ' + hojas.length;
    }
    function sinAnimacion(fn) {
      hojasLibro.forEach(function (L) { L.style.transition = 'none'; }); lib.style.transition = 'none';
      fn(); void lib.offsetWidth;
      hojasLibro.forEach(function (L) { L.style.transition = ''; }); lib.style.transition = '';
    }
    function foliar(k) {                       // pasa varias hojas seguidas hasta llegar
      k = Math.max(0, Math.min(maxA, k)); clearInterval(timer);
      if (k === actual) return;
      if (Math.abs(k - actual) <= 1) { ir(k); return; }
      lib.classList.add('rapido'); var paso = k > actual ? 1 : -1;
      timer = setInterval(function () {
        if (actual === k) { clearInterval(timer); setTimeout(function () { lib.classList.remove('rapido'); }, 450); return; }
        ir(actual + paso);
      }, 140);
    }
    function abrir() {                         // desde la portada: abre en la hoja de la fecha elegida
      var idx = o.fechaInicial ? indiceDeFecha(hojas, o.fechaInicial, o.turnoInicial) : -1;
      if (idx > 1) foliar(posicionDeHoja(idx)); else ir(1);
    }
    bP.onclick = function () { clearInterval(timer); ir(actual - 1); }; bN.onclick = function () { clearInterval(timer); actual === 0 ? abrir() : ir(actual + 1); };
    lib.onclick = function (e) {
      if (actual === 0) { abrir(); return; }
      var r = lib.getBoundingClientRect(); (e.clientX - r.left < r.width / 2) ? ir(actual - 1) : ir(actual + 1);
    };
    cont.tabIndex = 0;
    cont.onkeydown = function (e) { if (e.key === 'ArrowRight') ir(actual + 1); if (e.key === 'ArrowLeft') ir(actual - 1); };
    if (o.inicio) sinAnimacion(function () { ir(o.inicio); }); else ir(0);
    lib.__api = { ir: ir, foliar: foliar, hojas: hojas, sin: function (k) { sinAnimacion(function () { ir(k); }); } };
    return lib.__api;
  }

  function lunesDe(f) { var d = new Date(f + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
  // Índice de la hoja que contiene la fecha (y turno, en el cuaderno); -1 si no hay
  function indiceDeFecha(hojas, fecha, turno) {
    function tiene(h, f) { return (h.dataset.fechas || '').split(',').indexOf(f) !== -1; }
    var idx = -1;
    hojas.forEach(function (h, i) { if (idx < 0 && tiene(h, fecha) && (!turno || h.dataset.turno === turno)) idx = i; });
    if (idx < 0 && !turno) {                  // fecha sin hoja propia (ej. sábado sin datos): la hoja de esa semana
      var sem = lunesDe(fecha);
      hojas.forEach(function (h, i) { if (idx < 0 && (h.dataset.fechas || '').split(',').some(function (x) { return x && lunesDe(x) === sem; })) idx = i; });
    }
    return idx;
  }
  function posicionDeHoja(idx) { return idx % 2 === 0 ? idx / 2 + 1 : (idx + 3) / 2; }
  // Abre el libro y pasa las hojas hasta la que contiene esa fecha
  function irAFecha(cont, fecha, o) {
    o = o || {};
    var lib = cont.querySelector('.apn-libro'); if (!lib || !lib.__api) return false;
    var idx = indiceDeFecha(lib.__api.hojas, fecha, o.turno); if (idx < 0) return false;
    var a = posicionDeHoja(idx);
    if (o.animar === false) lib.__api.sin(a); else lib.__api.foliar(a);
    return true;
  }

  // ===========================================================================
  //  Descargas (imagen y PDF) — leen SIEMPRE las hojas planas, a tamaño A4 fijo
  // ===========================================================================
  // filtro opcional {fechas:[...], turno} → solo esas hojas (el libro puede traer varias semanas o días)
  function hojasDe(cont, filtro) {
    var todas = Array.prototype.slice.call(cont.querySelectorAll('.apn-hoja'));
    if (!filtro || !filtro.fechas) return todas;
    return todas.filter(function (h) {
      var fs = (h.dataset.fechas || '').split(',');
      return fs.some(function (f) { return filtro.fechas.indexOf(f) !== -1; }) && (!filtro.turno || h.dataset.turno === filtro.turno);
    });
  }

  // Copia plana de la hoja fuera de pantalla (sin transformaciones del libro)
  function copiaPlana(h) {
    var host = el('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff';
    var c = h.cloneNode(true); c.style.margin = '0'; host.appendChild(c); document.body.appendChild(host);
    return { nodo: c, quitar: function () { host.remove(); } };
  }
  function capturar(h, escala) {
    var plana = copiaPlana(h), w = plana.nodo.offsetWidth, hh = plana.nodo.offsetHeight;
    function intento(sinImg) {
      return global.html2canvas(plana.nodo, {
        scale: escala || 2, backgroundColor: '#ffffff', useCORS: true, width: w, height: hh, windowWidth: w, windowHeight: hh, scrollX: 0, scrollY: 0,
        ignoreElements: sinImg ? function (e) { return e.tagName === 'IMG'; } : undefined
      });
    }
    return listo.then(function () {
      var imgs = Array.prototype.slice.call(plana.nodo.querySelectorAll('img'));
      return Promise.all(imgs.map(function (i) { return i.complete ? 1 : new Promise(function (r) { i.onload = i.onerror = r; }); }));
    }).then(function () { return intento(false); })
      .catch(function () { aviso('Una imagen (logo o firma) no permite exportarse; se descarga sin ella.'); return intento(true); })
      .then(function (c) { plana.quitar(); return { canvas: c, w: w, h: hh }; }, function (e) { plana.quitar(); throw e; });
  }
  function aviso(m) { try { if (global.APNReportes && typeof global.APNReportes.onAviso === 'function') global.APNReportes.onAviso(m); else console.warn(m); } catch (e) {} }

  function guardarBase64(b64, nombre, mime) {
    if (global.AndroidDownloader && global.AndroidDownloader.saveBase64File) { global.AndroidDownloader.saveBase64File(b64, nombre, mime); return; }
    var a = document.createElement('a'); a.download = nombre; a.href = 'data:' + mime + ';base64,' + b64;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function descargarPNG(cont, nombre, filtro) {
    nombre = nombre || 'reporte';
    var hojas = hojasDe(cont, filtro);
    if (!hojas.length) { aviso('No hay hojas para descargar.'); return Promise.resolve(); }
    return cargarScript(CDN.html2canvas).then(function () {
      var p = Promise.resolve();
      hojas.forEach(function (h, i) {
        p = p.then(function () { return capturar(h, 2); }).then(function (r) {
          var b64 = r.canvas.toDataURL('image/png').split(',')[1];
          guardarBase64(b64, nombre + (hojas.length > 1 ? '_hoja' + (i + 1) : '') + '.png', 'image/png');
          return esperar(450);
        });
      });
      return p;
    });
  }

  function descargarPDF(cont, nombre, filtro) {
    nombre = nombre || 'reporte';
    var hojas = hojasDe(cont, filtro);
    if (!hojas.length) { aviso('No hay hojas para descargar.'); return Promise.resolve(); }
    return Promise.all([cargarScript(CDN.html2canvas), cargarScript(CDN.jspdf)]).then(function () {
      var jsPDF = global.jspdf.jsPDF, pdf = null, p = Promise.resolve();
      hojas.forEach(function (h, i) {
        p = p.then(function () { return capturar(h, 2); }).then(function (r) {
          var horiz = r.w > r.h;                       // A4 estricto: 297x210 (horizontal) o 210x297 (vertical)
          var fmt = horiz ? 'l' : 'p', W = horiz ? 297 : 210, Hh = horiz ? 210 : 297;
          if (!pdf) pdf = new jsPDF({ orientation: fmt, unit: 'mm', format: 'a4' }); else pdf.addPage('a4', fmt);
          pdf.addImage(r.canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, W, Hh);
        });
      });
      return p.then(function () {
        if (global.AndroidDownloader && global.AndroidDownloader.saveBase64File) {
          global.AndroidDownloader.saveBase64File(pdf.output('datauristring').split(',')[1], nombre + '.pdf', 'application/pdf');
        } else pdf.save(nombre + '.pdf');
      });
    });
  }

  // ===========================================================================
  global.APNReportes = {
    version: '1.1', listo: listo,
    renderPersonal: renderPersonal, renderVehicular: renderVehicular, renderCuaderno: renderCuaderno, renderVisitas: renderVisitas,
    activarLibro: activarLibro, quitarLibro: quitarLibro, irAFecha: irAFecha, lunesDe: lunesDe,
    descargarPNG: descargarPNG, descargarPDF: descargarPDF,
    onAviso: null
  };
})(window);
