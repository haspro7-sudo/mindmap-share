"""Machine-learning "fast judgment" scalping test: can LightGBM / logistic regression / a small
neural net predict minute-level moves well enough to beat Titan FX Blade costs, and does a
probability threshold raise the win rate AND the expectancy?

    python scripts/scalp_ml_models.py                 # final: OOS once + stress + report
    python scripts/scalp_ml_models.py --stage features  # build the feature/label cache
    python scripts/scalp_ml_models.py --stage check     # labeler == scalp.simulate check
    python scripts/scalp_ml_models.py --stage is        # inner walk-forward 2011-2014 (IS)
    python scripts/scalp_ml_models.py --stage isrules   # IS trading rules -> trial log
    python scripts/scalp_ml_models.py --report          # rewrite the report from saved results

Pipeline (every step uses only data up to the signal bar's close):
  data      OANDA M1 mid bars of 6 raw pairs (EURUSD GBPUSD EURJPY AUDUSD USDCAD AUDJPY).
  decisions every minute, server 09:00-21:59 (NY+7h; = JST 15:00/16:00 - 04:00/05:00),
            Monday-Friday.  Training uses every 5th minute (adjacent minutes are nearly
            duplicate samples); predictions and trading use every minute.
  features  ~45 trailing features: vol-normalised returns 1..240 min, realised-vol ratios,
            bar range/body/wicks, tick-volume z-scores, position in the trailing 15/60/240/1440
            bar high-low range and in the previous server day's range, distance to 00/50 round
            numbers, server/London/Tokyo minute of day, weekday, a reference pair's returns
            (EURUSD for EURJPY etc.) and the pair's move relative to it, pair id.
  labels    the actual scalp.simulate outcome of a long and of a short trade entered at the next
            bar open with TP = SL = X pips and a time stop of h minutes, X = k * sigma_1m * sqrt(h)
            (sigma_1m = trailing 60-bar std of 1-minute close changes), clipped to 1..40 pips.
            class 1 = the long nets > 0 after costs, 2 = the short nets > 0, 0 = neither.
            Horizons h = 5 and 30 minutes, k = 1 and 2 (4 label sets).  Also the sign of the
            forward h-minute mid return (for direction AUC / accuracy).
  models    LightGBM (small / large), multinomial logistic regression, sklearn MLP (64-32).
  walk-fwd  retrain every year on the trailing 6 years (1-day embargo).  Inner walk-forward
            INSIDE 2005-2014: validation years 2011-2014 (trained on 2005-10 .. 2008-13) choose
            label set, model and threshold margin.  OOS 2015-2020.05 (trained on 2009-14 ..
            2014-19) is run once for the final candidates.
  rule      side = argmax(p_long, p_short); trade when that probability >= the cost-implied
            breakeven win rate of that pair/side (avg loss / (avg win + avg loss), from the
            training labels) + margin; one position per pair at a time (scalp.simulate).
"""
from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "2")

import argparse  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

import numba as nb  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab import data as D  # noqa: E402
from fxlab import scalp  # noqa: E402
from fxlab.instruments import INSTRUMENTS  # noqa: E402
from fxlab.research import TrialLog  # noqa: E402

FAMILY = "scalp_ml_models"
KEY = "ml_models"
LOG = TrialLog(FAMILY)
OUT_DIR = ROOT / "reports" / "scalping"
REPORT = OUT_DIR / f"{KEY}.md"
CACHE = Path(os.environ.get("FXLAB_ML_CACHE", str(D.M1_DIR.parent / "ml_cache" / KEY)))
FEAT_DIR = CACHE / "features"
PRED_DIR = CACHE / "preds"
RES_DIR = CACHE / "results"

IS_START = pd.Timestamp("2005-01-01")
IS_END = scalp.IS_END                                  # 2015-01-01
OOS_END = pd.Timestamp("2020-05-15")
YEARS = list(range(2005, 2021))
IS_VAL_YEARS = [2011, 2012, 2013, 2014]
OOS_YEARS = [2015, 2016, 2017, 2018, 2019, 2020]
TRAIN_YEARS = 6
TRAIN_STEP = 5                                         # training rows: server minute % 5 == 0

PAIRS = ["EURUSD", "GBPUSD", "EURJPY", "AUDUSD", "USDCAD", "AUDJPY"]
PAIR_ID = {s: i for i, s in enumerate(PAIRS)}
# reference pair for cross features and its orientation (+1 = usually moves the same way)
REF = {"EURUSD": ("GBPUSD", 1), "GBPUSD": ("EURUSD", 1), "EURJPY": ("EURUSD", 1),
       "AUDUSD": ("EURUSD", 1), "USDCAD": ("EURUSD", -1), "AUDJPY": ("AUDUSD", 1)}
HOURS = list(range(9, 22))                             # server 09:00-21:59, spread mult = 1.0
LABELS = {"h5k1": (5, 1.0), "h5k2": (5, 2.0), "h30k1": (30, 1.0), "h30k2": (30, 2.0)}
X_CLIP = (1.0, 40.0)
FWD = [5, 30]
MAX_DELAY_MIN = 5.0

RET_K = [1, 2, 5, 15, 30, 60, 240]
FEATS = ([f"r{k}" for k in RET_K] +
         ["vr15_60", "vr60_240", "vr240_1440", "lvol60", "rng1", "rng5", "body1", "uwick1",
          "lwick1", "vz", "v5r", "v60r", "pos15", "pos60", "pos240", "pos1440", "posPD",
          "w60", "w240", "dev60", "dev240", "rn100", "d100", "d50", "span240",
          "x1", "x5", "x15", "x60", "rel5", "rel15", "rel60",
          "tod", "tod_lon", "tod_jst", "dow", "pair_id"])
TIME_FEATS = ["tod", "tod_lon", "tod_jst", "dow", "pair_id"]
CONT_FEATS = [c for c in FEATS if c not in TIME_FEATS]


# ============================================================================ labels
@nb.njit(cache=True)
def _barrier_gross(t, o, h, l, hs, rows, X, d, hold_ns, slip, stop_slip, max_delay_ns, pip):
    """Gross pips of one isolated trade per row, entered at the open of bar rows[r]+1 with
    TP = SL = X[r] (price units).  Line-for-line the fxlab.scalp._kernel logic (bid/ask,
    gap fills, SL before TP inside a bar, time stop at the first bar at/after entry+hold)
    without the one-position-at-a-time constraint.  NaN = no entry (next bar too late)."""
    n = o.shape[0]
    out = np.full(rows.shape[0], np.nan)
    for r in range(rows.shape[0]):
        b = rows[r]
        i = b + 1
        if i >= n or t[i] - t[b] > max_delay_ns:
            continue
        x = X[r]
        if not (x > 0):
            continue
        if d > 0:
            ent = o[i] + hs[i] + slip
            tpx = ent + x
            slx = ent - x
        else:
            ent = o[i] - hs[i] - slip
            tpx = ent - x
            slx = ent + x
        t_end = t[i] + hold_ns
        j = i
        done = False
        xp = 0.0
        while j < n:
            if d > 0:
                qo, qh, ql = o[j] - hs[j], h[j] - hs[j], l[j] - hs[j]
            else:
                qo, qh, ql = o[j] + hs[j], h[j] + hs[j], l[j] + hs[j]
            if j > i:
                if (d > 0 and qo <= slx) or (d < 0 and qo >= slx):
                    xp = qo - stop_slip if d > 0 else qo + stop_slip
                    done = True
                elif (d > 0 and qo >= tpx) or (d < 0 and qo <= tpx):
                    xp = qo
                    done = True
                elif t[j] >= t_end:
                    xp = qo - slip if d > 0 else qo + slip
                    done = True
            if not done:
                if (d > 0 and ql <= slx) or (d < 0 and qh >= slx):
                    xp = slx - stop_slip if d > 0 else slx + stop_slip
                    done = True
                elif (d > 0 and qh >= tpx) or (d < 0 and ql <= tpx):
                    xp = tpx
                    done = True
            if done:
                break
            j += 1
        if not done:
            j = n - 1
            xp = (l[j] + h[j]) * 0.5 - d * hs[j]
        out[r] = d * (xp - ent) / pip
    return out


def barrier_net(m1: pd.DataFrame, sym: str, rows: np.ndarray, x_pips: np.ndarray, d: int,
                hold_min: float) -> np.ndarray:
    inst = INSTRUMENTS[sym]
    pip = inst.pip
    t = m1.index.as_unit("ns").asi8.astype(np.int64)
    hs = scalp.half_spread_series(m1.index, sym, 1.0)
    slip = inst.slip_pips * pip
    stop_slip = slip + inst.stop_slip_pips * pip
    g = _barrier_gross(t, m1["open"].to_numpy(float), m1["high"].to_numpy(float),
                       m1["low"].to_numpy(float), hs, rows.astype(np.int64),
                       x_pips.astype(float) * pip, int(d), int(hold_min * 60e9), slip,
                       stop_slip, int(MAX_DELAY_MIN * 60e9), pip)
    return g - scalp.commission_pips(sym)


# ============================================================================ features
def _roll(s: pd.Series, n: int, fn: str) -> pd.Series:
    return getattr(s.rolling(n, min_periods=n), fn)()


def _ratio(a, b) -> np.ndarray:
    a, b = np.asarray(a, float), np.asarray(b, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        r = a / b
    r[~np.isfinite(r)] = np.nan
    return r


def _ret_feats(m1: pd.DataFrame, pip: float, ks) -> tuple[pd.DataFrame, pd.Series]:
    c = m1["close"]
    sig = _roll(c.diff(), 60, "std").clip(lower=0.05 * pip)
    out = {f"r{k}": (c - c.shift(k)) / (sig * math.sqrt(k)) for k in ks}
    return pd.DataFrame(out, index=m1.index), sig


def decision_rows(idx: pd.DatetimeIndex) -> np.ndarray:
    return np.flatnonzero(np.isin(idx.hour, HOURS) & (idx.dayofweek < 5))


def build_pair(sym: str, require_label: bool = True) -> None:
    """Features + labels for every decision minute of one pair -> FEAT_DIR/<sym>/<year>.parquet"""
    t0 = time.time()
    inst = INSTRUMENTS[sym]
    pip = inst.pip
    m1 = scalp.load(sym)[["open", "high", "low", "close", "volume"]].astype("float64")
    idx = m1.index
    dec = decision_rows(idx)
    o, h, l, c, v = (m1[k] for k in ("open", "high", "low", "close", "volume"))

    def sel(x) -> np.ndarray:
        return np.asarray(x, dtype=float)[dec].astype(np.float32)

    F: dict[str, np.ndarray] = {}
    rets, sig = _ret_feats(m1, pip, RET_K)
    for k in RET_K:
        F[f"r{k}"] = sel(rets[f"r{k}"])
    del rets
    d1 = c.diff()
    vol = {n: _roll(d1, n, "std") for n in (15, 60, 240, 1440)}
    F["vr15_60"] = sel(_ratio(vol[15], vol[60]))
    F["vr60_240"] = sel(_ratio(vol[60], vol[240]))
    F["vr240_1440"] = sel(_ratio(vol[240], vol[1440]))
    F["lvol60"] = sel(np.log(sig / pip))
    warm = sel(vol[1440])                              # NaN until 1440 bars of history
    del vol
    rng = h - l
    F["rng1"] = sel(rng / sig)
    F["rng5"] = sel(_roll(rng, 5, "mean") / sig)
    F["body1"] = sel((c - o) / sig)
    F["uwick1"] = sel((h - np.maximum(o, c)) / sig)
    F["lwick1"] = sel((np.minimum(o, c) - l) / sig)
    vm60, vs60 = _roll(v, 60, "mean"), _roll(v, 60, "std")
    F["vz"] = sel(_ratio(v - vm60, vs60))
    F["v5r"] = sel(_ratio(_roll(v, 5, "mean"), vm60))
    F["v60r"] = sel(_ratio(vm60, _roll(v, 1440, "mean")))
    for n in (15, 60, 240, 1440):
        hh, ll = _roll(h, n, "max"), _roll(l, n, "min")
        F[f"pos{n}"] = sel(_ratio(c - ll, hh - ll))
        if n in (60, 240):
            F[f"w{n}"] = sel((hh - ll) / (sig * math.sqrt(n)))
    # previous completed server day (Mon-Fri days only; Monday uses Friday)
    day = idx.normalize()
    wk = idx.dayofweek < 5
    dd = pd.DataFrame({"h": h.to_numpy()[wk], "l": l.to_numpy()[wk]}, index=day[wk])
    daily = dd.groupby(level=0).agg({"h": "max", "l": "min"}).shift(1)
    pdh = daily["h"].reindex(day[dec]).to_numpy()
    pdl = daily["l"].reindex(day[dec]).to_numpy()
    F["posPD"] = _ratio(c.to_numpy()[dec] - pdl, pdh - pdl).astype(np.float32)
    for n in (60, 240):
        F[f"dev{n}"] = sel((c - _roll(c, n, "mean")) / sig)
    cp = c.to_numpy() / pip
    s_ = sig.to_numpy() / pip
    F["rn100"] = sel(np.mod(cp, 100.0) / 100.0)
    F["d100"] = sel(np.clip((cp - np.round(cp / 100.0) * 100.0) / s_, -50, 50))
    F["d50"] = sel(np.clip((cp - np.round(cp / 50.0) * 50.0) / s_, -50, 50))
    t_ns = idx.as_unit("ns").asi8
    span = np.full(len(idx), np.nan)
    span[240:] = (t_ns[240:] - t_ns[:-240]) / (240 * 60e9)
    F["span240"] = sel(span)

    # reference pair (own clock; forward-filled at most 5 minutes)
    ref, orient = REF[sym]
    r1 = scalp.load(ref)[["close"]].astype("float64")
    rr, _ = _ret_feats(r1, INSTRUMENTS[ref].pip, [1, 5, 15, 60])
    rr = rr.reindex(idx[dec], method="ffill", tolerance=pd.Timedelta("5min"))
    for k in (1, 5, 15, 60):
        F[f"x{k}"] = (orient * rr[f"r{k}"].to_numpy()).astype(np.float32)
    for k in (5, 15, 60):
        F[f"rel{k}"] = (F[f"r{k}"] - F[f"x{k}"]).astype(np.float32)
    del r1, rr

    di = idx[dec]
    F["tod"] = (di.hour * 60 + di.minute).to_numpy().astype(np.float32)
    lon, jst = scalp.local_time(di, "Europe/London"), scalp.local_time(di, "Asia/Tokyo")
    F["tod_lon"] = (lon.hour * 60 + lon.minute).to_numpy().astype(np.float32)
    F["tod_jst"] = (jst.hour * 60 + jst.minute).to_numpy().astype(np.float32)
    F["dow"] = di.dayofweek.to_numpy().astype(np.float32)
    F["pair_id"] = np.full(len(dec), PAIR_ID[sym], np.float32)

    # labels
    sigp = s_[dec]
    for key, (hold, k) in LABELS.items():
        x = np.clip(k * sigp * math.sqrt(hold), *X_CLIP)
        F[f"X_{key}"] = x.astype(np.float32)
        F[f"L_{key}"] = barrier_net(m1, sym, dec, x, +1, hold).astype(np.float32)
        F[f"S_{key}"] = barrier_net(m1, sym, dec, x, -1, hold).astype(np.float32)
    op = o.to_numpy()
    ent = dec + 1
    okent = ent < len(idx)
    ent_c = np.minimum(ent, len(idx) - 1)
    okent &= (t_ns[ent_c] - t_ns[dec]) <= MAX_DELAY_MIN * 60e9
    for hmin in FWD:
        j = np.searchsorted(t_ns, t_ns[ent_c] + int(hmin * 60e9), side="left")
        ok = okent & (j < len(idx))
        jj = np.minimum(j, len(idx) - 1)
        F[f"fwd{hmin}"] = np.where(ok, (op[jj] - op[ent_c]) / pip, np.nan).astype(np.float32)

    del m1, o, h, l, c, v, sig, d1
    keep = np.isfinite(warm)
    if require_label:
        keep &= np.isfinite(F["L_h5k1"])
    yr = di.year.to_numpy()
    out = FEAT_DIR / sym
    out.mkdir(parents=True, exist_ok=True)
    for y in np.unique(yr[keep]):
        m = keep & (yr == y)
        g = pd.DataFrame({"time": di[m], **{k: a[m] for k, a in F.items()}})
        g.to_parquet(out / f"{y}.parquet", compression="zstd")
    print(f"  features {sym}: {int(keep.sum()):,} rows, {time.time() - t0:.0f}s", flush=True)


def stage_features(force: bool = False) -> None:
    for s in PAIRS:
        if not force and (FEAT_DIR / s / "2020.parquet").exists():
            continue
        build_pair(s)


def load_rows(pairs, years, step: int = 1, cols=None) -> pd.DataFrame:
    frames = []
    for s in pairs:
        for y in years:
            p = FEAT_DIR / s / f"{y}.parquet"
            if not p.exists():
                continue
            df = pd.read_parquet(p, columns=cols)
            if step > 1:
                df = df[(df["tod"].to_numpy() % step) == 0]
            frames.append(df)
    return pd.concat(frames, ignore_index=True)


def stage_check(n_days: int = 400, seed: int = 3) -> dict:
    """The labeler must reproduce scalp.simulate exactly: one random decision minute per day
    (so trades never overlap) for every pair and label set."""
    rng = np.random.default_rng(seed)
    out = {}
    for sym in PAIRS:
        m1 = scalp.load(sym, start="2012-01-01", end="2013-01-01")[["open", "high", "low", "close"]]
        dec = decision_rows(m1.index)
        days = m1.index[dec].normalize()
        first = pd.Series(dec).groupby(days).apply(lambda s: s.iloc[rng.integers(len(s))])
        rows = np.sort(first.to_numpy())[:n_days]
        rows = rows[rows < len(m1) - 1]
        for key, (hold, k) in LABELS.items():
            x = rng.uniform(2, 15, len(rows)).round(1)
            for d in (1, -1):
                mine = barrier_net(m1, sym, rows, x, d, hold)
                sig = pd.DataFrame({"dir": d, "tp": x, "sl": x, "hold": float(hold)},
                                   index=m1.index[rows])
                tr = scalp.simulate(m1, sig, sym)
                ok = np.isfinite(mine)
                ent = m1.index.get_indexer(tr.entry_time) - 1
                ref = pd.Series(tr.net_pips.to_numpy(), index=ent).reindex(rows[ok]).to_numpy()
                err = float(np.nanmax(np.abs(ref - mine[ok])))
                out[f"{sym}_{key}_{d:+d}"] = (int(ok.sum()), int(len(tr)), err)
                assert len(tr) == ok.sum() and err < 1e-9, (sym, key, d, err, len(tr), ok.sum())
        print(f"  check {sym}: ok", flush=True)
    return out



def stage_leakcheck(times=("2008-03-12 10:17", "2012-09-06 14:03", "2016-11-09 21:41"),
                    pairs=("EURUSD", "EURJPY")) -> dict:
    """No look-ahead: rebuild the features from data that END at the signal bar (future bars
    of both the pair and its reference pair removed) and require them to equal the cached
    features of that bar."""
    import tempfile
    global FEAT_DIR
    orig_load, orig_dir = scalp.load, FEAT_DIR
    out = {}
    try:
        for sym in pairs:
            for ts in times:
                t = pd.Timestamp(ts)
                cached = pd.read_parquet(orig_dir / sym / f"{t.year}.parquet")
                row = cached[cached["time"] == t]
                if not len(row):
                    continue

                def cut(s, start=None, end=None, _t=t):
                    return orig_load(s, start=_t - pd.Timedelta(days=5), end=_t + pd.Timedelta(minutes=1))

                with tempfile.TemporaryDirectory() as tmp:
                    scalp.load = cut
                    FEAT_DIR = Path(tmp)
                    build_pair_features_only(sym)
                    new = pd.read_parquet(Path(tmp) / sym / f"{t.year}.parquet")
                new = new[new["time"] == t]
                a = row[FEATS].to_numpy(float)[0]
                b = new[FEATS].to_numpy(float)[0]
                same = np.isclose(a, b, rtol=1e-5, atol=1e-5) | (np.isnan(a) & np.isnan(b))
                bad = [c for c, ok in zip(FEATS, same) if not ok]
                out[f"{sym} {ts}"] = bad
                assert not bad, (sym, ts, bad)
    finally:
        scalp.load, FEAT_DIR = orig_load, orig_dir
    print("  look-ahead check: features identical with future data removed", out)
    return out


def build_pair_features_only(sym: str) -> None:
    """build_pair for the look-ahead check: identical feature code; labels need the future,
    so rows are kept even when the label is missing (5 days of history are enough for every
    trailing window, which is at most 1440 bars)."""
    global LABELS
    keep_labels = LABELS
    try:
        LABELS = {}
        build_pair(sym, require_label=False)
    finally:
        LABELS = keep_labels

# ============================================================================ models
MODELS = {
    "lgb_s": dict(kind="lgb", num_leaves=15, n_estimators=200, learning_rate=0.05,
                  min_child_samples=2000),
    "lgb_l": dict(kind="lgb", num_leaves=63, n_estimators=400, learning_rate=0.03,
                  min_child_samples=500),
    "logit": dict(kind="lr", C=1.0),
    "mlp": dict(kind="mlp", hidden=(64, 32), alpha=1e-3, max_rows=400_000),
}
MODEL_JA = {"lgb_s": "LightGBM 小（15葉×200本）", "lgb_l": "LightGBM 大（63葉×400本）",
            "logit": "ロジスティック回帰", "mlp": "ニューラルネット MLP(64-32)"}
LABEL_JA = {"h5k1": "5分・TP=SL=1σ", "h5k2": "5分・TP=SL=2σ",
            "h30k1": "30分・TP=SL=1σ", "h30k2": "30分・TP=SL=2σ"}


def classes(df: pd.DataFrame, key: str) -> np.ndarray:
    L, S = df[f"L_{key}"].to_numpy(), df[f"S_{key}"].to_numpy()
    y = np.zeros(len(df), np.int8)
    y[(L > 0) & (L >= S)] = 1
    y[(S > 0) & (S > L)] = 2
    return y


class LinPrep:
    """Winsorise (0.5/99.5% of the training fold), impute the median, standardise, clip +-5;
    cyclic time of day, one-hot weekday and pair.  Fitted on the training fold only.
    Column by column in float32 to keep memory low."""

    def fit(self, df: pd.DataFrame):
        st = []
        for c in CONT_FEATS:
            x = df[c].to_numpy(np.float64)
            lo, hi = np.nanpercentile(x, [0.5, 99.5])
            x = np.clip(x, lo, hi)
            med = np.nanmedian(x)
            x = np.where(np.isnan(x), med, x)
            st.append((lo, hi, med, x.mean(), x.std() + 1e-9))
        self.stats = st
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        nc = len(CONT_FEATS)
        out = np.empty((len(df), nc + 6 + 5 + len(PAIRS)), np.float32)
        for j, (c, (lo, hi, med, mu, sd)) in enumerate(zip(CONT_FEATS, self.stats)):
            x = np.clip(df[c].to_numpy(np.float64), lo, hi)
            x = np.where(np.isnan(x), med, x)
            out[:, j] = np.clip((x - mu) / sd, -5, 5)
        j = nc
        for c in ("tod", "tod_lon", "tod_jst"):
            a = 2 * np.pi * np.nan_to_num(df[c].to_numpy(np.float64)) / 1440.0
            out[:, j], out[:, j + 1] = np.sin(a), np.cos(a)
            j += 2
        dw = df["dow"].to_numpy()
        for k in range(5):
            out[:, j] = dw == k
            j += 1
        pid = df["pair_id"].to_numpy()
        for k in range(len(PAIRS)):
            out[:, j] = pid == k
            j += 1
        return out


def fit_predict(mkey: str, tr: pd.DataFrame, y: np.ndarray, te: pd.DataFrame, seed: int = 0):
    """-> (P[n_test, 3] class probabilities (0 none, 1 long wins, 2 short wins), info)"""
    spec = dict(MODELS[mkey])
    kind = spec.pop("kind")
    info: dict = {}
    if kind == "lgb":
        import lightgbm as lgb
        m = lgb.LGBMClassifier(objective="multiclass", n_jobs=2, subsample=0.5, subsample_freq=1,
                               colsample_bytree=0.7, reg_lambda=1.0, verbose=-1,
                               random_state=seed, **spec)
        m.fit(tr[FEATS], y, categorical_feature=["pair_id"])
        P = m.predict_proba(te[FEATS])
        gain = m.booster_.feature_importance("gain")
        info["importance"] = dict(zip(FEATS, (gain / gain.sum()).round(6).tolist()))
    elif kind == "lr":
        from sklearn.linear_model import LogisticRegression
        prep = LinPrep().fit(tr)
        m = LogisticRegression(C=spec["C"], max_iter=300)
        m.fit(prep.transform(tr), y)
        P = m.predict_proba(prep.transform(te))
        info["n_iter"] = int(np.max(m.n_iter_))
    elif kind == "mlp":
        from sklearn.neural_network import MLPClassifier
        rng = np.random.default_rng(seed)
        sub = np.sort(rng.choice(len(tr), size=min(len(tr), spec["max_rows"]), replace=False))
        trs = tr.iloc[sub]
        prep = LinPrep().fit(trs)
        m = MLPClassifier(hidden_layer_sizes=spec["hidden"], alpha=spec["alpha"],
                          batch_size=2048, learning_rate_init=1e-3, max_iter=40,
                          early_stopping=True, validation_fraction=0.1, n_iter_no_change=5,
                          random_state=seed)
        m.fit(prep.transform(trs), y[sub])
        P = m.predict_proba(prep.transform(te))
        info["n_iter"] = int(m.n_iter_)
    else:
        raise ValueError(kind)
    cls = list(m.classes_)
    out = np.zeros((len(te), 3))
    for j, c in enumerate(cls):
        out[:, int(c)] = P[:, j]
    return out, info


def breakevens(tr: pd.DataFrame, key: str) -> dict:
    """Cost-implied breakeven win rate per pair and side from the training labels:
    avg loss / (avg win + avg loss) of the isolated barrier trades."""
    out = {}
    for pid, g in tr.groupby("pair_id"):
        be = []
        for side in ("L", "S"):
            x = g[f"{side}_{key}"].to_numpy()
            w, lo = x[x > 0], -x[x <= 0]
            be.append(float(lo.mean() / (w.mean() + lo.mean())) if len(w) and len(lo) else 1.0)
        out[int(pid)] = be
    return out


def _fold_cols(keys) -> list[str]:
    cols = ["time"] + FEATS
    for k in keys:
        cols += [f"X_{k}", f"L_{k}", f"S_{k}"]
    return cols + [f"fwd{h}" for h in FWD]


def run_fold(year: int, label_keys, model_keys, force: bool = False) -> None:
    """Train on the trailing TRAIN_YEARS years (every TRAIN_STEP-th minute, 1-day embargo),
    predict every decision minute of `year`; one file per (label, model, year)."""
    todo = [(k, m) for k in label_keys for m in model_keys
            if force or not (PRED_DIR / f"{k}_{m}" / f"{year}.parquet").exists()]
    if not todo:
        return
    t0 = time.time()
    yrs = [y for y in range(year - TRAIN_YEARS, year) if y >= YEARS[0]]
    cols = _fold_cols(sorted({k for k, _ in todo}))
    tr = load_rows(PAIRS, yrs, step=TRAIN_STEP, cols=cols)
    tr = tr[tr["time"] < pd.Timestamp(f"{year}-01-01") - pd.Timedelta(days=1)].reset_index(drop=True)
    te = load_rows(PAIRS, [year], step=1, cols=cols)
    print(f"[{year}] train {yrs[0]}-{yrs[-1]}: {len(tr):,} rows, test {len(te):,} rows "
          f"({time.time() - t0:.0f}s)", flush=True)
    for key in sorted({k for k, _ in todo}):
        y = classes(tr, key)
        be = breakevens(tr, key)
        hold = LABELS[key][0]
        pid = te["pair_id"].to_numpy().astype(int)
        beL = np.array([be[p][0] for p in range(len(PAIRS))])[pid]
        beS = np.array([be[p][1] for p in range(len(PAIRS))])[pid]
        for mk in [m for k, m in todo if k == key]:
            t1 = time.time()
            P, info = fit_predict(mk, tr, y, te, seed=year)
            out = pd.DataFrame({
                "time": te["time"].to_numpy(), "pair_id": pid.astype(np.int8),
                "p0": P[:, 0].astype(np.float32), "pL": P[:, 1].astype(np.float32),
                "pS": P[:, 2].astype(np.float32),
                "beL": beL.astype(np.float32), "beS": beS.astype(np.float32),
                "X": te[f"X_{key}"].to_numpy(), "L": te[f"L_{key}"].to_numpy(),
                "S": te[f"S_{key}"].to_numpy(), "fwd": te[f"fwd{hold}"].to_numpy(),
                "cls": classes(te, key)})
            d = PRED_DIR / f"{key}_{mk}"
            d.mkdir(parents=True, exist_ok=True)
            out.to_parquet(d / f"{year}.parquet", compression="zstd")
            info.update(year=year, label=key, model=mk, train_rows=len(tr),
                        train_years=[yrs[0], yrs[-1]], train_class_rate=np.bincount(y, minlength=3).tolist(),
                        breakeven=be, seconds=round(time.time() - t1, 1))
            (d / f"{year}.json").write_text(json.dumps(info))
            print(f"  [{year}] {key} {mk}: {time.time() - t1:.0f}s", flush=True)
    del tr, te


def load_preds(key: str, mk: str, years) -> pd.DataFrame:
    return pd.concat([pd.read_parquet(PRED_DIR / f"{key}_{mk}" / f"{y}.parquet") for y in years],
                     ignore_index=True)


def pred_metrics(pr: pd.DataFrame) -> dict:
    """Prediction skill: AUC of p_long for 'long wins', of p_short for 'short wins', direction
    AUC / accuracy of p_long - p_short against the sign of the forward h-minute mid return."""
    from sklearn.metrics import roc_auc_score
    cls = pr["cls"].to_numpy()
    out = {"n": int(len(pr)), "rate_long_win": float((cls == 1).mean()),
           "rate_short_win": float((cls == 2).mean())}
    for c, col, nm in ((1, "pL", "auc_long_win"), (2, "pS", "auc_short_win")):
        yy = cls == c
        out[nm] = float(roc_auc_score(yy, pr[col])) if 0 < yy.sum() < len(yy) else float("nan")
    f = pr["fwd"].to_numpy()
    ok = np.isfinite(f) & (f != 0)
    sc = (pr["pL"] - pr["pS"]).to_numpy()[ok]
    up = f[ok] > 0
    out["auc_dir"] = float(roc_auc_score(up, sc))
    out["acc_dir"] = float(((sc > 0) == up).mean())
    out["acc_dir_base"] = float(max(up.mean(), 1 - up.mean()))
    top = pr[["pL", "pS"]].max(axis=1).to_numpy()
    q = np.quantile(top, 0.99)
    side = np.where(pr["pL"].to_numpy() >= pr["pS"].to_numpy(), 1, 2)
    hit = side == cls
    out["top1pct_win"] = float(hit[top >= q].mean())
    out["all_win_side"] = float(hit.mean())
    return out


# ============================================================================ trading rules
MARGINS_SELECT = [0.0, 0.02, 0.05, 0.10]               # IS grid for the trading rule
MARGINS_TABLE = [-0.15, -0.10, -0.05, -0.02, 0.0, 0.02, 0.05, 0.10, 0.15]  # descriptive


def rule_signals(pr: pd.DataFrame, hold: float, margin: float | None, tp_mult=1.0,
                 sl_mult=1.0, seed: int | None = None) -> pd.DataFrame:
    """margin None = always trade the model's side; seed = random side, every minute."""
    pL, pS = pr["pL"].to_numpy(), pr["pS"].to_numpy()
    side = np.where(pL >= pS, 1, -1)
    if seed is not None:
        side = np.random.default_rng(seed).choice([-1, 1], size=len(pr))
        fire = np.ones(len(pr), bool)
    elif margin is None:
        fire = np.ones(len(pr), bool)
    else:
        p = np.maximum(pL, pS)
        be = np.where(side > 0, pr["beL"].to_numpy(), pr["beS"].to_numpy())
        fire = p >= be + margin
    x = pr["X"].to_numpy()[fire].astype(float)
    return pd.DataFrame({"dir": side[fire], "tp": x * tp_mult, "sl": x * sl_mult,
                         "hold": float(hold)}, index=pd.DatetimeIndex(pr["time"].to_numpy()[fire]))


def moments(tr: pd.DataFrame) -> dict:
    net = tr["net_pips"].to_numpy()
    return {"n": int(len(net)), "s": float(net.sum()), "ss": float((net ** 2).sum()),
            "w": int((net > 0).sum()), "g": float(tr["gross_pips"].sum()),
            "min": float(tr["minutes"].sum())}


def pooled(ms: list[dict], years: float) -> dict:
    n = sum(m["n"] for m in ms)
    if n < 2:
        return {"n": n, "trades_per_year": n / years}
    s, ss = sum(m["s"] for m in ms), sum(m["ss"] for m in ms)
    mean = s / n
    sd = math.sqrt(max(ss - n * mean * mean, 0.0) / (n - 1))
    return {"n": n, "trades_per_year": n / years, "win": sum(m["w"] for m in ms) / n,
            "avg_gross": sum(m["g"] for m in ms) / n, "avg_net": mean,
            "t": mean / sd * math.sqrt(n) if sd > 0 else float("nan"),
            "avg_min": sum(m["min"] for m in ms) / n}


def _m1(sym: str, start, end) -> pd.DataFrame:
    return scalp.load(sym, start=start, end=end)[["open", "high", "low", "close"]].astype("float64")


def stage_is(label_keys=None, model_keys=None) -> None:
    for y in IS_VAL_YEARS:
        run_fold(y, label_keys or list(LABELS), model_keys or list(MODELS))


def stage_isrules() -> None:
    """IS (2011-2014 walk-forward predictions): prediction skill + every trading rule of the
    grid -> one trial-log line each."""
    yrs = len(IS_VAL_YEARS)
    m1s = {s: _m1(s, f"{IS_VAL_YEARS[0]}-01-01", f"{IS_VAL_YEARS[-1] + 1}-01-03") for s in PAIRS}
    acc: dict = {}
    skill: dict = {}
    for k in LABELS:
        hold = LABELS[k][0]
        for m in MODELS:
            t0 = time.time()
            pr_all = load_preds(k, m, IS_VAL_YEARS)
            skill[(k, m)] = {"all": pred_metrics(pr_all),
                             "by_year": {int(y): pred_metrics(g)
                                         for y, g in pr_all.groupby(pr_all["time"].dt.year)}}
            for sym in PAIRS:
                pr = pr_all[pr_all["pair_id"] == PAIR_ID[sym]]
                runs = [("always", None, None)] + [(f"m{mg:+.2f}", mg, None) for mg in MARGINS_TABLE]
                if m == list(MODELS)[0]:
                    runs.append(("random", None, 7 + PAIR_ID[sym]))
                for name, mg, seed in runs:
                    tr = scalp.simulate(m1s[sym], rule_signals(pr, hold, mg, seed=seed), sym)
                    acc.setdefault((k, m if name != "random" else "random", name), {})[sym] = moments(tr)
            print(f"  isrules {k} {m}: {time.time() - t0:.0f}s", flush=True)
    for (k, m, name), per in acc.items():
        pool = pooled(list(per.values()), yrs)
        margin = None if name in ("always", "random") else float(name[1:])
        params = {"label": k, "hold": LABELS[k][0], "k_sigma": LABELS[k][1], "model": m,
                  "rule": name, "margin": margin,
                  "selectable": margin is not None and margin in MARGINS_SELECT,
                  "val_years": IS_VAL_YEARS, "train_years": TRAIN_YEARS, "pairs": PAIRS}
        metrics = {"pool": pool, "per_pair": {s: pooled([v], yrs) for s, v in per.items()}}
        if m != "random":
            metrics["skill"] = skill[(k, m)]["all"]
            metrics["skill_by_year"] = skill[(k, m)]["by_year"]
        LOG.log(params, metrics, period="is")
    print(f"logged {len(acc)} IS configurations to {LOG.path}")


def load_is_log() -> pd.DataFrame:
    rows = []
    if not LOG.path.exists():
        return pd.DataFrame()
    for line in open(LOG.path):
        r = json.loads(line)
        if r.get("period") != "is":
            continue
        row = dict(r["params"])
        for kk, vv in r["metrics"]["pool"].items():
            row[kk] = vv
        for kk, vv in r["metrics"].get("skill", {}).items():
            row[f"sk_{kk}"] = vv
        for s, p in r["metrics"]["per_pair"].items():
            row[f"{s}_avg_net"] = p.get("avg_net", np.nan)
            row[f"{s}_n"] = p.get("n", 0)
        rows.append(row)
    df = pd.DataFrame(rows)
    return df.drop_duplicates(subset=["label", "model", "rule"], keep="last").reset_index(drop=True)


# ============================================================================ final (OOS once)
# Final candidates, fixed from the IS trial log (2011-2014 inner walk-forward) BEFORE any OOS
# prediction was made.  Filled in after --stage isrules (see the report, section 3).
FINAL: list[dict] = []

IS_YEARS_LEN = float(len(IS_VAL_YEARS))
OOS_YEARS_LEN = (OOS_END - pd.Timestamp("2015-01-01")).days / 365.25


def tstats(g: pd.DataFrame, years: float | None = None) -> dict:
    n = len(g)
    if n == 0:
        return {"n": 0}
    net = g["net_pips"].to_numpy()
    sd = net.std(ddof=1) if n > 1 else float("nan")
    w, lo = net[net > 0], -net[net <= 0]
    out = {"n": int(n), "win": float((net > 0).mean()), "avg_gross": float(g["gross_pips"].mean()),
           "avg_net": float(net.mean()),
           "t": float(net.mean() / sd * math.sqrt(n)) if n > 1 and sd > 0 else float("nan"),
           "avg_win": float(w.mean()) if len(w) else float("nan"),
           "avg_loss": float(lo.mean()) if len(lo) else float("nan"),
           "avg_min": float(g["minutes"].mean()), "total_net": float(net.sum()),
           "avg_tp": float(g["tp_pips"].mean()), "avg_sl": float(g["sl_pips"].mean()),
           "tp_share": float((g["reason"] == "tp").mean()),
           "sl_share": float((g["reason"] == "sl").mean())}
    if len(w) and len(lo):
        out["be_win"] = float(lo.mean() / (w.mean() + lo.mean()))
    if years:
        out["per_year"] = n / years
    yr = g.groupby(g["entry_time"].dt.year)["net_pips"].sum()
    if len(yr) > 1:
        rest = g[g["entry_time"].dt.year != yr.idxmax()]
        out["best_year"] = int(yr.idxmax())
        out["drop_best_year"] = float(rest["net_pips"].mean())
    return out


def summ(tr: pd.DataFrame) -> dict:
    ins, oos = tr[tr["entry_time"] < IS_END], tr[tr["entry_time"] >= IS_END]
    out = {"is": tstats(ins, IS_YEARS_LEN), "oos": tstats(oos, OOS_YEARS_LEN)}
    out["is_pair"] = {s: tstats(g, IS_YEARS_LEN) for s, g in ins.groupby("symbol")}
    out["oos_pair"] = {s: tstats(g, OOS_YEARS_LEN) for s, g in oos.groupby("symbol")}
    out["year"] = {int(y): tstats(g) for y, g in tr.groupby(tr["entry_time"].dt.year)}
    return out


def delayed(sig: pd.DataFrame, m1: pd.DataFrame, k: int) -> pd.DataFrame:
    """Same decisions, executed k minutes (bars) later: signal bar p -> p + k."""
    pos = m1.index.get_indexer(sig.index) + k
    ok = pos < len(m1)
    return sig[ok].set_axis(m1.index[pos[ok]])


def random_times(pr: pd.DataFrame, n: int, hold: float, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    pick = np.sort(rng.choice(len(pr), size=min(len(pr), n), replace=False))
    x = pr["X"].to_numpy()[pick].astype(float)
    return pd.DataFrame({"dir": rng.choice([-1, 1], size=len(pick)), "tp": x, "sl": x,
                         "hold": float(hold)}, index=pd.DatetimeIndex(pr["time"].to_numpy()[pick]))


def stage_final() -> None:
    if not FINAL:
        raise SystemExit("FINAL is empty: run --stage is / --stage isrules and fix the candidates")
    for cand in FINAL:
        for y in OOS_YEARS:                            # OOS walk-forward: trained on y-6..y-1
            run_fold(y, [cand["label"]], [cand["model"]])
    for cand in FINAL:
        final_candidate(cand)


def final_candidate(cand: dict) -> None:
    name, key, mk, mg = cand["name"], cand["label"], cand["model"], cand["margin"]
    hold = LABELS[key][0]
    d = RES_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    pr_is = load_preds(key, mk, IS_VAL_YEARS)
    pr_oos = load_preds(key, mk, OOS_YEARS)
    res: dict = {"cand": cand, "skill": {
        "is": pred_metrics(pr_is), "oos": pred_metrics(pr_oos),
        "is_year": {int(y): pred_metrics(g) for y, g in pr_is.groupby(pr_is["time"].dt.year)},
        "oos_year": {int(y): pred_metrics(g) for y, g in pr_oos.groupby(pr_oos["time"].dt.year)},
        "oos_pair": {PAIRS[int(p)]: pred_metrics(g) for p, g in pr_oos.groupby("pair_id")}}}
    pr_all = pd.concat([pr_is, pr_oos], ignore_index=True)
    del pr_is, pr_oos
    runs: dict[str, list] = {}
    for sym in PAIRS:
        t0 = time.time()
        m1 = _m1(sym, f"{IS_VAL_YEARS[0]}-01-01", OOS_END)
        pr = pr_all[pr_all["pair_id"] == PAIR_ID[sym]]
        sig = rule_signals(pr, hold, mg)
        todo = {
            "base": (sig, 1.0), "cost1.5": (sig, 1.5), "cost2": (sig, 2.0),
            "frictionless": (sig, 0.0),
            "delay1": (delayed(sig, m1, 1), 1.0), "delay2": (delayed(sig, m1, 2), 1.0),
            "shape_tp0.5_sl2": (rule_signals(pr, hold, mg, tp_mult=0.5, sl_mult=2.0), 1.0),
            "shape_tp2_sl0.5": (rule_signals(pr, hold, mg, tp_mult=2.0, sl_mult=0.5), 1.0),
            "always_ai": (rule_signals(pr, hold, None), 1.0),
            "always_random": (rule_signals(pr, hold, None, seed=17 + PAIR_ID[sym]), 1.0),
            "random": (random_times(pr, 4 * len(sig) + 1000, hold, 29 + PAIR_ID[sym]), 1.0),
        }
        for m in MARGINS_TABLE:
            todo[f"table{m:+.2f}"] = (rule_signals(pr, hold, m), 1.0)
        for k, (s_, cm) in todo.items():
            runs.setdefault(k, []).append(scalp.simulate(m1, s_, sym, cost_mult=cm))
        print(f"  final {name} {sym}: {len(sig):,} signals, {time.time() - t0:.0f}s", flush=True)
    out = {k: pd.concat(v, ignore_index=True) for k, v in runs.items()}
    base = out["base"]
    base.to_parquet(OUT_DIR / f"trades_{KEY}_{name}.parquet")
    res["runs"] = {k: summ(v) for k, v in out.items()}
    ny_hr = scalp.local_time(pd.DatetimeIndex(base["entry_time"]), "America/New_York").hour
    res["base_by_ny_hour"] = {per: {int(h): tstats(g) for h, g in part.groupby(ny_hr[msk])}
                              for per, msk in (("is", (base["entry_time"] < IS_END).to_numpy()),
                                               ("oos", (base["entry_time"] >= IS_END).to_numpy()))
                              for part in [base[msk]]}
    # net pips of the chosen rule by pair x year (for the per-year table)
    res["importance"] = importances(key, mk)
    (d / "summary.json").write_text(json.dumps(res, default=float))
    for s in PAIRS:
        b = base[base["symbol"] == s]
        LOG.log({**cand, "pair": s},
                {"is": tstats(b[b["entry_time"] < IS_END]), "oos": tstats(b[b["entry_time"] >= IS_END])},
                period="final")
    LOG.log({**cand, "pair": "pool"}, {"is": res["runs"]["base"]["is"],
                                       "oos": res["runs"]["base"]["oos"],
                                       "skill_oos": res["skill"]["oos"]}, period="final")


def importances(key: str, mk: str) -> dict:
    """Mean normalised LightGBM gain over the folds that exist (IS and OOS separately)."""
    out = {}
    for per, yrs in (("is", IS_VAL_YEARS), ("oos", OOS_YEARS)):
        imps = []
        for y in yrs:
            p = PRED_DIR / f"{key}_{mk}" / f"{y}.json"
            if p.exists():
                info = json.loads(p.read_text())
                if "importance" in info:
                    imps.append(pd.Series(info["importance"]))
        if imps:
            out[per] = pd.concat(imps, axis=1).mean(axis=1).sort_values(ascending=False).to_dict()
    return out


# ============================================================================ report
def f(x, d=2, sign=True) -> str:
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    if isinstance(x, (int, np.integer)):
        return f"{x:,}"
    return f"{x:+.{d}f}" if sign else f"{x:.{d}f}"


def pct(x, d=1) -> str:
    return "-" if x is None or not np.isfinite(x) else f"{100 * x:.{d}f}%"


def fold_breakeven(key: str, mk: str, years) -> float:
    vals = []
    for y in years:
        p = PRED_DIR / f"{key}_{mk}" / f"{y}.json"
        if p.exists():
            be = json.loads(p.read_text())["breakeven"]
            vals += [v for pair in be.values() for v in pair]
    return float(np.mean(vals)) if vals else float("nan")


def load_final() -> dict:
    out = {}
    for cand in FINAL:
        p = RES_DIR / cand["name"] / "summary.json"
        if p.exists():
            out[cand["name"]] = json.loads(p.read_text())
    return out


def verdict(res: dict) -> dict:
    r = res["runs"]
    b_is, b_oos, c15 = r["base"]["is"], r["base"]["oos"], r["cost1.5"]["oos"]
    checks = {
        "IS 平均ネット > 0": b_is.get("avg_net", -1) > 0,
        "OOS 平均ネット > 0": b_oos.get("avg_net", -1) > 0,
        "OOS t値 >= 2.0": b_oos.get("t", -9) >= 2.0,
        "OOS 取引数 >= 200": b_oos.get("n", 0) >= 200,
        "OOS コスト1.5倍でも > 0": c15.get("avg_net", -1) > 0,
        "OOS 最良年を除いても > 0": b_oos.get("drop_best_year", -1) > 0,
    }
    return {"checks": checks, "survives": all(checks.values())}


def _row(label: str, s: dict) -> str:
    if not s or not s.get("n"):
        return f"| {label} | 0 | - | - | - | - | - |"
    return (f"| {label} | {s['n']:,} | {s.get('per_year', float('nan')):,.0f} | {pct(s['win'])} "
            f"| {f(s['avg_gross'])} | {f(s['avg_net'])} | {f(s['t'])} |")


def skill_table(lg: pd.DataFrame) -> list[str]:
    L = ["| ラベル（保有・利確=損切り幅） | モデル | 買い勝ちAUC | 売り勝ちAUC | 方向AUC | 方向正解率 "
         "| 勝ち側の率(全分) | 上位1%の勝率 | 損益分岐の勝率 | 常時売買 平均ネット |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    al = lg[lg["rule"] == "always"]
    for key in LABELS:
        for mk in MODELS:
            r = al[(al["label"] == key) & (al["model"] == mk)]
            if not len(r):
                continue
            r = r.iloc[0]
            L.append(f"| {LABEL_JA[key]} | {MODEL_JA[mk]} | {r['sk_auc_long_win']:.3f} "
                     f"| {r['sk_auc_short_win']:.3f} | {r['sk_auc_dir']:.3f} | {pct(r['sk_acc_dir'])} "
                     f"| {pct(r['sk_all_win_side'])} | {pct(r['sk_top1pct_win'])} "
                     f"| {pct(fold_breakeven(key, mk, IS_VAL_YEARS))} | {f(r['avg_net'])} |")
    return L


def rule_table(lg: pd.DataFrame, top: int | None = None) -> list[str]:
    L = ["| ラベル | モデル | ルール | 取引数(4年・6ペア) | 年あたり | 勝率 | 平均グロス | 平均ネット | t値 | ネット>0のペア(6) |",
         "|---|---|---|---:|---:|---:|---:|---:|---:|---:|"]
    sel = lg[(lg["selectable"] == True) | lg["rule"].isin(["always", "random"])]  # noqa: E712
    sel = sel.sort_values("avg_net", ascending=False, na_position="last")
    if top:
        sel = sel.head(top)
    for r in sel.to_dict("records"):
        npos = sum((r.get(f"{s}_avg_net") or -1) > 0 for s in PAIRS)
        rule = {"always": "常時（AIの向き、閾値なし）", "random": "常時（ランダムな向き）"}.get(
            r["rule"], f"分岐点+{r['margin']:.2f}")
        mdl = "-" if r["model"] == "random" else MODEL_JA[r["model"]]
        if not r.get("n"):
            L.append(f"| {LABEL_JA[r['label']]} | {mdl} | {rule} | 0 | 0 | - | - | - | - | - |")
            continue
        L.append(f"| {LABEL_JA[r['label']]} | {mdl} | {rule} | {r['n']:,} | {r['trades_per_year']:,.0f} "
                 f"| {pct(r.get('win', np.nan))} | {f(r.get('avg_gross', np.nan))} "
                 f"| {f(r.get('avg_net', np.nan))} | {f(r.get('t', np.nan))} | {npos} |")
    return L


def threshold_table(res: dict, per: str) -> list[str]:
    L = ["| 確率の閾値（損益分岐+余裕） | 取引数 | 年あたり | 勝率 | 平均グロス | 平均ネット | t値 | 平均利益 | 平均損失 | 必要勝率 |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    rows = [("常時（閾値なし）", res["runs"]["always_ai"][per])]
    rows += [(f"分岐点{m:+.2f}", res["runs"][f"table{m:+.2f}"][per]) for m in MARGINS_TABLE]
    for lab, s in rows:
        if not s.get("n"):
            L.append(f"| {lab} | 0 | 0 | - | - | - | - | - | - | - |")
            continue
        L.append(f"| {lab} | {s['n']:,} | {s['per_year']:,.0f} | {pct(s['win'])} | {f(s['avg_gross'])} "
                 f"| {f(s['avg_net'])} | {f(s['t'])} | {f(s.get('avg_win'))} | {f(-s.get('avg_loss', np.nan))} "
                 f"| {pct(s.get('be_win', np.nan))} |")
    return L


def candidate_section(res: dict) -> list[str]:
    cand, r = res["cand"], res["runs"]
    v = verdict(res)
    L = [f"### 候補 {cand['name']}", "",
         f"* ルール: {cand['rule']}",
         f"* 選定理由（IS 2011-2014 の内側ウォークフォワードだけで判断）: {cand['why']}", "",
         "| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス | 平均ネット(pips) | t値 |",
         "|---|---:|---:|---:|---:|---:|---:|",
         _row("IS 2011-2014（コスト1.0）", r["base"]["is"]),
         _row("**OOS 2015-2020.5（コスト1.0）**", r["base"]["oos"])]
    for k, lab in [("cost1.5", "OOS コスト1.5倍"), ("cost2", "OOS コスト2倍"),
                   ("frictionless", "OOS 摩擦ゼロ（スプレッド・滑り・手数料なし）"),
                   ("delay1", "OOS 判断から1分遅れて約定"), ("delay2", "OOS 2分遅れて約定"),
                   ("always_ai", "OOS 比較: 毎分 AI の向きで常時売買（閾値なし）"),
                   ("always_random", "OOS 比較: 毎分ランダムな向きで常時売買（同じ利確・損切り）"),
                   ("random", "OOS 比較: ランダム時刻・ランダムな向き（同じ利確・損切り）")]:
        L.append(_row(lab, r[k]["oos"]))
    L += ["", "IS 側の同じ比較:", "",
          "| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス | 平均ネット | t値 |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for k, lab in [("cost1.5", "IS コスト1.5倍"), ("frictionless", "IS 摩擦ゼロ"),
                   ("delay1", "IS 1分遅れ"), ("delay2", "IS 2分遅れ"),
                   ("always_ai", "IS 常時 AI の向き"), ("always_random", "IS 常時ランダム"),
                   ("random", "IS ランダム時刻")]:
        L.append(_row(lab, r[k]["is"]))
    L += ["", "生き残り判定:", ""]
    for k, ok in v["checks"].items():
        L.append(f"* {'OK' if ok else 'NG'}: {k}")
    bo = r["base"]["oos"]
    L += [f"* OOS の最良年 {bo.get('best_year', '-')} を除いた平均: {f(bo.get('drop_best_year'))} pips",
          f"* **判定: {'生き残り' if v['survives'] else '不合格'}**", "",
          "年別（コスト1.0、6ペア合算）と、その年の予測精度（全決定時刻、6ペア合算）:", "",
          "| 年 | 区間 | 取引数 | 勝率 | 平均ネット | 合計ネット(pips) | 摩擦ゼロ平均 | 方向AUC | 方向正解率 | 買い勝ちAUC |",
          "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    sk = {**{int(k): v for k, v in res["skill"]["is_year"].items()},
          **{int(k): v for k, v in res["skill"]["oos_year"].items()}}
    fr = r["frictionless"]["year"]
    for y, s in sorted(r["base"]["year"].items(), key=lambda kv: int(kv[0])):
        y = int(y)
        k = sk.get(y, {})
        L.append(f"| {y} | {'IS' if y < IS_END.year else 'OOS'} | {s['n']:,} | {pct(s['win'], 0)} "
                 f"| {f(s['avg_net'])} | {s['total_net']:+,.0f} | {f(fr.get(str(y), fr.get(y, {})).get('avg_gross'))} "
                 f"| {k.get('auc_dir', np.nan):.3f} | {pct(k.get('acc_dir', np.nan))} | {k.get('auc_long_win', np.nan):.3f} |")
    L += ["", "ペア別:", "",
          "| ペア | IS 取引数 | IS 平均ネット | OOS 取引数 | OOS 勝率 | OOS 平均ネット | OOS t値 | OOS 摩擦ゼロ | OOS 方向AUC |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for s in PAIRS:
        bi, bo_ = r["base"]["is_pair"].get(s, {}), r["base"]["oos_pair"].get(s, {})
        fo = r["frictionless"]["oos_pair"].get(s, {})
        L.append(f"| {s} | {bi.get('n', 0):,} | {f(bi.get('avg_net'))} | {bo_.get('n', 0):,} "
                 f"| {pct(bo_.get('win', np.nan), 0)} | {f(bo_.get('avg_net'))} | {f(bo_.get('t'))} "
                 f"| {f(fo.get('avg_gross'))} | {res['skill']['oos_pair'].get(s, {}).get('auc_dir', np.nan):.3f} |")
    return L


def importance_table(fin: dict, lg: pd.DataFrame) -> list[str]:
    """Top features by mean normalised LightGBM gain (IS folds of both LightGBM sizes)."""
    cols, names = [], []
    for key in LABELS:
        for mk in ("lgb_s", "lgb_l"):
            imp = importances(key, mk).get("is")
            if imp:
                cols.append(pd.Series(imp))
                names.append(f"{key}_{mk}")
    if not cols:
        return ["(LightGBM の重要度なし)"]
    df = pd.concat(cols, axis=1, keys=names).fillna(0)
    h5 = df[[c for c in df.columns if c.startswith("h5")]].mean(axis=1)
    h30 = df[[c for c in df.columns if c.startswith("h30")]].mean(axis=1)
    order = (h5 + h30).sort_values(ascending=False).index[:20]
    L = ["| 順位 | 特徴量 | 意味 | 5分ラベルでの重要度 | 30分ラベルでの重要度 |", "|---:|---|---|---:|---:|"]
    for j, c in enumerate(order, 1):
        L.append(f"| {j} | `{c}` | {FEAT_JA.get(c, '')} | {pct(h5[c])} | {pct(h30[c])} |")
    return L


FEAT_JA = {
    **{f"r{k}": f"直近{k}分のリターン（σ√{k}で正規化）" for k in RET_K},
    "vr15_60": "ボラ比 15本/60本", "vr60_240": "ボラ比 60本/240本", "vr240_1440": "ボラ比 240本/1440本",
    "lvol60": "直近60本のボラ σ の水準（log pips）", "rng1": "直近1本の値幅/σ", "rng5": "直近5本の平均値幅/σ",
    "body1": "直近1本の実体/σ", "uwick1": "直近1本の上ヒゲ/σ", "lwick1": "直近1本の下ヒゲ/σ",
    "vz": "ティック出来高の z スコア（60本）", "v5r": "出来高 5本平均/60本平均", "v60r": "出来高 60本平均/1440本平均",
    "pos15": "15本レンジ内の位置", "pos60": "60本レンジ内の位置", "pos240": "240本レンジ内の位置",
    "pos1440": "1440本（約1日）レンジ内の位置", "posPD": "前日の高値・安値に対する位置",
    "w60": "60本レンジ幅/(σ√60)", "w240": "240本レンジ幅/(σ√240)",
    "dev60": "60本平均からの乖離/σ", "dev240": "240本平均からの乖離/σ",
    "rn100": "100 pips のキリ番間での位置", "d100": "最寄りの00キリ番までの距離/σ", "d50": "最寄りの50キリ番までの距離/σ",
    "span240": "直近240本が何分にまたがるか（データ欠落）",
    "x1": "参照ペアの1分リターン", "x5": "参照ペアの5分リターン", "x15": "参照ペアの15分リターン",
    "x60": "参照ペアの60分リターン", "rel5": "自ペア−参照ペア 5分", "rel15": "自ペア−参照ペア 15分",
    "rel60": "自ペア−参照ペア 60分", "tod": "サーバー時刻（分）", "tod_lon": "ロンドン時刻", "tod_jst": "日本時刻",
    "dow": "曜日", "pair_id": "ペア",
}


def method_section(lg: pd.DataFrame) -> list[str]:
    n_is = int(len(lg))
    n_sel = int(lg["selectable"].sum()) if len(lg) else 0
    return [
        "## 1. 何を検証したか", "",
        "* データ: OANDA M1 仲値 2005-01〜2020-05-14。**実データの6ペア** (" + ", ".join(PAIRS) + ") を1つの"
        "モデルでまとめて学習（特徴量はボラティリティで正規化し、ペアIDも入力）。USDJPY などの合成クロスは M1 の高値・安値が"
        "広すぎて利確・損切りの判定が歪むため使っていない。XAUUSD も対象外。",
        "* 判断時刻: **サーバー時間 09:00-21:59 の毎分**（月〜金。日本時間では夏 15:00-03:59 / 冬 16:00-04:59、"
        "ロンドン〜NY の流動性が高い時間帯）。この時間帯のスプレッド倍率はすべて 1.0。学習には5分ごとの時刻だけを使い"
        "（隣り合う1分はほぼ同じ標本のため。1学習あたり約145万行）、予測と売買は毎分（1年・6ペアで約120万回の判断）。",
        "* 特徴量（45個、すべてシグナル足の終値までのデータ。窓はすべて過去向き）:",
        "  * 直近 1/2/5/15/30/60/240 分のリターン（直近60本の1分足変化の標準偏差 σ×√分 で正規化）",
        "  * 実現ボラの比（15/60、60/240、240/1440本）と σ の水準、直近足の値幅・実体・上下ヒゲ、直近5本の平均値幅",
        "  * ティック出来高の z スコアと比率（5/60本、60/1440本）",
        "  * 直近 15/60/240/1440 本の高値・安値レンジ内の位置とレンジ幅、前日（確定済みのサーバー日）の高値・安値に対する位置、"
        "60/240本平均からの乖離",
        "  * キリ番（00・50）までの距離（σ単位）と100 pips 内の位置",
        "  * サーバー時刻・ロンドン時刻・日本時刻（夏時間は自動処理）、曜日",
        "  * 参照ペアの 1/5/15/60分リターンと、自ペアとの差（EURJPY・AUDUSD・USDCAD←EURUSD、EURUSD←GBPUSD、"
        "GBPUSD←EURUSD、AUDJPY←AUDUSD。USDCAD は符号反転）",
        "  * ペアID。※ スプレッド倍率の時間帯特徴量は、この判断時間帯では常に 1.0 なので入れていない。",
        "  * **未来データ不使用の確認**: シグナル足より後のデータ（自ペア・参照ペアとも）を削除して特徴量を作り直し、"
        "キャッシュと完全一致することを確認した（`--stage check`、2ペア×3時刻）。",
        "* ラベル（AI に当てさせる対象）: その時刻に**買った場合と売った場合の実際のコスト後損益**（fxlab/scalp.py と"
        "同じ約定計算: 次足始値で成行、利確 = 損切り = X pips、h 分で時間切れ、スプレッド・滑り・手数料込み）。"
        "X = k × σ × √h（1〜40 pips にクリップ）。クラス 1 = 買えばプラス、2 = 売ればプラス、0 = どちらもマイナス。"
        "**h = 5分・30分 × k = 1・2 の4種類**。このラベル計算が scalp.simulate と1件ずつ完全一致することを確認した"
        "（`--stage check`、6ペア×4ラベル×売買、12,480件、誤差 0）。",
        "  * 目安（EURUSD 2012年）: 5分・1σ は X の中央値 4.4 pips、買いで勝つ率 36%、損益分岐の勝率 57%。"
        "30分・1σ は X 10.8 pips、買いで勝つ率 44%、損益分岐の勝率 53%。**どのラベルでも、何も考えずに入ると"
        "1回あたり約 -1.4 pips（＝コスト）**。",
        "* モデル（3クラスの確率 p(買い勝ち)・p(売り勝ち) を出力）:",
        "  * LightGBM（勾配ブースティング木）: 小 = 15葉×200本、大 = 63葉×400本（n_jobs=2）",
        "  * 多項ロジスティック回帰（線形モデル）",
        "  * ニューラルネット: sklearn MLPClassifier（隠れ層 64-32、学習は最大40万行、早期終了）",
        "* ウォークフォワード: 毎年、直前6年で学習し直す（年末1日はエンバーゴ）。**IS 内の検証** = 2011・2012・2013・2014年"
        "（それぞれ 2005-10、06-11、07-12、08-13 で学習）。ラベル・モデル・閾値の余裕 m はこの IS 検証だけで決めた。"
        "**OOS** = 2015〜2020.5（2009-14 〜 2014-19 で学習）は最終候補だけ1回実行。",
        "* 売買ルール: 買い・売りのうち確率の高い側を選び、その確率が**損益分岐の勝率 + 余裕 m** 以上のときだけ次足始値で成行。"
        "損益分岐の勝率 = 平均損失 ÷ (平均利益 + 平均損失)（学習期間のラベルから、ペア・売買方向ごと）。"
        "m ∈ {0, 0.02, 0.05, 0.10} を IS で選ぶ。1ペア1ポジション（保有中のシグナルは無視）。",
        f"* 試行ログ `reports/trials/scalp_ml_models.jsonl`: IS {n_is} 行（4ラベル×4モデル×"
        f"{{常時, 余裕 -0.15〜+0.15 の9段階}} ＋ 4ラベルのランダム売買）。うち選択対象（m ≥ 0 の4段階）は {n_sel} 通り。"
        "余裕がマイナスの段は「閾値を上げると何が起きるか」を示す記述用で、選択には使っていない。",
        "* 「摩擦ゼロ」= cost_mult=0（スプレッド・滑り・手数料なし、仲値で約定）＝ コスト前のグロスエッジ。"
        "「平均グロス」= スプレッド・滑り後、手数料前。「方向AUC」= p(買い勝ち) − p(売り勝ち) で h 分後の仲値の上下を"
        "判別する力（0.5 = 当て推量、1.0 = 完全）。「方向正解率」= その符号が h 分後の上下と一致した割合。", ""]


def report_text() -> str:
    lg = load_is_log()
    fin = load_final()
    L = ["# AI（機械学習）の高速判断でスキャルピングの勝率・期待値は上がるか — ml_models", "",
         "再現: `python scripts/scalp_ml_models.py`（最終評価とこのレポート）、`--stage features`（特徴量・ラベルの"
         "キャッシュ作成）、`--stage check`（ラベル計算＝scalp.simulate の一致確認と未来データ不使用の確認）、"
         "`--stage is` / `--stage isrules`（IS 探索、試行ログ `reports/trials/scalp_ml_models.jsonl` に追記）、"
         "`--report`（保存済みの結果からレポートだけ再生成）。キャッシュ置き場は環境変数 `FXLAB_ML_CACHE`"
         f"（既定 `{CACHE}`）。", ""]
    L += summary_section(lg, fin)
    L += method_section(lg)
    L += ["## 2. AI はどれだけ当てられるか（予測精度、IS 2011-2014 の内側ウォークフォワード）", "",
          "全判断時刻（1年・6ペアで約120万回）での成績。「勝ち側の率」= AI が選んだ向きで入った場合にコスト後プラスになる割合"
          "（閾値なし）。「上位1%の勝率」= 確信度（max(p買い, p売り)）が上位1%の時刻だけで同じ割合。"
          "「損益分岐の勝率」= この勝率を超えないと期待値がプラスにならない水準（学習期間のラベルから、全ペア・売買方向の平均）。", ""]
    L += skill_table(lg)
    L += skill_notes(lg)
    L += ["", "## 3. IS の売買ルール（確率 ≥ 損益分岐 + 余裕 m、2011-2014、6ペア合算）", "",
          "余裕 m ≥ 0 の選択対象と、比較用の「常時売買」（毎分、ポジションがなければ AI の向き／ランダムな向きで入る）。"
          "平均ネットの高い順。", ""]
    L += rule_table(lg)
    L += ["", "## 4. 最終候補の OOS 評価（2015-2020.5、1回だけ）", ""]
    for cand in FINAL:
        if cand["name"] in fin:
            L += candidate_section(fin[cand["name"]]) + [""]
    L += threshold_section(fin)
    L += winrate_section(fin, lg)
    L += ["## 7. AI は何を見ていたか（LightGBM の特徴量重要度、IS の全フォールド平均）", "",
          "重要度 = その特徴量による分割で減った損失の割合（gain、各モデルで合計100%）。", ""]
    L += importance_table(fin, lg)
    L += importance_notes(fin, lg)
    L += limits_section()
    return "\n".join(L) + "\n"


def limits_section() -> list[str]:
    return [
        "## 8. この検証の限界", "",
        "* **1分足の仲値（OANDA）しか使っていない。** 板情報・ティックごとの約定・実際の Bid/Ask の動きは見ていない。"
        "秒・ミリ秒単位の「速さ」の価値（HFT、レイテンシー裁定）はこのデータでは測れない。ただしそれは業者側・取引所の"
        "コロケーションの世界で、個人の MT5 口座で再現できるものではなく、多くの業者が規約で禁止している。",
        "* スプレッドは Titan FX ブレードの平均的な値×時間帯倍率の固定モデル。指標発表直後などのスプレッド拡大は入っていない"
        "（コスト1.5倍・2倍のストレスで代用）。AI が高確信になるのは値動きの大きい時間帯が多いので、実際のコストは"
        "モデルより大きい可能性がある。",
        "* AI が学んだ1分足のパターンの一部は、OANDA の仲値フィード固有のもの（配信の癖・古い気配）かもしれない。"
        "Titan FX の実際の気配で同じ形が出るとは限らない。",
        "* 1回の学習データは約145万行（5分ごと）。毎分すべてを使う・モデルを大きくする・特徴量を増やす（他の通貨・"
        "株価指数・金利・経済指標カレンダー）ことで精度がわずかに上がる余地はある。ただし必要なのは精度のわずかな改善ではなく、"
        "1回あたり 1.3〜2 pips のコストを超える改善で、それは IS の格子の結果（3章）から見て遠い。",
        "* ディープラーニング（torch など）、強化学習、LLM 型の AI は試していない（この環境に無い）。どの AI でも、"
        "入力が同じ価格データなら「コスト後の期待値」という同じ壁に当たる。", ""]


def write_report() -> None:
    REPORT.write_text(report_text())
    print(REPORT.read_text())


# ============================================================================ main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stage", default="final",
                    choices=["features", "check", "is", "isrules", "final"])
    ap.add_argument("--report", action="store_true", help="only rewrite the report")
    ap.add_argument("--labels", nargs="*", default=None)
    ap.add_argument("--models", nargs="*", default=None)
    a = ap.parse_args()
    if a.report:
        write_report()
        return
    if a.stage == "features":
        stage_features()
    elif a.stage == "check":
        print(stage_check())
        stage_leakcheck()
    elif a.stage == "is":
        stage_features()
        stage_is(a.labels, a.models)
    elif a.stage == "isrules":
        stage_isrules()
    else:
        stage_features()
        stage_final()
        write_report()


if __name__ == "__main__":
    main()
