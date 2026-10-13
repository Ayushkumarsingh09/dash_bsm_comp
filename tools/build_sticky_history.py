"""Combine the sticky-delta workbook with the SNP chains.

The workbook is the 60-day surface. Its delta rows are sticky-delta quotes.
Its fixed-strike rows are the same maturity on listed offsets. Premiums match
BSM at r = q = 0, and delta is the forward delta N(d1), so this book prices
with zero rates and a forward equal to the underlying.

Where a parquet exists, the two contracts named in the workbook are blended
in total variance onto the strikes they list. That fills the smile between
the workbook nodes. A workbook strike outside that chain is kept. A
sticky-delta node is never written onto the strike curve, because that IV
belongs to the delta quote, not to the listed strike.
"""
import json
import math
import os
from collections import defaultdict

import numpy as np
import openpyxl
import pyarrow.parquet as pq

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, 'sticky_delta_2026-10-12_2025-06-05.xlsx')
DATA = os.path.join(ROOT, 'SNP data')
OUT = os.path.join(ROOT, 'data', 'sticky-60d.json')
TARGET = 60


def k_grid():
    ks = []
    k = -0.30
    while k <= 0.22 + 1e-9:
        ks.append(round(k, 4))
        k += 0.02
    return ks


KS = k_grid()


def as_date(value):
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    return str(value)[:10]


def usable(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and 0.02 < value < 2.5


def otm_points(frame, spot):
    pts = []
    for strike, group in frame.groupby('strike'):
        call_iv = float(np.nanmedian(group['call_iv'].to_numpy(dtype=float)))
        put_iv = float(np.nanmedian(group['put_iv'].to_numpy(dtype=float)))
        if strike < spot:
            iv = put_iv if usable(put_iv) else call_iv
        elif strike > spot:
            iv = call_iv if usable(call_iv) else put_iv
        else:
            vals = [v for v in (call_iv, put_iv) if usable(v)]
            iv = sum(vals) / len(vals) if vals else float('nan')
        if usable(iv) and strike > 0 and spot > 0:
            pts.append((math.log(float(strike) / spot), float(iv), float(strike)))
    pts.sort()
    return pts


def iv_at(pts, k, tenor_t):
    if len(pts) < 4 or k < pts[0][0] - 1e-8 or k > pts[-1][0] + 1e-8:
        return None
    i = 1
    while i < len(pts) - 1 and pts[i][0] < k:
        i += 1
    a, b = pts[i - 1], pts[i]
    span = b[0] - a[0]
    if span < 1e-12:
        return a[1]
    w = a[1] * a[1] * tenor_t + (k - a[0]) / span * (b[1] * b[1] * tenor_t - a[1] * a[1] * tenor_t)
    if w <= 0:
        return None
    return math.sqrt(w / tenor_t)


def variance_blend(iv1, t1, iv2, t2, t):
    w = iv1 * iv1 * t1 + (t - t1) / (t2 - t1) * (iv2 * iv2 * t2 - iv1 * iv1 * t1)
    if w <= 0 or t <= 0:
        return None
    return math.sqrt(w / t)


def load_chain(date, spot):
    path = os.path.join(DATA, date + '.parquet')
    if not os.path.exists(path):
        return None
    frame = pq.read_table(path, columns=['contract', 'time', 'dte', 'underlying', 'strike', 'call_iv', 'put_iv']).to_pandas()
    if frame.empty:
        return None
    times = []
    for stamp in frame['time'].dropna().unique():
        text = str(stamp)[:19]
        times.append((text, stamp))
    times.sort()
    chosen = times[-1][1]
    for text, stamp in times:
        if text.endswith('16:00:00'):
            chosen = stamp
            break
    frame = frame[frame['time'] == chosen]
    frame = frame[np.isclose(frame['underlying'].to_numpy(dtype=float), spot, rtol=0, atol=0.2)]
    return frame


def chain_legs(frame, low_name, low_dte, high_name, high_dte, spot):
    def one(name, dte):
        sub = frame[(frame['contract'].astype(str) == str(name)) & (frame['dte'] == int(dte))]
        pts = otm_points(sub, spot)
        if len(pts) < 8:
            return None
        return {'T': int(dte) / 365.0, 'pts': pts, 'dte': int(dte)}
    low = one(low_name, low_dte)
    if low is None:
        return None
    if int(low_dte) == int(high_dte):
        return [low]
    high = one(high_name, high_dte)
    if high is None:
        return None
    return [low, high]


def blend_strike(legs, strike, spot, target_t):
    if len(legs) == 1:
        return iv_at(legs[0]['pts'], math.log(strike / spot), legs[0]['T']), False
    k1 = math.log(strike / spot)
    iv1 = iv_at(legs[0]['pts'], k1, legs[0]['T'])
    iv2 = iv_at(legs[1]['pts'], k1, legs[1]['T'])
    if iv1 is None or iv2 is None:
        return (iv1 if iv1 is not None else iv2), True
    w1 = iv1 * iv1 * legs[0]['T']
    w2 = iv2 * iv2 * legs[1]['T']
    broke = w2 + 1e-8 < w1
    return variance_blend(iv1, legs[0]['T'], iv2, legs[1]['T'], target_t), broke


def read_workbook():
    book = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    sheet = book['Smile']
    days = defaultdict(list)
    for i, row in enumerate(sheet.iter_rows(values_only=True)):
        if i == 0:
            continue
        days[as_date(row[0])].append(row)
    return days


def session_from(date, rows, chain):
    spot = float(rows[0][1])
    forward = float(rows[0][2])
    low_dte = int(rows[0][6])
    high_dte = int(rows[0][9])
    low_name = rows[0][4]
    high_name = rows[0][7]
    by_label = {row[10]: row for row in rows}
    atm = by_label.get('ATM')
    if atm is None or not usable(atm[13]):
        return None, 'no ATM quote'
    quotes = []
    for row in rows:
        for strike, iv in ((row[12], row[13]), (row[19], row[20])):
            if usable(iv) and isinstance(strike, (int, float)) and strike > 0:
                quotes.append((float(strike), float(iv), row[10]))
    marks = []
    for delta in (0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45):
        n = int(round(delta * 100))
        call = by_label.get(str(n) + ' delta call')
        put = by_label.get(str(n) + ' delta put')
        if call is None or put is None:
            continue
        if not (usable(call[13]) and usable(put[13])):
            continue
        iv_l, iv_c, iv_u = float(put[13]), float(atm[13]), float(call[13])
        marks.append({
            'delta': delta,
            'Kl': round(float(put[12]), 4),
            'Kc': round(float(atm[12]), 4),
            'Ku': round(float(call[12]), 4),
            'ivL': round(iv_l, 6),
            'ivC': round(iv_c, 6),
            'ivU': round(iv_u, 6),
            'bf': round(0.5 * (iv_l + iv_u) - iv_c, 6),
            'rr': round(iv_u - iv_l, 6)
        })
    target_t = TARGET / 365.0
    legs = chain_legs(chain, low_name, low_dte, high_name, high_dte, spot) if chain is not None else None
    curve = []
    breaks = 0
    if legs:
        strikes = sorted(set(pt[2] for leg in legs for pt in leg['pts']))
        for strike in strikes:
            iv, broke = blend_strike(legs, strike, spot, target_t)
            if broke:
                breaks += 1
            if iv is not None and usable(iv):
                curve.append((math.log(strike / spot), iv, 0))
    if not curve:
        for strike, iv, label in quotes:
            if 'delta' in str(label):
                continue
            curve.append((math.log(strike / spot), iv, 1))
    curve.sort()
    hull_lo = curve[0][0] if curve else None
    hull_hi = curve[-1][0] if curve else None
    for strike, iv, label in quotes:
        k = math.log(strike / spot)
        covered = hull_lo is not None and hull_lo - 1e-4 <= k <= hull_hi + 1e-4
        # Sticky-delta IVs are a delta quote. They fill only a wing the chain does not list.
        if 'delta' in str(label):
            if not covered:
                curve.append((k, iv, 1))
            continue
        if not covered:
            curve.append((k, iv, 0 if legs else 1))
    curve.sort()
    # Drop duplicates after the sort, keeping the first (chain before a later wing).
    merged = []
    for k, iv, stale in curve:
        if merged and abs(k - merged[-1][0]) < 1e-4:
            continue
        merged.append((k, iv, stale))
    if len(merged) < 6:
        return None, 'smile too short'
    ivs = []
    stale = []
    for k in KS:
        if k < merged[0][0] - 1e-8 or k > merged[-1][0] + 1e-8:
            ivs.append(None)
            stale.append(1)
            continue
        i = 1
        while i < len(merged) - 1 and merged[i][0] < k:
            i += 1
        a, b = merged[i - 1], merged[i]
        span = b[0] - a[0]
        if span < 1e-12:
            ivs.append(round(a[1], 6))
            stale.append(a[2])
            continue
        w = a[1] * a[1] * target_t + (k - a[0]) / span * (b[1] * b[1] * target_t - a[1] * a[1] * target_t)
        if w <= 0:
            ivs.append(None)
            stale.append(1)
        else:
            ivs.append(round(math.sqrt(w / target_t), 6))
            stale.append(1 if a[2] or b[2] else 0)
    if sum(v is not None for v in ivs) < 6:
        return None, 'grid empty'
    return {
        'date': date,
        'S': round(spot, 4),
        'r': 0.0,
        'q': 0.0,
        'iv': ivs,
        'stale': stale,
        'dteLo': low_dte,
        'dteHi': high_dte,
        'rateSource': 'workbook-zero',
        'calendarBreaks': int(breaks),
        'termSlope': 0.0,
        'wide': 1 if high_dte - low_dte > 40 else 0,
        'marks': marks,
        'forward': round(forward, 4),
        'snp': 1 if legs else 0
    }, None


def main():
    grouped = read_workbook()
    sessions = []
    skips = defaultdict(int)
    snp_n = 0
    for date in sorted(grouped):
        rows = grouped[date]
        spot = float(rows[0][1])
        chain = load_chain(date, spot)
        row, why = session_from(date, rows, chain)
        if row is None:
            skips[why] += 1
            continue
        snp_n += row.pop('snp')
        row.pop('forward', None)
        sessions.append(row)
    payload = {
        'family': 'sticky-delta',
        'targetDTE': TARGET,
        'kGrid': KS,
        'sessions': sessions,
        'skips': dict(skips),
        'label': 'STICKY DELTA plus SNP chains. Workbook delta quotes are the 10Δ and 25Δ marks. Listed strikes are the total-variance blend of the workbook\'s two contracts.',
        'ratesNote': 'Rates are zero. The workbook premium matches BSM at r = q = 0, and its delta is the forward delta. The SNP rate column is also zero, so parity is not used to invent a dividend.',
        'interpolation': 'Sticky-delta strikes and vols come from the workbook and are not rewritten. Between them, the named lower and upper SNP contracts are blended in total variance to 60 days. A workbook wing outside that chain is kept. The two books are not mixed into the synthetic study or the weekly-only SNP study.'
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, separators=(',', ':'))
    check = next(s for s in sessions if s['date'] == '2026-10-06')
    m25 = next(m for m in check['marks'] if m['delta'] == 0.25)
    print('sessions', len(sessions), sessions[0]['date'], sessions[-1]['date'], 'snpFilled', snp_n)
    print('skips', dict(skips))
    print('2026-10-06 25d bf', m25['bf'], 'rr', m25['rr'], 'ivC', m25['ivC'], 'S', check['S'], 'dte', check['dteLo'], check['dteHi'])
    zero = KS.index(0.0)
    print('2026-10-06 grid atm', check['iv'][zero], 'finite', sum(v is not None for v in check['iv']))
    last = sessions[-1]
    m25b = next(m for m in last['marks'] if m['delta'] == 0.25)
    print('last', last['date'], 'S', last['S'], 'grid atm', last['iv'][zero], '25 bf', m25b['bf'], 'marks', len(last['marks']))
    print('wrote', OUT, os.path.getsize(OUT))


if __name__ == '__main__':
    main()
