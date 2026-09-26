"""Fast momentum / breakout scalping on M1: session opening ranges, large 1-5 minute bars and
the 08:30 ET US data minute (a calendar-free news proxy).

    python scripts/scalp_momentum_breakout.py              # final: OOS once + stress + report
    python scripts/scalp_momentum_breakout.py --stage 1    # IS signal screen (trial log)
    python scripts/scalp_momentum_breakout.py --stage 2    # IS exit grid on the stage-1 leaders
    python scripts/scalp_momentum_breakout.py --report     # rebuild the report from saved runs

Protocol (reports/trials/scalp_momentum_breakout.jsonl logs every configuration):
  stage 1  in-sample 2005-2014 only.  Three signal families with one neutral exit each,
           6 raw OANDA pairs (+ USDJPY, synthetic, flagged secondary), simulated at
           cost_mult 1 (Titan Blade), 0 (frictionless = gross edge) and, for the news
           family, 3 and 5 (the simulator does not widen spreads at news):
    (a) orb   opening-range breakout: range = first N minutes after a session open (Tokyo
              09:00 JST, London 08:00 London, New York 08:00 ET, US equity 09:30 ET, and the
              08:30 ET data minute); signal = first M1 close outside the range within 120
              minutes; trade in the breakout direction
    (b) big   |close - close k bars ago| > m x trailing volatility (std of 1-minute changes
              over the 120 bars before the move, x sqrt(k)), inside a session window;
              continuation or reversal; only the first bar of a cluster (15-bar cooldown)
    (c) news  08:30 ET: move from the 08:29 close to the close of 08:30 (k=1) or 08:31 (k=2);
              first Friday of the month (NFP proxy), other days with |z| > 3, or all other
              days; continuation or reversal
  stage 2  in-sample only: TP x SL x hold grid (+4 alternative exit units) on the best
           stage-1 signal of each family and the next best overall.
  final    at most 3 candidates fixed from the IS log (FINAL below), evaluated ONCE on
           2015-01-01..2020-05-14, with cost x1.5 / x2 (x3 / x5 for trades entered around
           the 08:30 and 10:00 ET releases), per year, per pair, entry delayed by 1 and 2
           minutes, frictionless gross and a random-entry baseline.

No look-ahead: the opening range uses only completed bars before the breakout window; the
volatility is a trailing window that ends before the move; every decision is taken on the
close of the signal bar and filled at the next M1 open by fxlab.scalp.simulate.
Local clocks (JST / London / New York) come from scalp.local_time, so DST is handled.
"""
from __future__ import annotations

import argparse
import json
import math
import pickle
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab import scalp  # noqa: E402
from fxlab.instruments import INSTRUMENTS  # noqa: E402
from fxlab.research import TrialLog  # noqa: E402

KEY = "momentum_breakout"
FAMILY = f"scalp_{KEY}"
LOG = TrialLog(FAMILY)
OUT_DIR = ROOT / "reports" / "scalping"
REPORT = OUT_DIR / f"{KEY}.md"
# final runs, kept outside the repo, only to rebuild the report text with --report
CACHE = scalp.D.M1_DIR.parent / "cache" / f"{KEY}_final_runs.pkl"
IS_START = pd.Timestamp("2005-01-01")
IS_END = scalp.IS_END                                  # 2015-01-01
OOS_END = pd.Timestamp("2020-05-15")

RAW = ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "AUDJPY"]
SYN = ["USDJPY"]                                       # synthetic: flagged secondary only
WORKERS = 1                                            # ~1.5-2 GB per worker
NS_MIN = 60_000_000_000
VOL_N = 120                                            # trailing volatility window (bars)
COOL = 15                                              # big-move cluster cooldown (bars)
ORB_WIN = 120                                          # breakout window after the range
SL_CLIP = (2.0, 60.0)                                  # scaled stops, pips
TP_CLIP = (1.0, 150.0)
FWD_H = [1, 2, 5, 15, 30, 60]                          # forward mid moves (minutes)

TZ = {"tok": "Asia/Tokyo", "ldn": "Europe/London", "ny": "America/New_York"}
# session opens: (clock, local minute of day)
ORB_SESSIONS = {"tok0900": ("tok", 9 * 60), "ldn0800": ("ldn", 8 * 60),
                "ny0800": ("ny", 8 * 60), "ny0930": ("ny", 9 * 60 + 30),
                "ny0830": ("ny", 8 * 60 + 30)}
# big-move windows: (clock, [local minute ranges]); NY skips 08:28-08:44 and 09:58-10:04 ET
BIG_SESSIONS = {"tokyo": ("tok", [(8 * 60, 15 * 60)]),
                "london": ("ldn", [(7 * 60, 12 * 60)]),
                "ny": ("ny", [(8 * 60, 8 * 60 + 28), (8 * 60 + 45, 9 * 60 + 58),
                              (10 * 60 + 5, 12 * 60)])}
NEWS_WINDOWS_ET = [(8 * 60 + 28, 8 * 60 + 45), (9 * 60 + 58, 10 * 60 + 5)]

STAGE1_EXIT = {"orb": dict(unit="scale", tp=1.0, sl=1.0, hold=60.0),
               "big": dict(unit="scale", tp=1.0, sl=1.0, hold=30.0),
               "news": dict(unit="scale", tp=1.0, sl=1.0, hold=30.0)}
STAGE2_HOLDS = {"orb": [30.0, 120.0], "big": [5.0, 30.0], "news": [5.0, 60.0]}
STAGE2_TP = [0.5, 1.0, 2.0, None]
STAGE2_SL = [0.5, 1.0, 2.0]
STAGE2_ALT = [dict(unit="pips", tp=5.0, sl=5.0), dict(unit="pips", tp=10.0, sl=10.0),
              dict(unit="vol", tp=1.0, sl=1.0), dict(unit="vol", tp=2.0, sl=2.0)]
STAGE2_MIN_N = 300                                     # raw-pool IS trades to be a leader

# Final candidates, fixed from the IS trial log before any OOS evaluation (see report):
# the best stage-2 configuration (IS raw-pool net pips/trade) of each signal family.
FINAL: list[dict] = [
    dict(name="ny_bigmove_cont",
         spec=dict(fam="big", k=5, m=6.0, session="ny", mode="cont"),
         exit=dict(unit="scale", tp=None, sl=1.0, hold=30.0), pairs=RAW,
         rule="NY 08:00-12:00 ET（08:28-08:44 と 09:58-10:04 ET は除く）に、直近5分の終値変化が"
              "その直前120本の1分足変化の標準偏差×√5 の6倍を超えたら、その方向に次の M1 足の始値で成行。"
              "損切り = その5分間の動きの幅（2〜60 pips にクリップ）、利確なし、30分で時間決済。"
              "一連の急変の最初の1回だけ（15本クールダウン）。",
         why="ステージ1の62通りで唯一 IS コスト込みがプラス（+1.39 pips、t=1.47）。ステージ2の出口格子で最良"
             "（+1.80 pips、t=1.63、日次t=1.12）。ただし t 値は弱く、EURUSD（+4.8）頼みで AUDUSD はマイナス。"),
    dict(name="nfp_fade",
         spec=dict(fam="news", k=2, subset="nfp", mode="rev"),
         exit=dict(unit="scale", tp=2.0, sl=2.0, hold=60.0), pairs=RAW, news_sensitive=True,
         rule="毎月第1金曜（雇用統計の代理）に、08:29 ET 足の終値から 08:31 ET 足の終値までの2分間の動きと"
              "逆方向に 08:32 の始値で成行。利確・損切り = その2分間の動きの2倍（損切り 2〜60 pips、"
              "利確 1〜150 pips にクリップ）、60分で時間決済。",
         why="ニュース族で IS 最良（+1.58 pips、t=1.44）。ただし IS でも指標時刻コスト3倍で -2.66、5倍で -7.21 "
             "pips。課題の本来の仮説である「最初の1-2分の動きへの順張り」は IS の摩擦ゼロでも -1.9〜-2.0 pips。"),
    dict(name="london_orb30",
         spec=dict(fam="orb", session="ldn0800", orn=30, mode="cont"),
         exit=dict(unit="scale", tp=None, sl=1.0, hold=120.0), pairs=RAW,
         rule="ロンドン時間 08:00-08:30 の高値・安値をレンジとし、08:30-10:30 に M1 終値がレンジの外で引けた"
              "最初の足の方向に次の足の始値で成行（1日1回）。損切り = レンジ幅（2〜60 pips）、利確なし、"
              "120分で時間決済。",
         why="ORB 族で IS 最良（ステージ1 -1.20 pips、ステージ2の最良出口で -0.84 pips、t=-4.0）。IS の時点で"
             "マイナスなので不合格は確定しているが、代表的な高速ブレイクアウト手法として OOS と遅延の影響を示す。"),
]


# ----------------------------------------------------------------------------- specs
def stage1_specs() -> list[dict]:
    out = []
    for s in ["tok0900", "ldn0800", "ny0800", "ny0930"]:
        for n in [5, 15, 30]:
            out.append(dict(fam="orb", session=s, orn=n, mode="cont"))
    for n in [1, 5]:
        out.append(dict(fam="orb", session="ny0830", orn=n, mode="cont"))
    for k in [1, 3, 5]:
        for m in [4.0, 6.0]:
            for s in ["tokyo", "london", "ny"]:
                for mode in ["cont", "rev"]:
                    out.append(dict(fam="big", k=k, m=m, session=s, mode=mode))
    for k in [1, 2]:
        for sub in ["nfp", "other_big", "other_all"]:
            for mode in ["cont", "rev"]:
                out.append(dict(fam="news", k=k, subset=sub, mode=mode))
    return out


def sig_name(spec: dict) -> str:
    if spec["fam"] == "orb":
        return f"orb_{spec['session']}_or{spec['orn']}_{spec['mode']}"
    if spec["fam"] == "big":
        return f"big_k{spec['k']}_m{spec['m']:g}_{spec['session']}_{spec['mode']}"
    return f"news_k{spec['k']}_{spec['subset']}_{spec['mode']}"


def exit_name(ex: dict) -> str:
    tp = "none" if ex["tp"] is None else f"{ex['tp']:g}"
    return f"{ex['unit']}_tp{tp}_sl{ex['sl']:g}_h{ex['hold']:g}"


# ----------------------------------------------------------------------------- features
class Feat:
    """Per-pair arrays shared by all signal builders (all trailing / causal)."""

    def __init__(self, m1: pd.DataFrame, sym: str):
        self.m1, self.sym = m1, sym
        self.pip = INSTRUMENTS[sym].pip
        self.t = m1.index.as_unit("ns").asi8
        self.o, self.h, self.l, self.c = (m1[k].to_numpy(float) for k in
                                          ("open", "high", "low", "close"))
        self.n = len(self.t)
        d1 = np.diff(self.c, prepend=np.nan)
        d1[np.diff(self.t, prepend=self.t[0] - NS_MIN) != NS_MIN] = np.nan
        # std of 1-minute changes over the VOL_N bars ending at (and including) bar i
        self.vol1 = pd.Series(d1).rolling(VOL_N, min_periods=VOL_N * 3 // 4).std().to_numpy()
        self._loc: dict = {}

    def local(self, key: str):
        """(minute of day, day number, weekday Mon=0) on a local clock; -1 where ambiguous."""
        if key not in self._loc:
            lt = scalp.local_time(self.m1.index, TZ[key])
            a = lt.as_unit("ns").asi8
            nat = a == np.iinfo(np.int64).min
            mins = np.floor_divide(a, NS_MIN)
            day = np.floor_divide(mins, 1440)
            mod = (mins - day * 1440).astype(np.int32)
            mod[nat], day[nat] = -1, -1
            wd = ((day + 3) % 7).astype(np.int8)             # 1970-01-01 was a Thursday
            wd[nat] = 9
            self._loc[key] = (mod, day, wd)
        return self._loc[key]


def _empty():
    return dict(pos=np.zeros(0, np.int64), dir=np.zeros(0, np.int8), scale=np.zeros(0),
                vol15=np.zeros(0))


def sig_orb(F: Feat, spec: dict) -> dict:
    key, S = ORB_SESSIONS[spec["session"]]
    n, win = spec["orn"], spec.get("win", ORB_WIN)
    mod, day, wd = F.local(key)
    wk = wd < 5
    io = np.flatnonzero((mod >= S) & (mod < S + n) & wk)
    if not len(io):
        return _empty()
    d_or = day[io]
    start = np.flatnonzero(np.r_[True, d_or[1:] != d_or[:-1]])
    ud = d_or[start]
    orh = np.maximum.reduceat(F.h[io], start)
    orl = np.minimum.reduceat(F.l[io], start)
    cnt = np.diff(np.r_[start, len(io)])
    good = cnt >= max(1, math.ceil(0.8 * n))                # range needs >= 80% of its bars
    iw = np.flatnonzero((mod >= S + n) & (mod < S + n + win) & wk)
    k = np.clip(np.searchsorted(ud, day[iw]), 0, len(ud) - 1)
    valid = (ud[k] == day[iw]) & good[k]
    cw = F.c[iw]
    dr = np.where(cw > orh[k], 1, np.where(cw < orl[k], -1, 0))
    f = valid & (dr != 0)
    fi, fk, fdr = iw[f], k[f], dr[f]
    _, first = np.unique(fk, return_index=True)             # first breakout of each day
    pos, d = fi[first], fdr[first].astype(np.int8)
    if spec["mode"] == "fade":
        d = -d
    return dict(pos=pos.astype(np.int64), dir=d, scale=(orh - orl)[fk[first]] / F.pip,
                vol15=F.vol1[pos] * math.sqrt(15) / F.pip)


def sig_big(F: Feat, spec: dict) -> dict:
    k, m = spec["k"], spec["m"]
    key, ranges = BIG_SESSIONS[spec["session"]]
    mod, day, wd = F.local(key)
    mask = np.zeros(F.n, bool)
    for a, b in ranges:
        mask |= (mod >= a) & (mod < b)
    mask &= wd < 5
    dk = np.full(F.n, np.nan)
    dk[k:] = F.c[k:] - F.c[:-k]
    cont = np.zeros(F.n, bool)
    cont[k:] = (F.t[k:] - F.t[:-k]) == k * NS_MIN
    vpre = np.full(F.n, np.nan)
    vpre[k:] = F.vol1[:-k]                                 # volatility before the move
    with np.errstate(divide="ignore", invalid="ignore"):
        z = dk / (vpre * math.sqrt(k))
    fire = mask & cont & np.isfinite(z) & (np.abs(z) > m)
    p = np.flatnonzero(fire)
    if not len(p):
        return _empty()
    p = p[np.r_[True, np.diff(p) > COOL]]                  # first bar of each cluster
    d = np.sign(dk[p]).astype(np.int8)
    if spec["mode"] == "rev":
        d = -d
    return dict(pos=p.astype(np.int64), dir=d, scale=np.abs(dk[p]) / F.pip,
                vol15=vpre[p] * math.sqrt(15) / F.pip)


def sig_news(F: Feat, spec: dict) -> dict:
    k = spec["k"]
    mod, day, wd = F.local("ny")
    p = np.flatnonzero((mod == 8 * 60 + 30 + k - 1) & (wd < 5))
    p = p[p >= k]
    ref = p - k
    ok = (mod[ref] == 8 * 60 + 29) & (day[ref] == day[p]) & (F.t[p] - F.t[ref] == k * NS_MIN)
    p, ref = p[ok], ref[ok]
    move = F.c[p] - F.c[ref]
    vol = F.vol1[ref]
    with np.errstate(divide="ignore", invalid="ignore"):
        z = move / (vol * math.sqrt(k))
    dom = pd.DatetimeIndex(day[p].astype("datetime64[D]")).day.to_numpy()
    nfp = (wd[p] == 4) & (dom <= 7)
    sub = spec["subset"]
    if sub == "nfp":
        sel = nfp & (move != 0)
    elif sub == "other_big":
        sel = ~nfp & np.isfinite(z) & (np.abs(z) > 3.0)
    elif sub == "other_all":
        sel = ~nfp & (move != 0)
    else:
        raise ValueError(sub)
    p, move, vol = p[sel], move[sel], vol[sel]
    d = np.sign(move).astype(np.int8)
    if spec["mode"] == "rev":
        d = -d
    return dict(pos=p.astype(np.int64), dir=d, scale=np.abs(move) / F.pip,
                vol15=vol * math.sqrt(15) / F.pip)


SIG_FUN = {"orb": sig_orb, "big": sig_big, "news": sig_news}


def raw_signal(F: Feat, spec: dict) -> dict:
    return SIG_FUN[spec["fam"]](F, spec)


def build_signals(F: Feat, raw: dict, ex: dict, delay: int = 0) -> pd.DataFrame:
    unit = ex["unit"]
    if unit == "pips":
        tp = np.full(len(raw["pos"]), np.nan if ex["tp"] is None else float(ex["tp"]))
        sl = np.full(len(raw["pos"]), float(ex["sl"]))
    else:
        base = raw["scale"] if unit == "scale" else raw["vol15"]
        tp = (np.full(len(base), np.nan) if ex["tp"] is None
              else np.clip(ex["tp"] * base, *TP_CLIP))
        sl = np.clip(ex["sl"] * base, *SL_CLIP)
    p = raw["pos"] + delay
    ok = (p < F.n) & np.isfinite(sl)
    return pd.DataFrame({"dir": raw["dir"][ok], "tp": tp[ok], "sl": sl[ok],
                         "hold": float(ex["hold"])}, index=F.m1.index[p[ok]])


def news_window_mask(index: pd.DatetimeIndex) -> np.ndarray:
    """True for server-time stamps whose NY clock is inside a release window."""
    ny = index - pd.Timedelta(hours=7)                     # server = New York + 7h
    mod = ny.hour.to_numpy() * 60 + ny.minute.to_numpy()
    m = np.zeros(len(index), bool)
    for a, b in NEWS_WINDOWS_ET:
        m |= (mod >= a) & (mod < b)
    return m


def fwd_returns(F: Feat, sig: pd.DataFrame) -> dict:
    """Mean mid move in the signal direction h minutes after the next-bar open (frictionless,
    every signal, overlapping allowed)."""
    p = F.m1.index.get_indexer(sig.index) + 1
    keep = p < F.n
    p, d = p[keep], sig["dir"].to_numpy()[keep]
    out = {}
    for h in FWD_H:
        j = np.searchsorted(F.t, F.t[p] + (h - 1) * NS_MIN, side="right") - 1
        out[f"fwd{h}"] = float(np.mean(d * (F.c[j] - F.o[p]) / F.pip)) if len(p) else float("nan")
    return out


# ------------------------------------------------------------------------ aggregation
def moments(tr: pd.DataFrame, prefix: str = "") -> dict:
    net = tr["net_pips"].to_numpy()
    return {f"{prefix}n": int(len(net)), f"{prefix}s": float(net.sum()),
            f"{prefix}ss": float((net ** 2).sum()), f"{prefix}w": int((net > 0).sum()),
            f"{prefix}g": float(tr["gross_pips"].sum()), f"{prefix}min": float(tr["minutes"].sum())}


def day_sums(tr: pd.DataFrame) -> pd.Series:
    return tr.groupby(tr.entry_time.dt.normalize()).net_pips.sum()


def clustered_t(ds: list[pd.Series]) -> float:
    """t-stat of per-calendar-day net pips summed across pairs (cross-pair correlation)."""
    ds = [d for d in ds if len(d)]
    if not ds:
        return float("nan")
    s = pd.concat(ds, axis=1, sort=True).fillna(0.0).sum(axis=1).to_numpy()
    if len(s) < 3 or s.std(ddof=1) == 0:
        return float("nan")
    return float(s.mean() / s.std(ddof=1) * math.sqrt(len(s)))


def pooled(ms: list[dict]) -> dict:
    n = sum(m["n"] for m in ms)
    if n < 2:
        return {"n": n}
    s, ss = sum(m["s"] for m in ms), sum(m["ss"] for m in ms)
    mean = s / n
    sd = math.sqrt(max(ss - n * mean * mean, 0.0) / (n - 1))
    out = {"n": n, "avg_net": mean, "t": mean / sd * math.sqrt(n) if sd > 0 else float("nan"),
           "win": sum(m["w"] for m in ms) / n, "avg_gross_spread": sum(m["g"] for m in ms) / n,
           "avg_min": sum(m["min"] for m in ms) / n}
    for pre, lab in [("f_", "frictionless"), ("c3_", "cost3"), ("c5_", "cost5")]:
        if all(f"{pre}n" in m for m in ms):
            nn = sum(m[f"{pre}n"] for m in ms)
            key = "f_g" if pre == "f_" else f"{pre}s"
            out[f"avg_{lab}"] = sum(m[key] for m in ms) / max(nn, 1)
            if pre == "f_":
                out["win_frictionless"] = sum(m["f_gw"] for m in ms) / max(nn, 1)
    if "avg_frictionless" in out:
        out["cost_eaten"] = out["avg_frictionless"] - mean
    fw = [k for k in ms[0] if k.startswith("fwd")]
    ns = np.array([m.get("n_signals", 0) for m in ms], float)
    for k in fw:
        v = np.array([m.get(k, np.nan) for m in ms], float)
        ok = np.isfinite(v) & (ns > 0)
        out[k] = float((v[ok] * ns[ok]).sum() / ns[ok].sum()) if ok.any() else float("nan")
    return out


def summarize(tr: pd.DataFrame) -> dict:
    s = scalp.stats(tr) if len(tr) else {"n": 0}
    keep = ["n", "trades_per_year", "win_rate", "avg_net_pips", "avg_gross_pips", "t_stat",
            "profit_factor", "total_net_pips", "avg_minutes"]
    return {k: s.get(k, float("nan")) for k in keep}


# ------------------------------------------------------------------------ IS stages
def _load(sym: str, start, end) -> pd.DataFrame:
    return scalp.load(sym, start=start, end=end)[["open", "high", "low", "close"]].astype("float64")


def _eval_pair_is(args):
    sym, cfgs = args
    t0 = time.time()
    F = Feat(_load(sym, IS_START, IS_END), sym)
    cache: dict = {}
    res = []
    for cfg in cfgs:
        spec, ex = cfg["spec"], cfg["exit"]
        nm = sig_name(spec)
        if nm not in cache:
            cache[nm] = raw_signal(F, spec)
        sig = build_signals(F, cache[nm], ex)
        tr1 = scalp.simulate(F.m1, sig, sym, cost_mult=1.0)
        tr0 = scalp.simulate(F.m1, sig, sym, cost_mult=0.0)
        m = moments(tr1)
        m.update({"f_n": int(len(tr0)), "f_g": float(tr0.gross_pips.sum()),
                  "f_gw": int((tr0.gross_pips > 0).sum()), "n_signals": int(len(sig))})
        if spec["fam"] == "news":
            for cm, pre in [(3.0, "c3_"), (5.0, "c5_")]:
                trc = scalp.simulate(F.m1, sig, sym, cost_mult=cm)
                m.update({f"{pre}n": int(len(trc)), f"{pre}s": float(trc.net_pips.sum())})
        if cfg.get("fwd"):
            m.update(fwd_returns(F, sig))
        m["_days"] = day_sums(tr1)
        res.append(m)
    print(f"  {sym}: {len(cfgs)} configs in {time.time() - t0:.0f}s", flush=True)
    return sym, res


def run_is(cfgs: list[dict], stage: str) -> pd.DataFrame:
    pairs = RAW + SYN
    with ProcessPoolExecutor(WORKERS) as ex:
        out = dict(ex.map(_eval_pair_is, [(s, cfgs) for s in pairs]))
    rows = []
    for i, cfg in enumerate(cfgs):
        per = {s: out[s][i] for s in pairs}
        raw, syn = pooled([per[s] for s in RAW]), pooled([per[s] for s in SYN])
        raw["t_day_clustered"] = clustered_t([per[s]["_days"] for s in RAW])
        raw["n_pairs_positive"] = int(sum(per[s]["n"] > 0 and per[s]["s"] > 0 for s in RAW))
        per_pair = {}
        for s in pairs:
            p = pooled([per[s]])
            p["n_signals"] = per[s]["n_signals"]
            per_pair[s] = p
        params = {"stage": stage, "signal": sig_name(cfg["spec"]), "exit": exit_name(cfg["exit"]),
                  **cfg["spec"], **{f"x_{k}": v for k, v in cfg["exit"].items()}}
        LOG.log(params, {"raw_pool": raw, "syn_pool": syn, "per_pair": per_pair}, period="is")
        rows.append({**params, **{f"raw_{k}": v for k, v in raw.items()},
                     **{f"syn_{k}": v for k, v in syn.items()}})
    return pd.DataFrame(rows)


def stage1():
    cfgs = [dict(spec=s, exit=STAGE1_EXIT[s["fam"]], fwd=True) for s in stage1_specs()]
    df = run_is(cfgs, "s1")
    cols = ["signal", "raw_n", "raw_win", "raw_avg_frictionless", "raw_avg_net", "raw_t",
            "raw_t_day_clustered", "raw_n_pairs_positive", "raw_fwd1", "raw_fwd5", "raw_fwd15",
            "raw_fwd60", "syn_avg_net"]
    with pd.option_context("display.width", 250, "display.max_rows", 200):
        print(df[cols].sort_values("raw_avg_net", ascending=False).round(3).to_string())


def load_log(stage: str | None = None) -> pd.DataFrame:
    if not LOG.path.exists():
        return pd.DataFrame()
    rows = []
    for line in open(LOG.path):
        r = json.loads(line)
        if r.get("period") != "is" or (stage and r["params"].get("stage") != stage):
            continue
        row = dict(r["params"])
        for pool in ("raw_pool", "syn_pool"):
            for k, v in r["metrics"][pool].items():
                row[f"{pool[:3]}_{k}"] = v
        for s, p in r["metrics"]["per_pair"].items():
            for k, v in p.items():
                row[f"{s}_{k}"] = v
        rows.append(row)
    df = pd.DataFrame(rows)
    return df.drop_duplicates(subset=["stage", "signal", "exit"], keep="last") if len(df) else df


def spec_from_row(r: dict) -> dict:
    keys = {"orb": ["fam", "session", "orn", "mode"], "big": ["fam", "k", "m", "session", "mode"],
            "news": ["fam", "k", "subset", "mode"]}[r["fam"]]
    out = {}
    for k in keys:
        v = r[k]
        out[k] = int(v) if k in ("orn", "k") else (float(v) if k == "m" else v)
    return out


def stage2_leaders(s1: pd.DataFrame) -> pd.DataFrame:
    ok = s1[s1.raw_n >= STAGE2_MIN_N].sort_values("raw_avg_net", ascending=False)
    lead = [ok[ok.fam == f].head(1) for f in ("orb", "big", "news")]
    lead = pd.concat(lead)
    rest = ok[~ok.signal.isin(lead.signal)].head(1)
    return pd.concat([lead, rest])


def stage2():
    s1 = load_log("s1")
    lead = stage2_leaders(s1)
    print("stage-2 leaders:\n", lead[["signal", "raw_n", "raw_avg_net", "raw_t",
                                      "raw_avg_frictionless"]].to_string())
    cfgs = []
    for r in lead.to_dict("records"):
        spec = spec_from_row(r)
        for hd in STAGE2_HOLDS[spec["fam"]]:
            for tp in STAGE2_TP:
                for sl in STAGE2_SL:
                    cfgs.append(dict(spec=spec, exit=dict(unit="scale", tp=tp, sl=sl, hold=hd)))
        for alt in STAGE2_ALT:
            cfgs.append(dict(spec=spec, exit=dict(alt, hold=STAGE1_EXIT[spec["fam"]]["hold"])))
    df = run_is(cfgs, "s2")
    cols = ["signal", "exit", "raw_n", "raw_win", "raw_avg_frictionless", "raw_avg_net",
            "raw_t", "raw_t_day_clustered", "raw_n_pairs_positive", "syn_avg_net"]
    with pd.option_context("display.width", 250, "display.max_rows", 200):
        print(df[cols].sort_values("raw_avg_net", ascending=False).round(3).to_string())


# ------------------------------------------------------------------------ final
def random_baseline(F: Feat, sig: pd.DataFrame, seed=11) -> pd.DataFrame:
    """Random entry minutes from the candidate's own server hours, random direction, same
    TP/SL distribution and hold: what the costs alone do to this trade shape."""
    rng = np.random.default_rng(seed)
    hrs = sorted(set(sig.index.hour))
    ok = np.flatnonzero(np.isin(F.m1.index.hour, hrs))[:-1]
    size = min(len(ok), 4 * len(sig) + 1000)
    pick = np.sort(rng.choice(ok, size=size, replace=False))
    j = rng.integers(0, len(sig), size=size)
    return pd.DataFrame({"dir": rng.choice([-1, 1], size=size), "tp": sig["tp"].to_numpy()[j],
                         "sl": sig["sl"].to_numpy()[j], "hold": sig["hold"].iloc[0]},
                        index=F.m1.index[pick])


def _sim_news_stress(F: Feat, sig: pd.DataFrame, sym: str, cm: float) -> pd.DataFrame:
    """cost_mult cm for signals entered inside a release window, 1.0 for the rest."""
    nw = news_window_mask(sig.index + pd.Timedelta(minutes=1))
    parts = [scalp.simulate(F.m1, sig[nw], sym, cost_mult=cm),
             scalp.simulate(F.m1, sig[~nw], sym, cost_mult=1.0)]
    parts = [p for p in parts if len(p)]
    if not parts:
        return scalp.simulate(F.m1, sig, sym, cost_mult=1.0)
    return pd.concat(parts, ignore_index=True).sort_values("entry_time", ignore_index=True)


def _eval_pair_final(args):
    sym, cand = args
    F = Feat(_load(sym, IS_START, OOS_END), sym)
    raw = raw_signal(F, cand["spec"])
    sig = build_signals(F, raw, cand["exit"])
    runs = {}
    for name, cm, dl in [("base", 1.0, 0), ("cost1.5", 1.5, 0), ("cost2", 2.0, 0),
                         ("cost3", 3.0, 0), ("frictionless", 0.0, 0), ("delay1", 1.0, 1),
                         ("delay2", 1.0, 2)]:
        s = sig if dl == 0 else build_signals(F, raw, cand["exit"], delay=dl)
        runs[name] = scalp.simulate(F.m1, s, sym, cost_mult=cm)
    for cm in (3.0, 5.0):
        runs[f"news{cm:g}"] = _sim_news_stress(F, sig, sym, cm)
    runs["random"] = scalp.simulate(F.m1, random_baseline(F, sig), sym, cost_mult=1.0)
    runs["_fwd"] = {"is": fwd_returns(F, sig[sig.index < IS_END]),
                    "oos": fwd_returns(F, sig[sig.index >= IS_END])}
    return sym, runs


def final():
    if not FINAL:
        raise SystemExit("FINAL is empty: run --stage 1 / --stage 2 and fix the candidates")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    logged = set()
    if LOG.path.exists():
        for line in open(LOG.path):
            r = json.loads(line)
            if r.get("period") == "final":
                logged.add((r["params"].get("name"), r["params"].get("pair")))
    results = {}
    for cand in FINAL:
        with ProcessPoolExecutor(WORKERS) as ex:
            out = dict(ex.map(_eval_pair_final, [(s, cand) for s in cand["pairs"]]))
        keys = [k for k in out[cand["pairs"][0]] if not k.startswith("_")]
        runs = {k: pd.concat([out[s][k] for s in cand["pairs"]], ignore_index=True) for k in keys}
        runs["_fwd"] = {s: out[s]["_fwd"] for s in cand["pairs"]}
        runs["base"].to_parquet(OUT_DIR / f"trades_{KEY}_{cand['name']}.parquet")
        results[cand["name"]] = (cand, runs)
        for s in cand["pairs"]:
            b = out[s]["base"]
            if (cand["name"], s) in logged:                # rerun: do not duplicate records
                continue
            LOG.log({"name": cand["name"], "signal": sig_name(cand["spec"]),
                     "exit": exit_name(cand["exit"]), "pair": s},
                    {"is": summarize(b[b.entry_time < IS_END]),
                     "oos": summarize(b[b.entry_time >= IS_END])}, period="final")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE, "wb") as fh:
        pickle.dump(results, fh)
    write_report(results)


def report_only():
    with open(CACHE, "rb") as fh:
        results = pickle.load(fh)
    write_report(results)


def _split(tr):
    return tr[tr.entry_time < IS_END], tr[tr.entry_time >= IS_END]


def verdict(runs) -> dict:
    ins, oos = _split(runs["base"])
    s_is, s_oos = summarize(ins), summarize(oos)
    oos15 = _split(runs["cost1.5"])[1]
    yr = oos.groupby(oos.entry_time.dt.year).net_pips.sum()
    drop = oos[oos.entry_time.dt.year != yr.idxmax()] if len(yr) else oos
    checks = {
        "IS 平均ネット > 0": s_is.get("avg_net_pips", -1) > 0,
        "OOS 平均ネット > 0": s_oos.get("avg_net_pips", -1) > 0,
        "OOS t値 >= 2.0": s_oos.get("t_stat", 0) >= 2.0,
        "OOS 取引数 >= 200": s_oos["n"] >= 200,
        "OOS コスト1.5倍でも > 0": len(oos15) > 0 and oos15.net_pips.mean() > 0,
        "OOS 最良年を除いても > 0": len(drop) > 0 and drop.net_pips.mean() > 0,
    }
    return {"is": s_is, "oos": s_oos, "checks": checks, "survives": all(checks.values()),
            "drop_best_year": float(drop.net_pips.mean()) if len(drop) else float("nan"),
            "best_year": int(yr.idxmax()) if len(yr) else None,
            "t_day_oos": clustered_t([day_sums(oos)])}


def f(x, d=2):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    if isinstance(x, (int, np.integer)):
        return f"{x:,}"
    return f"{x:+.{d}f}"


def write_report(results):
    REPORT.write_text(report_text(results))
    print(REPORT.read_text())


# ------------------------------------------------------------------------ report
SES_JA = {"tok0900": "東京 09:00 JST", "ldn0800": "ロンドン 08:00（現地）",
          "ny0800": "NY 08:00 ET", "ny0930": "NY株式 09:30 ET", "ny0830": "米指標 08:30 ET",
          "tokyo": "東京 08-15時 JST", "london": "ロンドン 07-12時（現地）",
          "ny": "NY 08-12時 ET（08:28-08:44, 09:58-10:04 除く）"}
SUB_JA = {"nfp": "第1金曜（雇用統計の代理）", "other_big": "その他の日で3σ超の動き",
          "other_all": "その他の全営業日"}
MODE_JA = {"cont": "順張り", "rev": "逆張り", "fade": "逆張り"}


def sig_ja(r) -> str:
    fam = r["fam"]
    if fam == "orb":
        return f"ORB {SES_JA[r['session']]} 最初{int(r['orn'])}分のレンジ {MODE_JA[r['mode']]}"
    if fam == "big":
        return (f"急変 {int(r['k'])}分 >{r['m']:g}σ {SES_JA[r['session']]} {MODE_JA[r['mode']]}")
    return f"08:30 ET {int(r['k'])}分目の動き {SUB_JA[r['subset']]} {MODE_JA[r['mode']]}"


def exit_ja(ex: dict) -> str:
    unit = {"scale": "×幅", "pips": "pips", "vol": "×σ15"}[ex["unit"]]
    tp = "なし" if ex["tp"] is None or (isinstance(ex["tp"], float) and not np.isfinite(ex["tp"])) \
        else f"{ex['tp']:g}{unit}"
    return f"TP {tp} / SL {ex['sl']:g}{unit} / {ex['hold']:g}分"


def _row(name, tr):
    s = summarize(tr)
    if not s["n"]:
        return f"| {name} | 0 | - | - | - | - | - |"
    return (f"| {name} | {s['n']:,} | {s['trades_per_year']:.0f} | {s['win_rate']:.1%} "
            f"| {f(s['avg_gross_pips'])} | {f(s['avg_net_pips'])} | {s['t_stat']:+.2f} |")


def win_expectancy(tr) -> str:
    net = tr.net_pips
    w, lo = net[net > 0], net[net <= 0]
    if not len(w) or not len(lo):
        return "-"
    aw, al = w.mean(), -lo.mean()
    be = al / (aw + al)
    return (f"勝率 {len(w) / len(net):.1%}、平均利益 {aw:.2f} pips、平均損失 {al:.2f} pips → "
            f"損益分岐の勝率 {be:.1%}、期待値 {net.mean():+.2f} pips/回")


def stage1_table(s1: pd.DataFrame, fam: str) -> list[str]:
    d = s1[s1.fam == fam].sort_values("raw_avg_net", ascending=False)
    extra = " | コスト3倍 | コスト5倍" if fam == "news" else ""
    L = ["| シグナル | 取引数 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 | t値 | 日次t値 | 正のペア(6) "
         "| 1分後 | 5分後 | 15分後 | 60分後 | USDJPY(合成) コスト込み" + extra + " |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:" +
         ("|---:|---:|" if fam == "news" else "|")]
    for r in d.to_dict("records"):
        line = (f"| {sig_ja(r)} | {r['raw_n']:,} | {r['raw_win']:.0%} | {f(r['raw_avg_frictionless'])} "
                f"| {f(r['raw_avg_net'])} | {r['raw_t']:+.1f} | {f(r['raw_t_day_clustered'], 1)} "
                f"| {int(r['raw_n_pairs_positive'])} | {f(r['raw_fwd1'])} | {f(r['raw_fwd5'])} "
                f"| {f(r['raw_fwd15'])} | {f(r['raw_fwd60'])} | {f(r.get('syn_avg_net'))}")
        if fam == "news":
            line += f" | {f(r.get('raw_avg_cost3'))} | {f(r.get('raw_avg_cost5'))}"
        L.append(line + " |")
    return L


def stage2_table(s2: pd.DataFrame, top=20) -> list[str]:
    L = ["| シグナル | 出口 | 取引数 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 | t値 | 日次t値 | 正のペア(6) "
         "| USDJPY(合成) |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in s2.sort_values("raw_avg_net", ascending=False).head(top).to_dict("records"):
        ex = {"unit": r["x_unit"], "tp": r["x_tp"], "sl": r["x_sl"], "hold": r["x_hold"]}
        L.append(f"| {sig_ja(r)} | {exit_ja(ex)} | {r['raw_n']:,} | {r['raw_win']:.0%} "
                 f"| {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} | {r['raw_t']:+.1f} "
                 f"| {f(r['raw_t_day_clustered'], 1)} | {int(r['raw_n_pairs_positive'])} "
                 f"| {f(r.get('syn_avg_net'))} |")
    return L


def winrate_shape_table(s2: pd.DataFrame, signal: str) -> list[str]:
    d = s2[(s2.signal == signal) & (s2.x_unit == "scale")].copy()
    d = d.sort_values("raw_win", ascending=False)
    L = ["| 出口（TP/SL は幅の倍数） | 勝率(コスト込み) | 摩擦ゼロ勝率 | 摩擦ゼロ平均 | コスト込み平均 |",
         "|---|---:|---:|---:|---:|"]
    for r in d.to_dict("records"):
        ex = {"unit": r["x_unit"], "tp": r["x_tp"], "sl": r["x_sl"], "hold": r["x_hold"]}
        L.append(f"| {exit_ja(ex)} | {r['raw_win']:.1%} | {r['raw_win_frictionless']:.1%} "
                 f"| {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} |")
    return L


def candidate_section(cand, runs, v) -> list[str]:
    news = cand["spec"]["fam"] == "news" or cand.get("news_sensitive", False)
    L = [f"### 候補 {cand['name']}", "",
         f"* ルール: {cand['rule']}",
         f"* ペア: {', '.join(cand['pairs'])}",
         f"* 選定理由（IS のみ）: {cand['why']}", "",
         "| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス(スプレッド・滑り後、手数料前) | 平均ネット(pips) | t値 |",
         "|---|---:|---:|---:|---:|---:|---:|"]
    ins, oos = _split(runs["base"])
    L += [_row("IS 2005-2014（コスト1.0）", ins), _row("**OOS 2015-2020.5（コスト1.0）**", oos)]
    for k, lab in [("cost1.5", "OOS コスト1.5倍"), ("cost2", "OOS コスト2倍"),
                   ("cost3", "OOS 全取引コスト3倍"), ("news3", "OOS 指標時刻（08:28-08:44, 09:58-10:04 ET）だけコスト3倍"),
                   ("news5", "OOS 指標時刻だけコスト5倍"),
                   ("frictionless", "OOS 摩擦ゼロ（スプレッド・手数料・滑りなし）"),
                   ("delay1", "OOS エントリー1分遅れ"), ("delay2", "OOS エントリー2分遅れ"),
                   ("random", "OOS ランダム時刻・ランダム方向（同じ形・同じ時間帯）")]:
        L.append(_row(lab, _split(runs[k])[1]))
    L += ["", "IS 側の同じ比較:", "",
          "| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス | 平均ネット | t値 |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for k, lab in [("frictionless", "IS 摩擦ゼロ"), ("cost1.5", "IS コスト1.5倍"),
                   ("cost2", "IS コスト2倍"), ("news3", "IS 指標時刻だけコスト3倍"),
                   ("delay1", "IS 1分遅れ"), ("delay2", "IS 2分遅れ"), ("random", "IS ランダム")]:
        L.append(_row(lab, _split(runs[k])[0]))
    L += ["", "生き残り判定:", ""]
    for k, ok in v["checks"].items():
        L.append(f"* {'OK' if ok else 'NG'}: {k}")
    L += [f"* 最良年 {v['best_year']} を除いた OOS 平均: {f(v['drop_best_year'])} pips",
          f"* 参考: OOS の日次集計 t値（同じ日の複数ペアを1つにまとめた t値）: {f(v['t_day_oos'])}",
          f"* **判定: {'生き残り' if v['survives'] else '不合格'}**", ""]
    if news:
        L += ["* 注意: このルールは米指標の発表直後に取引します。実際のスプレッドは発表の瞬間に数倍〜十数倍に"
              "広がり、約定も滑りますが、シミュレーターは広げません。上の「指標時刻だけコスト3倍/5倍」の行を"
              "現実に近い値として見てください。", ""]
    L += ["年別（コスト1.0、全ペア合算）:", "",
          "| 年 | 区間 | 取引数 | 勝率 | 平均ネット | 合計ネット(pips) | 摩擦ゼロ平均 | 1分遅れ平均 |",
          "|---|---|---:|---:|---:|---:|---:|---:|"]
    base, fr, d1 = runs["base"], runs["frictionless"], runs["delay1"]
    fy = fr.groupby(fr.entry_time.dt.year).gross_pips.mean()
    dy = d1.groupby(d1.entry_time.dt.year).net_pips.mean()
    for y, g in base.groupby(base.entry_time.dt.year):
        L.append(f"| {y} | {'IS' if y < IS_END.year else 'OOS'} | {len(g):,} | {(g.net_pips > 0).mean():.0%} "
                 f"| {f(g.net_pips.mean())} | {g.net_pips.sum():+,.0f} | {f(fy.get(y, np.nan))} "
                 f"| {f(dy.get(y, np.nan))} |")
    L += ["", "ペア別:", "",
          "| ペア | IS 取引数 | IS 平均ネット | IS 摩擦ゼロ | OOS 取引数 | OOS 勝率 | OOS 平均ネット "
          "| OOS t値 | OOS 摩擦ゼロ | OOS 1分遅れ | OOS 2分遅れ |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for s in cand["pairs"]:
        bi, bo = _split(base[base.symbol == s])
        fi, fo = _split(fr[fr.symbol == s])
        do1 = _split(runs["delay1"][runs["delay1"].symbol == s])[1]
        do2 = _split(runs["delay2"][runs["delay2"].symbol == s])[1]
        so = summarize(bo)
        L.append(f"| {s} | {len(bi):,} | {f(bi.net_pips.mean())} | {f(fi.gross_pips.mean())} "
                 f"| {len(bo):,} | {so.get('win_rate', 0):.0%} | {f(so['avg_net_pips'])} "
                 f"| {f(so['t_stat'])} | {f(fo.gross_pips.mean())} | {f(do1.net_pips.mean())} "
                 f"| {f(do2.net_pips.mean())} |")
    fw = runs["_fwd"]
    L += ["", "シグナル後の仲値の動き（シグナル方向を正、摩擦ゼロ、全シグナル平均、pips）:", "",
          "| ペア | 区間 | " + " | ".join(f"{h}分後" for h in FWD_H) + " |",
          "|---|---|" + "---:|" * len(FWD_H)]
    for s in cand["pairs"]:
        for per in ("is", "oos"):
            L.append(f"| {s} | {per.upper()} | " +
                     " | ".join(f(fw[s][per].get(f'fwd{h}')) for h in FWD_H) + " |")
    L += ["", "勝率と期待値（OOS、コスト1.0）: " + win_expectancy(oos),
          "", "同じ形のランダム売買（OOS）: " + win_expectancy(_split(runs["random"])[1]), ""]
    return L


def delay_summary(results) -> list[str]:
    L = ["| 候補 | 区間 | 即時（次の足の始値） | 1分遅れ | 2分遅れ | 摩擦ゼロ(即時) |",
         "|---|---|---:|---:|---:|---:|"]
    for name, (cand, runs) in results.items():
        for i, per in enumerate(("IS", "OOS")):
            vals = [_split(runs[k])[i] for k in ("base", "delay1", "delay2")]
            fr = _split(runs["frictionless"])[i]
            L.append(f"| {name} | {per} | " + " | ".join(f(v.net_pips.mean()) for v in vals) +
                     f" | {f(fr.gross_pips.mean())} |")
    return L


def report_text(results) -> str:
    s1, s2 = load_log("s1"), load_log("s2")
    n_cfg = len(s1) + len(s2)
    L = [f"# 高速モメンタム／ブレイクアウト・スキャルピングの検証 — {KEY}", "",
         f"再現: `python scripts/scalp_{KEY}.py`（最終評価とこのレポート）、`--stage 1` / `--stage 2`"
         f"（IS 探索、試行ログ `reports/trials/scalp_{KEY}.jsonl` に追記）、`--report`（保存済みの最終結果から"
         "レポートだけ再生成）。", ""]
    L += REPORT_SUMMARY(results, s1, s2)
    L += ["", "## 1. 何を検証したか", "",
          "* データ: OANDA M1 仲値 2005-01〜2020-05-14。主証拠は実データの6ペア "
          f"({', '.join(RAW)})。USDJPY は EURJPY÷EURUSD から作った合成データで M1 の高値・安値が広すぎる"
          "（ランダム売買でも 0.25〜0.55 pips/回 余計に負ける）ため、参考として別欄に表示。XAUUSD は対象外。",
          "* 約定: fxlab/scalp.py（シグナル足の終値で判断し、次の M1 足の始値で成行。Titan FX ブレード相当の"
          "スプレッド×時間帯倍率、成行の滑り、損切りの追加滑り、手数料 720円/lot 往復、同一足内は損切り優先、"
          "1銘柄1ポジション）。**指標発表時のスプレッド拡大はモデル化されていない**ため、指標時刻に入る取引は"
          "コスト3倍・5倍で再計算した。",
          "* IS = 2005-2014 だけでルールと出口を選び、最終候補を OOS = 2015-2020.5 で1回だけ評価。",
          "* 3つのシグナル族（時刻は scalp.local_time で各市場の現地時刻に変換、夏時間を自動処理）:",
          "  * (a) **オープニングレンジ・ブレイク（ORB）**: 東京 09:00 JST、ロンドン 08:00（ロンドン時間）、"
          "NY 08:00 ET、NY株式 09:30 ET、米指標 08:30 ET の各時刻から最初の N 分（5/15/30分、08:30 は 1/5分）"
          "の高値・安値をレンジとし、その後120分以内に M1 終値がレンジの外で引けた最初の足で、抜けた方向に成行。"
          "1日1回。",
          f"  * (b) **急変足の順張り／逆張り**: 直近 k 分（1/3/5分）の終値変化が、その動きの直前 {VOL_N} 本の1分足変化の"
          "標準偏差×√k の m 倍（4/6倍）を超えたら、同じ方向（順張り）または逆方向（逆張り）に成行。"
          f"時間帯は東京 08-15時 JST、ロンドン 07-12時、NY 08-12時 ET（指標時刻は (c) で扱うため除外）。"
          f"一連の急変の最初の1本だけ（{COOL}本クールダウン）。",
          "  * (c) **指標カレンダーなしのニュース代理**: 08:30 ET（米国の主要指標とカナダ指標の発表時刻）の"
          "08:29 終値からの動き（k=1: 08:30 足の終値、k=2: 08:31 足の終値）。第1金曜（雇用統計の代理）、"
          "その他の日で |z|>3（何か発表があった日の代理）、その他の全営業日、の3通り × 順張り／逆張り。",
          "* 出口: TP / SL / 時間切れ。TP・SL の単位は「幅」（ORB はレンジ幅、急変とニュースは動きの大きさ）の倍数"
          f"（SL は {SL_CLIP[0]:g}〜{SL_CLIP[1]:g} pips、TP は {TP_CLIP[0]:g}〜{TP_CLIP[1]:g} pips にクリップ）、"
          "固定 pips、または直前のボラティリティ σ15（1分足変化の標準偏差×√15）の倍数。",
          f"* 試した設定数: ステージ1 {len(s1)} 通り（出口は族ごとに固定: ORB は TP1×/SL1×/60分、急変とニュースは"
          f"TP1×/SL1×/30分）＋ ステージ2 {len(s2)} 通り（各族の IS 最良シグナルと次点1つ × TP{{0.5,1,2,なし}}×"
          f"SL{{0.5,1,2}}×保有2通り ＋ 別単位4通り）＝ **{n_cfg} 通り**。各設定を実6ペア＋USDJPY(合成)で評価。",
          "* 「摩擦ゼロ」= cost_mult=0（スプレッド・滑り・手数料なし、仲値で約定）＝ コスト前のグロスエッジ。"
          "「日次t値」= 同じ日の全ペアの損益を1つにまとめた t値（指標で全ドルペアが同時に動くときの重複を除く）。"
          "「1分後/5分後…」= シグナル足の次の足の始値から h 分後の終値までの仲値の動き（シグナル方向を正、全シグナル）。",
          "", "## 2. ステージ1: コスト前にエッジはあるか（IS 2005-2014、実6ペア合算）", "",
          "### (a) オープニングレンジ・ブレイク（出口 TP 1×レンジ幅 / SL 1×レンジ幅 / 60分）", ""]
    L += stage1_table(s1, "orb")
    L += ["", "### (b) 急変足の順張り／逆張り（出口 TP 1×動き / SL 1×動き / 30分）", ""]
    L += stage1_table(s1, "big")
    L += ["", "### (c) 08:30 ET ニュース代理（出口 TP 1×動き / SL 1×動き / 30分）", ""]
    L += stage1_table(s1, "news")
    L += ["", "## 3. ステージ2: 出口の格子（IS、上位20件）", ""]
    L += stage2_table(s2)
    L += REPORT_WINRATE(results, s1, s2)
    L += ["", "## 4. 最終候補（OOS は1回だけ評価）", ""]
    for name, (cand, runs) in results.items():
        L += candidate_section(cand, runs, verdict(runs))
    L += ["## 5. 速度はどれだけ効くか（エントリーを1分・2分遅らせた場合、平均ネット pips/回）", ""]
    L += delay_summary(results)
    L += REPORT_DISCUSSION(results, s1, s2)
    return "\n".join(L) + "\n"


def _cost_by_pair(s1: pd.DataFrame) -> str:
    return "、".join(f"{s} {(s1[f'{s}_avg_frictionless'] - s1[f'{s}_avg_net']).median():.1f}"
                    for s in RAW)


def REPORT_SUMMARY(results, s1, s2) -> list[str]:  # conclusions, written after the runs
    allc = pd.concat([s1, s2])
    vs = {n: verdict(r) for n, (c, r) in results.items()}
    n_surv = sum(v["survives"] for v in vs.values())
    L = [f"## 結論: 生き残り {n_surv} / {len(results)}。高速モメンタム／ブレイクアウト・スキャルピングに、"
         "コストを払った後のエッジは見つからなかった", "",
         "| 候補 | IS 平均ネット | OOS 取引数 | OOS 勝率 | OOS 平均ネット | OOS t値 | OOS コスト1.5倍 "
         "| OOS 最良年除外 | OOS 1分遅れ | OOS 2分遅れ | OOS 摩擦ゼロ | 判定 |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for name, (cand, runs) in results.items():
        v = vs[name]
        o = lambda k: _split(runs[k])[1]  # noqa: E731
        L.append(f"| {name} | {f(v['is']['avg_net_pips'])} | {v['oos']['n']:,} | {v['oos']['win_rate']:.0%} "
                 f"| {f(v['oos']['avg_net_pips'])} | {f(v['oos']['t_stat'])} "
                 f"| {f(o('cost1.5').net_pips.mean())} | {f(v['drop_best_year'])} "
                 f"| {f(o('delay1').net_pips.mean())} | {f(o('delay2').net_pips.mean())} "
                 f"| {f(o('frictionless').gross_pips.mean())} "
                 f"| {'生き残り' if v['survives'] else '不合格'} |")
    ny, nfp, orb = (results.get(k, (None, None))[1] for k in
                    ("ny_bigmove_cont", "nfp_fade", "london_orb30"))
    L += ["",
          f"* IS で試した {len(allc)} 通りのうち、コスト込みで IS がプラスだったのは {(allc.raw_avg_net > 0).sum()} 通り"
          f"（ほぼすべて「NY の5分急変への順張り」と「雇用統計の2分目の逆張り」の出口違い）。最良の t値でも "
          f"{allc.raw_t.max():.2f} で、{len(allc)} 通りから一番良いものを選べば偶然でも出る水準。",
          "* その IS 最良の2つは OOS で大きくマイナスに反転した（下の表）。**IS で選んだ「勝ちルール」が OOS で"
          "逆になる、典型的な選択バイアス（過剰適合）**。",
          f"* **コストの壁**: Titan FX ブレード相当で、1回あたり平均 約{allc.raw_cost_eaten.median():.1f} pips"
          f"（ステージ1の中央値。ペア別: {_cost_by_pair(s1)} pips。スプレッド＋滑り＋手数料）。"
          f"コスト前（摩擦ゼロ）の平均が {allc.raw_cost_eaten.median():.1f} pips を超えた設定は "
          f"{(allc.raw_avg_frictionless > allc.raw_cost_eaten.median()).sum()} / {len(allc)} 通りだけで、"
          "どれも OOS で再現しなかった。"]
    if orb is not None:
        fi, fo = (_split(orb["frictionless"])[i] for i in (0, 1))
        L.append(f"* 本物の偏りはある。ロンドン 08:00-08:30 のレンジ・ブレイクは、コスト前なら IS "
                 f"{f(fi.gross_pips.mean())} pips（{len(fi):,}回）、OOS {f(fo.gross_pips.mean())} pips（{len(fo):,}回）と"
                 "両期間でプラス。ただし大きさはコストの 1/4〜1/2 しかなく、コスト込みでは IS も OOS もマイナス。")
    news_rows = s1[(s1.fam == "news") & (s1["mode"] == "cont")]
    nf = news_rows[news_rows.subset == "nfp"].raw_avg_frictionless
    ot = news_rows[news_rows.subset != "nfp"].raw_avg_frictionless
    L.append(f"* 指標（08:30 ET）の「最初の1-2分の動きに乗る」は、コスト前でもゼロかマイナス（雇用統計の日 "
             f"{nf.min():+.1f}〜{nf.max():+.1f} pips、その他の日 {ot.min():+.1f}〜{ot.max():+.1f} pips、IS）。"
             "発表直後は実際のスプレッドが広がるので、コスト3倍・5倍ではさらに悪い（ステージ1の (c) 表）。")
    if ny is not None:
        a = [_split(ny[k])[1].net_pips.mean() for k in ("base", "delay1", "delay2")]
        L.append(f"* **速度**: 1分足の範囲では「速く入るほど有利」とは言えない。NY 急変順張りは、直後の1分に"
                 f"行き過ぎが戻ることが多く、OOS で 即時 {f(a[0])} → 1分遅れ {f(a[1])} → 2分遅れ {f(a[2])} pips と、"
                 "遅い方がましだった（IS でも同じ）。ORB は1-2分の遅れで 0.2 pips 以下しか変わらず、"
                 "コスト（約1.9 pips）に比べれば誤差。秒・ミリ秒単位の速度は1分足では検証できない（6章）。")
    L += ["", "### ご質問への短い答え", "",
          "* **高速スキャルピングの主な手法**: (1) 市場の開始時刻のレンジ・ブレイク（ORB）、(2) 急変への順張り／逆張り、"
          "(3) 指標発表直後の順張り（ニューストレード）、(4) 静かな時間帯の逆張り（別レポート `meanrev_quiet.md`）、"
          "(5) 業者・HFT 向けの手法（マーケットメイク、レイテンシー裁定、板情報）。(5) は個人の MT5 口座では"
          "できないか、規約で禁止されている。(1)〜(3) をここで検証し、すべてコストに負けた。",
          "* **AI で高速判断すれば勝率は上がるか**: 勝率は利確と損切りの置き方だけで自由に変えられる"
          "（同じシグナルでも 27%〜65%。ランダム売買でも利確1 pip／損切り20 pips なら勝率 91%）。"
          "大事なのは勝率ではなく「コスト後の1回あたり期待値」。"
          "AI（ご質問の JevAI のような判断 AI）を使っても、判断が速くなるだけではこの期待値は増えない。"
          "価格だけから1分〜数十分先を当てる単純ルールで、IS と OOS の両方で再現した偏りは"
          "ロンドン ORB のコスト前 +0.5〜+1.2 pips だけ。コストは約1.9 pips なので、AI はこの偏りを2〜4倍に"
          "しなければならない。"
          "この検証にはそれができる証拠はない（6章）。",
          "* **10倍チャレンジへの含意**: 期待値がマイナスのまま回数とレバレッジを上げても、破産が早まるだけ"
          "（`scalp_10x_mc.md`）。これまでの研究で取引できるエッジは、今も五十日の USDJPY 09:55 だけ。"]
    return L


def REPORT_WINRATE(results, s1, s2) -> list[str]:
    L = ["", "### 勝率と期待値の関係（ステージ2、IS、同じシグナルで出口の形だけを変える）", "",
         "損益分岐の勝率 = 平均損失 ÷（平均利益＋平均損失）。利確を近く、損切りを遠くすれば勝率は上がる。"
         "ただし、1回の負けが大きくなるので、必要な勝率（損益分岐）も同じだけ上がる。ORB では勝率が 27%〜65% まで"
         "動いても、コスト込み平均は24通りすべてマイナスで、勝率が一番高い形（65%）はむしろ悪い方に入る。"
         "期待値を決めるのは勝率ではなく、シグナル自体の偏り（摩擦ゼロ平均）がコストを超えるかどうか"
         "（NY 急変では保有時間の方が効いている: 5分では摩擦ゼロでもマイナス、30分でプラス）。", ""]
    for sig in ("orb_ldn0800_or30_cont", "big_k5_m6_ny_cont"):
        d = s2[s2.signal == sig]
        if not len(d):
            continue
        L += [f"**{sig_ja(d.iloc[0].to_dict())}**", ""]
        L += winrate_shape_table(s2, sig)
        L.append("")
    return L


def REPORT_DISCUSSION(results, s1, s2) -> list[str]:
    allc = pd.concat([s1, s2])
    L = ["", "## 6. AI で高速判断すれば勝率・期待値は上がるか", "",
         "**速度の3つの段階**", "",
         "* **分単位**（この検証の範囲）: 判断はシグナル足の終値、約定は次の1分足の始値（判断から約定まで数秒以内に相当）。"
         "ここから1-2分遅らせても、ORB の結果は 0.2 pips 以下しか変わらない。急変や指標のルールでは、直後の1分に"
         "行き過ぎが戻ることが多く、遅れた方が良いことさえある。**分単位では、速さは勝ち負けを決めていない**。",
         "* **秒〜ミリ秒単位**: 指標発表直後の最初の数秒は、銀行や HFT が発表サーバーの近くに置いたアルゴで取り合う。"
         "個人の MT5 と VPS でも注文の往復は数 ms〜数十 ms まで縮められる。しかし発表の瞬間は、ブローカー側で"
         "スプレッドが数倍〜十数倍に広がり、滑りや約定拒否もある。1分足データでは検証できないが、"
         "個人がこの段階で業者に勝つのは構造的に難しい。",
         "* **LLM 型の AI**（ChatGPT や Claude のような対話型 AI を API で呼ぶ判断）: 1回の判断に 1〜10 秒以上かかる。"
         "「高速判断」には向かない。AI を使うなら、事前に学習したモデルを EA の中に組み込み、ミリ秒で判定させる形に"
         "なる。その場合の速さは単純なルールと同じなので、差が出るとすれば「予測の中身」だけ。", "",
         "**期待値の壁**", "",
         f"* 1回のコストは約 {allc.raw_cost_eaten.median():.1f} pips（EURUSD でも約1.4）。この検証の単純ルールでは、"
         "コスト前の偏りは ORB で +0.5〜+1.2 pips。急変と指標のルールは IS と OOS で符号が反転した。",
         "* AI が役に立つには、コスト前の偏りを2〜4倍にし、しかもそれが OOS で再現しなければならない。"
         "価格だけを入力にした短期予測では、そのような改善はこの検証では見えていない。",
         f"* **過剰適合の危険**: ここでは {len(allc)} 通りを試しただけで、IS の t値 {allc.raw_t.max():.1f} の"
         "「勝ちルール」が出た。それが OOS では t値 -2.9 に反転した。AI は内部で数千〜数百万通りを試すのと同じなので、"
         "過剰適合はもっと起きやすい。コスト込み（発表時のスプレッド拡大も含む）で、学習に使っていない期間で"
         "確かめるまでは、「AI で勝率が上がった」は信用できない。",
         "* 勝率を上げること自体は、AI を使わなくても利確を近くするだけでできる。ただしそれで期待値は上がらない"
         "（3章の表）。「勝率が高い AI」をうたう手法は、損切りが遠いだけのことが多いので注意。", "",
         "## 7. シミュレーターとデータの限界（結論への影響）", "",
         "* 1分足なので、1分未満の値動きの順序と速度は見えない。同じ足の中で TP と SL の両方に届いた場合は、"
         "損切りを先とみなす（保守的）。",
         "* **指標発表時のスプレッド拡大はシミュレーターにない**。指標時刻の取引はコスト3倍・5倍で再計算したが、"
         "雇用統計の直後は実際にはそれ以上に広がることもある。つまり、ニュース系の結果はこれでも甘い側。",
         "* ブレイクアウトは「終値でレンジ外を確認 → 次の足の始値で成行」で検証した。レンジ上限に Buy Stop を"
         "置く逆指値エントリーは、simulate が成行しか扱わないため未検証。逆指値なら早く入れるが、"
         "逆指値の滑りがかかる。ORB で1-2分遅らせた影響が小さいことから、結論が変わる可能性は低いと考えるが、"
         "確認はしていない。",
         "* 第1金曜は雇用統計の日の代理で、発表日が第2金曜にずれる月もある。「3σ超の動き」も発表があった日の代理。"
         "指標カレンダーは使っていない。",
         "* OANDA の仲値データは、指標時に異常値（スパイク）を含むことがある。摩擦ゼロの数値はその影響を受けうる。",
         "* USDJPY は合成データなので参考扱い（高値・安値が広すぎ、TP/SL 型では悲観側に偏る）。",
         "* 複数ペアの取引は、同じドルの指標で同時に動くので独立ではない。そのため「日次t値」（同じ日を1つにまとめた t値）"
         "も載せた。IS 最良候補の日次t値は約1.1で、通常の t値（1.6）よりさらに弱い。"]
    return L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, default=0)
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    if a.report:
        report_only()
    else:
        {1: stage1, 2: stage2}.get(a.stage, final)()
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
