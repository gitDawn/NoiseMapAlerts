"""
fetch_alerts.py
Fetches the last 3 days of Pikud HaOref alert history and pushes
alerts.json to GitHub. Run this script from your PC (Israeli IP).

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

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(REPO_DIR, 'alerts.json')

HEADERS = {
    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':          'https://www.oref.org.il/',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept':           'application/json, text/javascript, */*; q=0.01',
}

def fetch_alerts():
    # mode=1 returns the most recent ~3000 alerts across all dates.
    # Date params are ignored by the API; we deduplicate by rid.
    today = datetime.date.today()
    past = (today - datetime.timedelta(days=5)).strftime('%d.%m.%Y')
    url = (
        'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx'
        f'?lang=he&fromDate={past}&toDate={today.strftime("%d.%m.%Y")}&mode=1'
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.ok:
            data = r.json()
            if isinstance(data, list):
                # Deduplicate by rid
                seen = set()
                alerts = []
                for a in data:
                    rid = a.get('rid')
                    if rid not in seen:
                        seen.add(rid)
                        alerts.append(a)
                dates = sorted(set(a.get('date','') for a in alerts))
                print(f'Got {len(alerts)} unique alerts spanning: {dates[0]} – {dates[-1]}' if dates else 'No data')
                return alerts
        print(f'HTTP {r.status_code}', file=sys.stderr)
    except Exception as e:
        print(f'Error — {e}', file=sys.stderr)
    return []

def git_push():
    def run(cmd):
        result = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True)
        if result.returncode != 0:
            print(f'  git: {result.stderr.strip()}', file=sys.stderr)
        return result.returncode == 0

    run(['git', 'add', 'alerts.json'])
    # Check if there's anything staged
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
    print(f'Fetching alerts at {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    alerts = fetch_alerts()
    print(f'Total: {len(alerts)} alerts')

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(alerts, f, ensure_ascii=False, separators=(',', ':'))

    git_push()
