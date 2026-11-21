/* Service worker de APN: permite abrir las páginas SIN Internet (después de abrirlas una vez con Internet).
   - Archivos de esta misma página: primero la red (siempre lo más nuevo); si no hay Internet, la copia guardada.
   - Librerías externas (html2canvas, jsPDF, fuentes): primero la copia guardada.
   - El Apps Script (datos) NUNCA se guarda aquí: la cola sin conexión de apn-core.js se encarga. */
const VERSION = 'apn-v6';
const BASE = ['./', 'index.html', 'control_personal.html', 'control_vehicular.html', 'control_visitas.html',
  'apn-config.js', 'apn-core.js', 'apn-reportes.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(BASE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function guardar(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
  return res;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'script.google.com' || u.hostname.endsWith('googleusercontent.com')) return;
  if (u.origin === self.location.origin) {
    e.respondWith(new Promise(resolve => {
      let listo = false;
      const cache = () => caches.match(req, { ignoreSearch: true });
      const t = setTimeout(() => cache().then(h => { if (h && !listo) { listo = true; resolve(h); } }), 4000);   // red lenta: usa la copia
      fetch(req).then(r => { clearTimeout(t); if (!listo) { listo = true; resolve(guardar(req, r)); } else guardar(req, r); })
        .catch(() => cache().then(h => { clearTimeout(t); if (!listo) { listo = true; resolve(h || Response.error()); } }));
    }));
  } else {
    e.respondWith(caches.match(req).then(h => h || fetch(req).then(r => guardar(req, r)).catch(() => Response.error())));
  }
});
