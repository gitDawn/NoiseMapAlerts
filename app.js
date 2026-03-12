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

// ── Date helpers ──────────────────────────────────────────────
function formatDateIL(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function getLast3Days() {
  const dates = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d);
  }
  return dates;
}

// ── Fetch from Pikud HaOref via CORS proxy ────────────────────
async function fetchAlertsForDate(date) {
  const ds = formatDateIL(date);
  const apiUrl = `https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&fromDate=${ds}&toDate=${ds}&mode=0`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;
  const resp = await fetch(proxyUrl);
  if (!resp.ok) throw new Error('Network error');
  const json = await resp.json();
  if (!json.contents) return [];
  try {
    const parsed = JSON.parse(json.contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchAllAlerts() {
  const days = getLast3Days();
  const results = await Promise.all(days.map(fetchAlertsForDate));
  return results.flat();
}

// ── Filter by city ────────────────────────────────────────────
function filterByCity(alerts, city) {
  const variants = CITY_VARIANTS[city] || [city];
  return alerts.filter(a =>
    a.data && variants.some(v => a.data.includes(v))
  );
}

// ── Count alerts per hour (0–23) ──────────────────────────────
function countByHour(alerts) {
  const counts = new Array(24).fill(0);
  alerts.forEach(a => {
    if (!a.alertDate) return;
    // alertDate format: "DD.MM.YYYY HH:MM:SS" or ISO
    const raw = a.alertDate;
    let hour;
    if (raw.includes('.')) {
      // "01.01.2024 13:45:00"
      const timePart = raw.split(' ')[1];
      hour = timePart ? parseInt(timePart.split(':')[0], 10) : 0;
    } else {
      hour = new Date(raw).getHours();
    }
    if (hour >= 0 && hour < 24) counts[hour]++;
  });
  return counts;
}

// ── Find best window ──────────────────────────────────────────
function findBestWindow(counts, minutes) {
  // Each "slot" = 1 hour. Window = ceil(minutes/60) hours.
  const windowSize = Math.max(1, Math.ceil(minutes / 60));

  let bestHour = 0;
  let bestSum = Infinity;

  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let w = 0; w < windowSize; w++) {
      sum += counts[(h + w) % 24];
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestHour = h;
    }
  }
  return { bestHour, bestSum, windowSize };
}

// ── Risk calculation ──────────────────────────────────────────
function calcRisk(counts, bestHour, windowSize) {
  // Max possible = 3 days × ~5 alerts/hour = 15 per hour, times window
  const maxExpected = 3 * 5 * windowSize;
  let sum = 0;
  for (let w = 0; w < windowSize; w++) {
    sum += counts[(bestHour + w) % 24];
  }
  return Math.min(Math.round((sum / maxExpected) * 100), 100);
}

function getRiskStyle(risk) {
  return RISK_LEVELS.find(r => risk <= r.max) || RISK_LEVELS[RISK_LEVELS.length - 1];
}

// ── Chart ─────────────────────────────────────────────────────
function renderChart(counts, bestHour, windowSize) {
  const max = Math.max(...counts, 1);
  const data = counts.map(c => Math.round((c / max) * 100));

  const colors = counts.map((_, i) => {
    for (let w = 0; w < windowSize; w++) {
      if ((bestHour + w) % 24 === i) return '#3aaa35';
    }
    return '#1565c0';
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

// ── Stats panel ───────────────────────────────────────────────
function renderStats(alerts, counts, bestHour, windowSize, city) {
  const total = alerts.length;
  const avgPerDay = (total / 3).toFixed(1);
  const maxHour = counts.indexOf(Math.max(...counts));
  const lastAlert = alerts.length > 0 ? alerts[alerts.length - 1].alertDate || '—' : '—';
  const lastAlertShort = typeof lastAlert === 'string' ? lastAlert.split(' ')[1] || lastAlert : '—';

  const endHour = (bestHour + windowSize - 1) % 24;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-row"><span class="stat-label">ישוב</span><span class="stat-value">${city}</span></div>
    <div class="stat-row"><span class="stat-label">חלון בטוח</span><span class="stat-value">${String(bestHour).padStart(2,'0')}:00 – ${String(endHour).padStart(2,'0')}:59</span></div>
    <div class="stat-row"><span class="stat-label">מספר התרעות (3 ימים)</span><span class="stat-value">${total}</span></div>
    <div class="stat-row"><span class="stat-label">ממוצע ליום</span><span class="stat-value">${avgPerDay}</span></div>
    <div class="stat-row"><span class="stat-label">שעת השיא</span><span class="stat-value">${String(maxHour).padStart(2,'0')}:00</span></div>
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
    const counts = countByHour(cityAlerts);

    const { bestHour, windowSize } = findBestWindow(counts, selectedMinutes);
    const risk = calcRisk(counts, bestHour, windowSize);
    const { label, color } = getRiskStyle(risk);

    // Update best time
    document.getElementById('bestTime').textContent =
      `${String(bestHour).padStart(2, '0')}:00`;

    // Update risk badge
    const badge = document.getElementById('riskBadge');
    badge.style.background = color;
    document.getElementById('riskPercent').textContent = risk;
    document.getElementById('riskLabel').textContent = label;

    // Show sections
    document.getElementById('resultRow').classList.remove('hidden');
    document.getElementById('chartSection').classList.remove('hidden');
    document.getElementById('statsSection').classList.remove('hidden');

    renderChart(counts, bestHour, windowSize);
    renderStats(cityAlerts, counts, bestHour, windowSize, city);

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
