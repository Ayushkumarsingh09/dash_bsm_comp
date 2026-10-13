"""Build a constant 60-calendar-day SNP smile history from the local parquet chains.

The weekly OWSNP contracts are the only family used. Daily and monthly series
are not mixed in. Missing strikes inside a listed range are linear in total
variance. The two listed expiries around 60 days are blended in total variance.
The file's rate column is not a funding rate when it is identically zero;
r and q come from put-call parity on each expiry and are interpolated to 60 days.
"""
import json
import math
import os
from glob import glob

import numpy as np
import pyarrow.parquet as pq

ROOT = os.path.join(os.path.dirname(__file__), '..')
DATA = os.path.join(ROOT, 'SNP data')
OUT = os.path.join(ROOT, 'data', 'snp-60d.json')
TARGET = 60
FAMILY = 'OWSNP'
COLS = ['contract', 'time', 'strike', 'underlying', 'rate', 'call_price', 'put_price', 'call_iv', 'put_iv', 'dte']


def k_grid():
    ks = []
    k = -0.30
    while k <= 0.22 + 1e-9:
        ks.append(round(k, 4))
        k += 0.02
    return ks


KS = k_grid()


def variance_blend(iv1, t1, iv2, t2, t):
    w1 = iv1 * iv1 * t1
    w2 = iv2 * iv2 * t2
    w = w1 + (t - t1) / (t2 - t1) * (w2 - w1)
    if w <= 0 or t <= 0:
        return None
    return math.sqrt(w / t)


def assert_blend():
    t1, t2, t = 45 / 365, 75 / 365, 60 / 365
    flat = variance_blend(0.20, t1, 0.20, t2, t)
    sloped = variance_blend(0.20, t1, 0.25, t2, t)
    if abs(flat - 0.20) > 1e-12:
        raise SystemExit('flat variance blend failed')
    if abs(sloped - 0.232513441) > 1e-6:
        raise SystemExit('sloped variance blend failed: ' + str(sloped))


def snapshot(df):
    times = df['time'].dropna().unique()
    if len(times) == 0:
        return df.iloc[0:0]
    # Prefer the 16:00 print. Otherwise the last print of the session.
    labels = []
    for t in times:
        text = str(t)[:19]
        labels.append((text, t))
    labels.sort()
    chosen = labels[-1][1]
    for text, t in labels:
        if text.endswith('16:00:00'):
            chosen = t
            break
    return df[df['time'] == chosen]


def parity(sub, spot, tenor_days):
    t = tenor_days / 365.0
    if not (spot > 0 and t > 0):
        return None
    m = (sub['strike'] / spot - 1.0).abs() < 0.03
    sl = sub.loc[m]
    if len(sl) < 6:
        return None
    y = (sl['call_price'] - sl['put_price']).to_numpy(dtype=float)
    x = sl['strike'].to_numpy(dtype=float)
    ok = np.isfinite(y) & np.isfinite(x) & (sl['call_price'].to_numpy(dtype=float) > 0.05) & (sl['put_price'].to_numpy(dtype=float) > 0.05)
    if ok.sum() < 6:
        return None
    a, b = np.linalg.lstsq(np.vstack([np.ones(ok.sum()), x[ok]]).T, y[ok], rcond=None)[0]
    if not (b < -0.5):
        return None
    df = -b
    if not (0.85 < df < 1.02):
        return None
    r = -math.log(df) / t
    if not (0.0 < r < 0.15) or not (a > 0):
        return None
    q = -math.log(a / spot) / t
    if not (-0.02 < q < 0.20):
        return None
    forward = -a / b
    return {'r': float(r), 'q': float(q), 'F': float(forward), 'T': t}


def otm_points(sub, forward):
    pts = []
    for strike, g in sub.groupby('strike'):
        civ = float(np.nanmedian(g['call_iv'].to_numpy(dtype=float)))
        piv = float(np.nanmedian(g['put_iv'].to_numpy(dtype=float)))

        def usable(v):
            return math.isfinite(v) and 0.02 < v < 2.5

        k_strike = float(strike)
        if k_strike < forward * 0.998:
            iv = piv if usable(piv) else (civ if usable(civ) else float('nan'))
        elif k_strike > forward * 1.002:
            iv = civ if usable(civ) else (piv if usable(piv) else float('nan'))
        else:
            vals = [v for v in (civ, piv) if usable(v)]
            iv = float(sum(vals) / len(vals)) if vals else float('nan')
        if usable(iv) and k_strike > 0 and forward > 0:
            pts.append((math.log(k_strike / forward), iv))
    pts.sort()
    merged = []
    for k, iv in pts:
        if merged and abs(k - merged[-1][0]) < 1e-6:
            w = 0.5 * (merged[-1][1] ** 2 + iv ** 2)
            merged[-1] = (merged[-1][0], math.sqrt(w))
        else:
            merged.append((k, iv))
    return merged


def iv_on_grid(pts, k, tenor_t):
    if len(pts) < 4 or k < pts[0][0] - 1e-8 or k > pts[-1][0] + 1e-8:
        return None, False
    i = 1
    while i < len(pts) - 1 and pts[i][0] < k:
        i += 1
    a, b = pts[i - 1], pts[i]
    span = b[0] - a[0]
    if span < 1e-12:
        return a[1], False
    wa = a[1] * a[1] * tenor_t
    wb = b[1] * b[1] * tenor_t
    w = wa + (k - a[0]) / span * (wb - wa)
    if w <= 0:
        return None, True
    return math.sqrt(w / tenor_t), span > 0.04


def build_leg(weekly, dte, spot=None):
    sub = weekly[weekly['dte'] == dte]
    if spot is not None:
        sub = sub[np.isclose(sub['underlying'].to_numpy(dtype=float), spot)]
    if sub.empty:
        return None
    counts = sub['contract'].value_counts()
    sub = sub[sub['contract'] == counts.index[0]]
    if spot is None:
        spot = float(sub['underlying'].mode().iloc[0])
        sub = sub[np.isclose(sub['underlying'].to_numpy(dtype=float), spot)]
    px = parity(sub, spot, dte)
    if px is None:
        return None
    pts = otm_points(sub, px['F'])
    if len(pts) < 8:
        return None
    return {'dte': dte, 'spot': float(spot), 'px': px, 'pts': pts}


def session_from(df):
    weekly = df[df['contract'].astype(str).str.startswith(FAMILY)]
    if weekly.empty:
        return None, 'no weekly chain'
    dtes = sorted(int(d) for d in weekly['dte'].unique() if int(d) >= 7)
    below = [d for d in dtes if d <= TARGET]
    above = [d for d in dtes if d >= TARGET]
    if not below or not above:
        return None, 'no expiry on both sides of 60 days'
    lo, hi = max(below), min(above)
    tenors = (lo,) if lo == hi else (lo, hi)
    built = []
    for dte in tenors:
        leg = build_leg(weekly, dte)
        if leg is None:
            return None, 'expiry could not be priced'
        built.append(leg)
    if len(built) == 2 and abs(built[0]['spot'] - built[1]['spot']) > 1.0:
        nearer = min(built, key=lambda row: abs(row['dte'] - TARGET))
        built = []
        for dte in tenors:
            leg = build_leg(weekly, dte, nearer['spot'])
            if leg is None:
                return None, 'expiries do not share an underlying'
            built.append(leg)
    spot = min(built, key=lambda row: abs(row['dte'] - TARGET))['spot']
    t_target = TARGET / 365.0
    if len(built) == 1:
        r, q = built[0]['px']['r'], built[0]['px']['q']
        rate_source = 'parity'
    else:
        a = (t_target - built[0]['px']['T']) / (built[1]['px']['T'] - built[0]['px']['T'])
        r = built[0]['px']['r'] + a * (built[1]['px']['r'] - built[0]['px']['r'])
        q = built[0]['px']['q'] + a * (built[1]['px']['q'] - built[0]['px']['q'])
        rate_source = 'parity'
    iv = []
    stale = []
    breaks = 0
    for k in KS:
        legs = []
        hole = False
        for row in built:
            got, wide = iv_on_grid(row['pts'], k, row['px']['T'])
            legs.append((got, row['px']['T'], wide))
            hole = hole or wide
        if len(legs) == 1:
            value, single = legs[0][0], 1 if legs[0][0] is not None else 0
        else:
            g1, t1, _ = legs[0]
            g2, t2, _ = legs[1]
            if g1 is not None and g2 is not None:
                w1 = g1 * g1 * t1
                w2 = g2 * g2 * t2
                if w2 + 1e-8 < w1:
                    breaks += 1
                value = variance_blend(g1, t1, g2, t2, t_target)
                single = 0
            elif g1 is not None or g2 is not None:
                value = g1 if g1 is not None else g2
                single = 1
            else:
                value, single = None, 0
        if value is None or not (0.02 < value < 2.5):
            iv.append(None)
            stale.append(1)
        else:
            iv.append(round(value, 6))
            stale.append(1 if single or hole else 0)
    finite = sum(v is not None for v in iv)
    if finite < 6:
        return None, 'smile grid empty'
    # Term slope of ATM variance level, used only if the quote grid is later turned off.
    def atm_of(row):
        got, _ = iv_on_grid(row['pts'], 0.0, row['px']['T'])
        return got
    if len(built) == 2:
        a0, a1 = atm_of(built[0]), atm_of(built[1])
        slope = (a1 - a0) / (built[1]['px']['T'] - built[0]['px']['T']) if a0 and a1 else 0.0
    else:
        slope = 0.0
    return {
        'date': None,
        'S': round(spot, 4),
        'r': round(r, 6),
        'q': round(q, 6),
        'iv': iv,
        'stale': stale,
        'dteLo': int(built[0]['dte']),
        'dteHi': int(built[-1]['dte']),
        'rateSource': rate_source,
        'calendarBreaks': int(breaks),
        'termSlope': round(float(slope), 6),
        'wide': 1 if built[-1]['dte'] - built[0]['dte'] > 40 else 0
    }, None


def main():
    assert_blend()
    files = sorted(glob(os.path.join(DATA, '*.parquet')))
    sessions = []
    skips = {}
    rate_max = 0.0
    for path in files:
        date = os.path.basename(path)[:10]
        table = pq.read_table(path, columns=COLS)
        df = table.to_pandas()
        if len(df):
            rate_max = max(rate_max, float(np.nanmax(df['rate'].to_numpy(dtype=float))))
        df = snapshot(df)
        row, why = session_from(df)
        if row is None:
            skips[why] = skips.get(why, 0) + 1
            continue
        row['date'] = date
        sessions.append(row)
    sessions.sort(key=lambda s: s['date'])
    # One row per session.
    dedup = []
    for row in sessions:
        if dedup and dedup[-1]['date'] == row['date']:
            dedup[-1] = row
        else:
            dedup.append(row)
    payload = {
        'family': FAMILY,
        'targetDTE': TARGET,
        'kGrid': KS,
        'rateColumnMax': rate_max,
        'sessions': dedup,
        'skips': skips,
        'label': 'REAL listed SNP weeklies (OWSNP). Constant 60 DTE. Separate from the synthetic study.',
        'ratesNote': 'The rate column is 0 on every row, so it is not used. r and q are implied by put-call parity on each listed expiry and interpolated in time to 60 days.',
        'interpolation': 'OTM implied vol, put below the forward and call above, on log-moneyness. Missing strikes inside the quoted range are linear in total variance. The listed expiries on either side of 60 calendar days are blended in total variance. A wing outside both ranges is left blank. A point covered by only one expiry keeps that expiry and is marked stale.'
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, separators=(',', ':'))
    covered = []
    atms = []
    gaps = []
    for row in dedup:
        covered.append(sum(v is not None for v in row['iv']))
        atms.append(row['iv'][KS.index(0.0)] or float('nan'))
        gaps.append(row['dteHi'] - row['dteLo'])
    print('sessions', len(dedup), 'from', dedup[0]['date'], 'to', dedup[-1]['date'])
    print('skips', skips)
    print('rateColumnMax', rate_max)
    print('covered median/min', float(np.median(covered)), min(covered), 'of', len(KS))
    print('atm median/min/max', float(np.nanmedian(atms)), float(np.nanmin(atms)), float(np.nanmax(atms)))
    print('tenor gap median/max', float(np.median(gaps)), max(gaps))
    print('r q last', dedup[-1]['r'], dedup[-1]['q'], 'S', dedup[-1]['S'], 'dte', dedup[-1]['dteLo'], dedup[-1]['dteHi'])
    print('wrote', OUT, os.path.getsize(OUT))


if __name__ == '__main__':
    main()
