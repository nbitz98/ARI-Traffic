// ARI Traffic relay (Cloudflare Worker).
// Phones can't call the public ADS-B APIs directly because those APIs don't send CORS headers.
// This worker fetches the data server-side and returns it to the ARI Traffic page only.
const ALLOWED_ORIGIN = 'https://nbitz98.github.io';
const UPSTREAMS = [
  ['airplanes.live', 'https://api.airplanes.live/v2/point'],
  ['adsb.lol', 'https://api.adsb.lol/v2/point'],
];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Feed',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, {headers: cors});
    const m = new URL(request.url).pathname.match(/^\/point\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/);
    if (!m) return new Response('Use /point/<lat>/<lon>/<radius NM>', {status: 404, headers: cors});
    const radius = Math.min(Number(m[3]), 100);
    const errors = [];
    for (const [name, base] of UPSTREAMS) {
      try {
        const up = await fetch(`${base}/${m[1]}/${m[2]}/${radius}`, {headers: {'User-Agent': 'ARI-Traffic relay (TAMU-CC Autonomy Research Institute)'}});
        if (up.ok) {
          return new Response(up.body, {headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Feed': name}});
        }
        errors.push(`${name}: HTTP ${up.status}`);
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }
    return new Response(errors.join('; '), {status: 502, headers: cors});
  },
};
