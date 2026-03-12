"""
fetch_alerts.py
Fetches the latest Pikud HaOref alerts and ACCUMULATES them into alerts.json,
keeping up to 30 days of history. Each run merges new alerts with the existing
file (deduplicated by rid), so data builds up over time.

Requirements:
    pip install requests

Scheduled via Windows Task Scheduler every 2 hours.
"""

import requests
import json
import datetime
import subprocess
import os
import sys

REPO_DIR    = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(REPO_DIR, 'alerts.json')
KEEP_DAYS   = 30  # discard alerts older than this

HEADERS = {
    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':          'https://www.oref.org.il/',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept':           'application/json, text/javascript, */*; q=0.01',
}

def fetch_latest():
    """Fetch the most recent ~3000 alerts from Pikud HaOref."""
    today = datetime.date.today()
    past  = (today - datetime.timedelta(days=5)).strftime('%d.%m.%Y')
    url = (
        'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx'
        f'?lang=he&fromDate={past}&toDate={today.strftime("%d.%m.%Y")}&mode=1'
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.ok:
            data = r.json()
            if isinstance(data, list):
                print(f'API returned {len(data)} alerts')
                return data
        print(f'HTTP {r.status_code}', file=sys.stderr)
    except Exception as e:
        print(f'Fetch error — {e}', file=sys.stderr)
    return []

def load_existing():
    """Load the current alerts.json if it exists."""
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception:
            pass
    return []

def merge_and_trim(existing, fresh):
    """
    Merge fresh alerts into existing, deduplicate by rid,
    and drop anything older than KEEP_DAYS.
    """
    cutoff = datetime.date.today() - datetime.timedelta(days=KEEP_DAYS)

    def alert_date(a):
        raw = a.get('alertDate') or a.get('date', '')
        try:
            if 'T' in raw:
                return datetime.date.fromisoformat(raw.split('T')[0])
            if '.' in raw and len(raw) >= 10:
                # DD.MM.YYYY
                parts = raw[:10].split('.')
                return datetime.date(int(parts[2]), int(parts[1]), int(parts[0]))
        except Exception:
            pass
        return datetime.date.today()

    # Merge: existing first (preserves order), then new
    seen = set()
    merged = []
    for a in existing + fresh:
        rid = a.get('rid')
        if rid is None or rid not in seen:
            if rid is not None:
                seen.add(rid)
            if alert_date(a) >= cutoff:
                merged.append(a)

    # Sort newest-first (matches API order)
    merged.sort(key=lambda a: a.get('alertDate') or a.get('date', ''), reverse=True)
    return merged

def git_push():
    def run(cmd):
        result = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True)
        if result.returncode != 0:
            print(f'  git: {result.stderr.strip()}', file=sys.stderr)
        return result.returncode == 0

    run(['git', 'pull', '--rebase'])
    run(['git', 'add', 'alerts.json'])
    check = subprocess.run(['git', 'diff', '--staged', '--quiet'], cwd=REPO_DIR)
    if check.returncode == 0:
        print('No changes — alerts.json is up to date.')
        return
    run(['git', 'commit', '-m', 'chore: update alerts data [skip ci]'])
    if run(['git', 'push']):
        print('Pushed to GitHub successfully.')
    else:
        print('Push failed — check git credentials.', file=sys.stderr)

if __name__ == '__main__':
    print(f'Running at {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')

    existing = load_existing()
    print(f'Existing: {len(existing)} alerts')

    fresh = fetch_latest()
    merged = merge_and_trim(existing, fresh)

    dates = sorted(set(a.get('date', '') for a in merged if a.get('date')))
    print(f'After merge: {len(merged)} alerts | dates: {dates[0] if dates else "?"} – {dates[-1] if dates else "?"}')

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, separators=(',', ':'))

    git_push()
