/**
 * Cloudflare Worker — Proxy for Pikud HaOref alert history
 *
 * Deploy at: https://dash.cloudflare.com → Workers & Pages → Create Worker
 * Paste this script and click Save & Deploy.
 * Copy the worker URL (e.g. https://noisemap-proxy.YOUR_SUBDOMAIN.workers.dev)
 * and set it as WORKER_URL in app.js.
 */

const OREF_BASE = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx';
const SEED_URL  = 'https://www.oref.org.il/';

const HEADERS = {
  'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':          SEED_URL,
  'X-Requested-With': 'XMLHttpRequest',
  'Accept':           'application/json, text/javascript, */*; q=0.01',
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age':       '86400',
  };
}

async function fetchDay(ds, seedCookies) {
  const url = `${OREF_BASE}?lang=he&fromDate=${ds}&toDate=${ds}&mode=0`;
  const resp = await fetch(url, {
    headers: { ...HEADERS, 'Cookie': seedCookies },
  });
  if (!resp.ok) return [];
  try {
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // Seed cookies from main oref page
      const seedResp = await fetch(SEED_URL, { headers: HEADERS });
      const rawCookies = (seedResp.headers.getAll
        ? seedResp.headers.getAll('set-cookie')
        : [seedResp.headers.get('set-cookie') || '']
      ).join('; ');

      // Fetch last 3 days
      const today = new Date();
      const days = [2, 1, 0].map(i => {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        return fmtDate(d);
      });

      const results = await Promise.all(days.map(ds => fetchDay(ds, rawCookies)));
      const alerts = results.flat();

      return new Response(JSON.stringify(alerts), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
