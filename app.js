// City name variants as they appear in Pikud HaOref data
const CITY_VARIANTS = {
  'נתניה':       ['נתניה'],
  'פתח תקווה':  ['פתח תקווה', 'פתח-תקווה'],
  'תל אביב':    ['תל אביב', 'תל אביב - יפו', 'תל אביב-יפו', 'תל-אביב']
};

const RISK_LEVELS = [
  { max: 10, label: 'סיכון נמוך',    color: '#3aaa35' },
  { max: 35, label: 'סיכון בינוני',  color: '#FF9800' },
  { max: 100, label: 'סיכון גבוה',   color: '#e53935' }
];

let chart = null;
let selectedMinutes = 5;


// ── Cloudflare Worker URL ─────────────────────────────────────
// After deploying worker.js to Cloudflare Workers, paste the URL here:
const WORKER_URL = 'https://noisemap-proxy.REPLACE_ME.workers.dev';

// ── Fetch alerts from Cloudflare Worker (fresh, no CORS issues) ──
async function fetchAllAlerts() {
  const resp = await fetch(WORKER_URL);
  if (!resp.ok) throw new Error(`Worker error: ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

// ── Filter by city ────────────────────────────────────────────
function filterByCity(alerts, city) {
  const variants = CITY_VARIANTS[city] || [city];
  return alerts.filter(a =>
    a.data && variants.some(v => a.data.includes(v))
  );
}

// ── Count alerts per minute (0–1439) ─────────────────────────
function countByMinute(alerts) {
  const counts = new Array(1440).fill(0);
  alerts.forEach(a => {
    if (!a.alertDate) return;
    const raw = a.alertDate;
    let h, m;
    if (raw.includes('.')) {
      // "01.01.2024 13:45:00"
      const timePart = raw.split(' ')[1];
      if (!timePart) return;
      const parts = timePart.split(':');
      h = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
    } else {
      // ISO: "2026-03-13T13:45:00"
      const d = new Date(raw);
      h = d.getHours();
      m = d.getMinutes();
    }
    const idx = h * 60 + m;
    if (idx >= 0 && idx < 1440) counts[idx]++;
  });
  return counts;
}

// ── Aggregate minute counts into hourly for the chart ─────────
function minutesToHourly(minuteCounts) {
  return Array.from({ length: 24 }, (_, h) =>
    minuteCounts.slice(h * 60, h * 60 + 60).reduce((s, v) => s + v, 0)
  );
}

// ── Find best window (1-minute resolution) ────────────────────
function findBestWindow(minuteCounts, minutes) {
  const TOTAL = 1440;
  let bestMinute = 0;
  let bestSum = Infinity;

  for (let i = 0; i < TOTAL; i++) {
    let sum = 0;
    for (let w = 0; w < minutes; w++) {
      sum += minuteCounts[(i + w) % TOTAL];
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestMinute = i;
    }
  }
  return { bestMinute, bestSum };
}

// ── Risk calculation ──────────────────────────────────────────
function calcRisk(minuteCounts, bestMinute, minutes) {
  // Max expected: 3 days × 5 alerts/hour × (minutes/60)
  const maxExpected = 3 * 5 * (minutes / 60);
  let sum = 0;
  for (let w = 0; w < minutes; w++) {
    sum += minuteCounts[(bestMinute + w) % 1440];
  }
  return Math.min(Math.round((sum / Math.max(maxExpected, 1)) * 100), 100);
}

function getRiskStyle(risk) {
  return RISK_LEVELS.find(r => risk <= r.max) || RISK_LEVELS[RISK_LEVELS.length - 1];
}

// ── Chart ─────────────────────────────────────────────────────
function renderChart(minuteCounts, bestMinute, durationMinutes) {
  const hourlyCounts = minutesToHourly(minuteCounts);
  const max = Math.max(...hourlyCounts, 1);
  const data = hourlyCounts.map(c => Math.round((c / max) * 100));

  // Highlight every hour that overlaps with the best window
  const bestHour = Math.floor(bestMinute / 60);
  const endMinute = (bestMinute + durationMinutes - 1) % 1440;
  const endHour = Math.floor(endMinute / 60);
  const colors = hourlyCounts.map((_, i) => {
    if (bestHour <= endHour) return (i >= bestHour && i <= endHour) ? '#3aaa35' : '#1565c0';
    return (i >= bestHour || i <= endHour) ? '#3aaa35' : '#1565c0'; // wraps midnight
  });

  if (chart) chart.destroy();
  const ctx = document.getElementById('alertChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 3,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            label: ctx => `${ctx.raw}% עצימות`
          }
        }
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%', font: { size: 10 } },
          grid: { color: '#f0f0f0' }
        },
        x: {
          ticks: { font: { size: 10 } },
          grid: { display: false }
        }
      }
    }
  });
}

// ── Format minute index → "HH:MM" ─────────────────────────────
function fmtMinute(m) {
  const total = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

// ── Stats panel ───────────────────────────────────────────────
function renderStats(alerts, minuteCounts, bestMinute, durationMinutes, city) {
  const total = alerts.length;
  const avgPerDay = (total / 3).toFixed(1);
  const hourlyCounts = minutesToHourly(minuteCounts);
  const peakHour = hourlyCounts.indexOf(Math.max(...hourlyCounts));
  const lastAlert = alerts.length > 0 ? alerts[alerts.length - 1].alertDate || '—' : '—';
  const lastAlertShort = typeof lastAlert === 'string'
    ? (lastAlert.includes('T') ? lastAlert.split('T')[1].slice(0,5) : (lastAlert.split(' ')[1] || lastAlert).slice(0,5))
    : '—';

  const endMinute = (bestMinute + durationMinutes - 1) % 1440;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-row"><span class="stat-label">ישוב</span><span class="stat-value">${city}</span></div>
    <div class="stat-row"><span class="stat-label">חלון בטוח</span><span class="stat-value">${fmtMinute(bestMinute)} – ${fmtMinute(endMinute)}</span></div>
    <div class="stat-row"><span class="stat-label">מספר התרעות (3 ימים)</span><span class="stat-value">${total}</span></div>
    <div class="stat-row"><span class="stat-label">ממוצע ליום</span><span class="stat-value">${avgPerDay}</span></div>
    <div class="stat-row"><span class="stat-label">שעת השיא</span><span class="stat-value">${String(peakHour).padStart(2,'0')}:00</span></div>
    <div class="stat-row"><span class="stat-label">זמן התרעה אחרונה</span><span class="stat-value">${lastAlertShort}</span></div>
  `;
}

// ── Main analyze ──────────────────────────────────────────────
async function analyze() {
  const city = document.getElementById('citySelect').value;
  const btn = document.getElementById('findBtn');

  btn.textContent = '⏳ טוען נתונים...';
  btn.disabled = true;

  try {
    const allAlerts = await fetchAllAlerts();
    const cityAlerts = filterByCity(allAlerts, city);
    const minuteCounts = countByMinute(cityAlerts);

    const { bestMinute } = findBestWindow(minuteCounts, selectedMinutes);
    const risk = calcRisk(minuteCounts, bestMinute, selectedMinutes);
    const { label, color } = getRiskStyle(risk);

    // Update best time with minute precision
    document.getElementById('bestTime').textContent = fmtMinute(bestMinute);

    // Update risk badge
    const badge = document.getElementById('riskBadge');
    badge.style.background = color;
    document.getElementById('riskPercent').textContent = risk;
    document.getElementById('riskLabel').textContent = label;

    // Show sections
    document.getElementById('resultRow').classList.remove('hidden');
    document.getElementById('chartSection').classList.remove('hidden');
    document.getElementById('statsSection').classList.remove('hidden');

    renderChart(minuteCounts, bestMinute, selectedMinutes);
    renderStats(cityAlerts, minuteCounts, bestMinute, selectedMinutes, city);

  } catch (err) {
    console.error(err);
    alert('שגיאה בטעינת נתונים מפיקוד העורף. אנא נסו שוב.');
  }

  btn.textContent = 'אפשר לעשות סקס';
  btn.disabled = false;
}

// ── Event listeners ───────────────────────────────────────────
document.querySelectorAll('.dur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMinutes = parseInt(btn.dataset.minutes, 10);
    document.getElementById('durationLabel').textContent = btn.dataset.minutes + " דק'";
  });
});

document.getElementById('findBtn').addEventListener('click', analyze);
