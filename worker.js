const OREF_BASE = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx';

const HEADERS = {
  'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':          'https://www.oref.org.il/',
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

// Format date as DD.MM.YYYY in Israel time (UTC+2)
function israelDate(offsetDays) {
  const ms = Date.now() + (2 * 60 * 60 * 1000) + (offsetDays * 24 * 60 * 60 * 1000);
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

async function fetchDay(ds) {
  const url = `${OREF_BASE}?lang=he&fromDate=${ds}&toDate=${ds}&mode=0`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) return { ds, status: resp.status, alerts: [] };
  try {
    const data = await resp.json();
    return { ds, status: resp.status, alerts: Array.isArray(data) ? data : [] };
  } catch {
    return { ds, status: resp.status, alerts: [] };
  }
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ?debug=1 returns per-day status codes for diagnosis
    const debug = url.searchParams.get('debug') === '1';

    if (debug) {
      // Test both endpoints
      const days = [-2, -1, 0].map(i => israelDate(i));
      const results = await Promise.all(days.map(fetchDay));
      const recentResp = await fetch('https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json', { headers: HEADERS });
      const recentText = await recentResp.text();
      let recentData = [];
      try { recentData = JSON.parse(recentText); } catch {}
      return new Response(JSON.stringify({
        history_subdomain: results.map(r => ({ date: r.ds, status: r.status, count: r.alerts.length })),
        recent_endpoint: { status: recentResp.status, count: Array.isArray(recentData) ? recentData.length : recentText.slice(0,100) }
      }, null, 2), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const days = [-2, -1, 0].map(i => israelDate(i));
    const results = await Promise.all(days.map(fetchDay));

    const alerts = results.flatMap(r => r.alerts);
    return new Response(JSON.stringify(alerts), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
    });
  },
};
