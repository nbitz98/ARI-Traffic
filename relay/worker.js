// ARI Traffic relay (Cloudflare Worker) for the Flightradar24 API.
// Keeps the FR24 key secret and answers only the ARI Traffic page.
//
// Settings > Variables and Secrets on this worker:
//   FR24_TOKEN  (type: Secret)  your FR24 API key (sandbox key or live key)
//   FR24_MODE   (type: Text)    "sandbox" for FR24's static test data, or "live" for real traffic
const ALLOWED_ORIGIN = 'https://nbitz98.github.io';
const BASE = 'https://fr24api.flightradar24.com/api';

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) {
      // Any unexpected failure still answers with CORS headers, so the page can show the reason
      return new Response(`Relay error: ${e && e.message || e}`, {status: 500, headers: {'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin'}});
    }
  },
};

async function handle(request, env) {
  {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Feed',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, {headers: cors});
    const m = new URL(request.url).pathname.match(/^\/point\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/);
    if (!m) return new Response('Use /point/<lat>/<lon>/<radius NM>', {status: 404, headers: cors});
    if (!env.FR24_TOKEN) return new Response('FR24_TOKEN secret is not set on this worker', {status: 500, headers: cors});

    const lat = Number(m[1]), lon = Number(m[2]), nm = Math.min(Number(m[3]), 100);
    const dLat = nm / 60, dLon = nm / (60 * Math.cos(lat * Math.PI / 180));
    const bounds = [lat + dLat, lat - dLat, lon - dLon, lon + dLon].map(v => v.toFixed(3)).join(',');  // north,south,west,east
    const mode = (env.FR24_MODE || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
    const path = (mode === 'sandbox' ? '/sandbox' : '') + '/live/flight-positions/light';

    const up = await fetch(`${BASE}${path}?bounds=${bounds}&limit=200`, {
      headers: {'Authorization': `Bearer ${env.FR24_TOKEN}`, 'Accept': 'application/json', 'Accept-Version': 'v1'},
    });
    const text = await up.text();
    if (!up.ok) return new Response(`FR24 ${mode}: HTTP ${up.status} ${text.slice(0, 200)}`, {status: 502, headers: cors});

    // Convert FR24 records to the field names the page uses
    let data; try { data = JSON.parse(text).data || []; } catch (e) { return new Response('FR24 returned unreadable data', {status: 502, headers: cors}); }
    const now = Date.now();
    const ac = data.map(f => {
      const ts = f.timestamp ? Date.parse(f.timestamp) : NaN;
      const ground = (f.alt ?? 0) <= 0 && (f.gspeed ?? 0) < 40;
      return {
        hex: f.hex || f.fr24_id, flight: f.callsign || '', lat: f.lat, lon: f.lon,
        alt_baro: ground ? 'ground' : f.alt, gs: f.gspeed, track: f.track, baro_rate: f.vspeed,
        t: f.type || '', r: f.reg || '', squawk: f.squawk,
        seen_pos: isFinite(ts) ? Math.max(0, (now - ts) / 1000) : 0,
      };
    });
    return new Response(JSON.stringify({ac, now, source: `fr24-${mode}`}), {
      headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Feed': `Flightradar24${mode === 'sandbox' ? ' sandbox' : ''}`},
    });
  }
}
