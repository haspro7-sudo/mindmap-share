"""Quiet-session mean-reversion scalping (the retail "night scalper") on M1 / M5 bars.

    python scripts/scalp_meanrev_quiet.py              # final: OOS once + stress + report
    python scripts/scalp_meanrev_quiet.py --stage 1    # IS screen   (appends to the trial log)
    python scripts/scalp_meanrev_quiet.py --stage 2    # IS exit grid on the stage-1 leaders

Protocol (reports/trials/scalp_meanrev_quiet.jsonl logs every configuration):
  stage 1  in-sample 2005-2014 only: 10 fade signals x 3 quiet sessions with one neutral
           exit shape (TP 4 / SL 12 / 60 min), all raw pairs + 4 flagged synthetic crosses,
           simulated at cost_mult 1 (Titan Blade) and 0 (frictionless = gross edge).
  stage 2  in-sample only: TP x SL x time-stop grid on the 4 best stage-1 (signal, session)
           combinations by raw-pair pooled IS net pips per trade.
  final    at most 3 candidates chosen from the IS log (FINAL below), evaluated ONCE on
           2015-01-01..2020-05-14, plus cost x1.5 / x2, per year, per pair, entry delayed by
           1 and 2 minutes, frictionless gross and a random-entry baseline.

Signals (decision on the close of the signal bar, entry at the next M1 open, fade = trade
toward the trailing mean; every feature is trailing, computed from bars <= the signal bar):
  bb_*   close outside a Bollinger band (trailing SMA +- k * trailing std of closes)
  z_*    the same z-score on a longer 60-bar window
  rsi_*  Wilder RSI below lo (long) / above 100-lo (short)
  hl_*   close beyond the lowest low / highest high of the previous n bars
Sessions are server-time hours of the signal bar (server = New York + 7h).  Friday from
21:00 (weekly close) and Monday before 02:00 (weekly open) are always excluded, and so is
any signal whose look-back window spans a data gap (window time span > 2x its bar count).
"""
from __future__ import annotations

import argparse
import json
import math
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

FAMILY = "scalp_meanrev_quiet"
KEY = "meanrev_quiet"
LOG = TrialLog(FAMILY)
OUT_DIR = ROOT / "reports" / "scalping"
REPORT = OUT_DIR / f"{KEY}.md"
IS_START = pd.Timestamp("2005-01-01")
IS_END = scalp.IS_END                                  # 2015-01-01
OOS_END = pd.Timestamp("2020-05-15")

RAW = ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "AUDJPY"]
SYN = ["EURGBP", "EURAUD", "AUDCAD", "GBPCAD"]          # synthetic crosses: secondary only
WORKERS = 2

SESSIONS = {
    "ny_late_all": [21, 22, 23, 0, 1],                  # server 21:00-02:00 incl. rollover
    "ny_late_ex_roll": [21, 22, 1],                     # same without server 23:00-00:59
    "tokyo": [3, 4, 5, 6, 7, 8],                        # server 03:00-09:00
}
SIGNALS = {
    "bb_m1_20_2.0": dict(kind="bb", tf=1, n=20, k=2.0),
    "bb_m1_20_2.5": dict(kind="bb", tf=1, n=20, k=2.5),
    "bb_m1_20_3.0": dict(kind="bb", tf=1, n=20, k=3.0),
    "bb_m5_20_2.0": dict(kind="bb", tf=5, n=20, k=2.0),
    "bb_m5_20_2.5": dict(kind="bb", tf=5, n=20, k=2.5),
    "z_m1_60_2.5": dict(kind="bb", tf=1, n=60, k=2.5),
    "rsi_m1_2_3": dict(kind="rsi", tf=1, n=2, lo=3.0),
    "rsi_m1_14_20": dict(kind="rsi", tf=1, n=14, lo=20.0),
    "rsi_m5_2_5": dict(kind="rsi", tf=5, n=2, lo=5.0),
    "hl_m1_60": dict(kind="hl", tf=1, n=60),
}
STAGE1_EXIT = dict(tp=4.0, sl=12.0, hold=60.0)
STAGE2_GRID = dict(tp=[3.0, 6.0, 10.0, "mean"], sl=[8.0, 20.0], hold=[20.0, 90.0])
STAGE2_LEADERS = 4
MEAN_TP_CLIP = (2.0, 15.0)                             # tp="mean": distance to the SMA
FWD_H = [5, 15, 60]                                    # forward mid returns (minutes)
# v1 (first 94 IS trials) let Saturday/Sunday server-time bars of the early OANDA data
# (2005-2013) through the session filter; v2 trades Monday-Friday server time only.
FILTER_V = 2

# Final candidates, fixed from the IS trial log (stages 1+2, 94 configurations) before any
# OOS evaluation.  No configuration had IS avg net > 0 on the pooled raw pairs, so the first two
# are "the best the family could do" on real data and fail the IS criterion; the third is the
# only IS-positive pool (synthetic).  The v2 re-run (weekday filter) kept the same leaders and
# the same three picks; its single IS-positive raw pair-config (GBPUSD, t=0.7, the best of 564)
# was not promoted.
FINAL: list[dict] = [
    dict(name="rsi14_nylate", signal="rsi_m1_14_20", session="ny_late_ex_roll", tp="mean",
         sl=20.0, hold=90.0, pairs=RAW,
         rule="M1 RSI(14)<20 で買い / >80 で売り、サーバー21-23時・01-02時（ロールオーバー除外）、"
              "TP=20本平均までの距離(2-15pips)、SL 20pips、90分で時間切れ",
         why="実6ペア合算の IS 平均ネットが94設定中で最良。ただし IS でも負"),
    dict(name="z60_nylate", signal="z_m1_60_2.5", session="ny_late_ex_roll", tp="mean",
         sl=20.0, hold=90.0, pairs=RAW,
         rule="M1 終値の60本 z スコアが -2.5 未満で買い / +2.5 超で売り、サーバー21-23時・01-02時、"
              "TP=20本平均までの距離(2-15pips)、SL 20pips、90分",
         why="RSI 以外のシグナル系統（ボリンジャー/zスコア）で IS 最良（取引数は約3倍）。IS でも負"),
    dict(name="rsi14_nylate_syn", signal="rsi_m1_14_20", session="ny_late_ex_roll", tp="mean",
         sl=20.0, hold=90.0, pairs=SYN,
         rule="候補 rsi14_nylate と同じルールを合成クロス4ペアで",
         why="合成クロス4ペア合算の IS 平均ネットがプラスになった、94設定中唯一のプール"
             "（参考扱い: 合成データは見かけの逆張りエッジが出やすい）"),
]


# ----------------------------------------------------------------------------- features
def _rolling(x: np.ndarray, n: int, fn: str) -> np.ndarray:
    return getattr(pd.Series(x).rolling(n, min_periods=n), fn)().to_numpy()


def _contiguous(t: np.ndarray, w: int, bar_ns: float) -> np.ndarray:
    ok = np.zeros(len(t), bool)
    if len(t) >= w:
        ok[w - 1:] = (t[w - 1:] - t[:len(t) - w + 1]) <= 2 * w * bar_ns
    return ok


def _rsi(c: np.ndarray, n: int) -> np.ndarray:
    d = np.diff(c, prepend=np.nan)
    up = pd.Series(np.clip(d, 0, None)).ewm(alpha=1.0 / n, adjust=False).mean().to_numpy()
    dn = pd.Series(np.clip(-d, 0, None)).ewm(alpha=1.0 / n, adjust=False).mean().to_numpy()
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(dn > 0, 100.0 - 100.0 / (1.0 + up / dn), np.where(up > 0, 100.0, 50.0))


def tf_bars(m1: pd.DataFrame, tf: int):
    """M1 -> tf-minute bars.  Returns (t, h, l, c, m1_pos) where m1_pos is the position of the
    last M1 bar of each tf bar (the M1 bar on whose close the tf bar is complete)."""
    t = m1.index.as_unit("ns").asi8
    h, l, c = (m1[k].to_numpy(float) for k in ("high", "low", "close"))
    if tf == 1:
        return t, h, l, c, np.arange(len(t))
    key = t // int(tf * 60e9)
    starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
    ends = np.r_[starts[1:], len(t)] - 1
    return (key[starts] * int(tf * 60e9), np.maximum.reduceat(h, starts),
            np.minimum.reduceat(l, starts), c[ends], ends)


def raw_signal(m1: pd.DataFrame, spec: dict, pip: float):
    """(m1 positions, dir, distance to the trailing SMA in pips) of every bar that fires."""
    t, h, l, c, pos = tf_bars(m1, spec["tf"])
    bar_ns = spec["tf"] * 60e9
    kind, n = spec["kind"], spec["n"]
    sma20 = _rolling(c, 20, "mean")
    if kind == "bb":
        sma = _rolling(c, n, "mean")
        sd = _rolling(c, n, "std")
        with np.errstate(divide="ignore", invalid="ignore"):
            z = np.where(sd > 0, (c - sma) / sd, 0.0)
        d = np.where(z < -spec["k"], 1, np.where(z > spec["k"], -1, 0))
        dist = np.abs(c - sma) / pip
        ok = _contiguous(t, n, bar_ns)
    elif kind == "rsi":
        r = _rsi(c, n)
        d = np.where(r < spec["lo"], 1, np.where(r > 100 - spec["lo"], -1, 0))
        dist = np.abs(c - sma20) / pip
        ok = _contiguous(t, max(3 * n, 20), bar_ns)
    elif kind == "hl":
        lo = np.r_[np.nan, _rolling(l, n, "min")[:-1]]
        hi = np.r_[np.nan, _rolling(h, n, "max")[:-1]]
        d = np.where(c < lo, 1, np.where(c > hi, -1, 0))
        dist = np.abs(c - sma20) / pip
        ok = _contiguous(t, n + 1, bar_ns)
    else:
        raise ValueError(kind)
    fire = (d != 0) & ok & np.isfinite(dist)
    return pos[fire], d[fire].astype(np.int8), dist[fire]


def session_mask(m1: pd.DataFrame, positions: np.ndarray, hours) -> np.ndarray:
    idx = m1.index[positions]
    hr, dow = idx.hour.to_numpy(), idx.dayofweek.to_numpy()
    keep = np.isin(hr, list(hours))
    keep &= dow < 5                                    # early OANDA data has weekend bars
    keep &= ~((dow == 4) & (hr >= 21))                 # weekly close
    keep &= ~((dow == 0) & (hr < 2))                   # weekly open
    return keep


def build_signals(m1, cache, cfg, pip, delay=0) -> pd.DataFrame:
    p, d, dist = cache[cfg["signal"]]
    keep = session_mask(m1, p, SESSIONS[cfg["session"]])
    p, d, dist = p[keep], d[keep], dist[keep]
    tp = (np.clip(dist, *MEAN_TP_CLIP) if cfg["tp"] == "mean"
          else np.full(len(p), float(cfg["tp"])))
    if delay:
        p = p + delay
        ok = p < len(m1)
        p, d, tp = p[ok], d[ok], tp[ok]
    return pd.DataFrame({"dir": d, "tp": tp, "sl": float(cfg["sl"]), "hold": float(cfg["hold"])},
                        index=m1.index[p])


def fwd_returns(m1, sig, pip) -> dict:
    """Mean mid-price move in the signal direction h minutes after the next-bar open
    (all signals, overlapping; frictionless)."""
    t = m1.index.as_unit("ns").asi8
    o, c = m1["open"].to_numpy(float), m1["close"].to_numpy(float)
    p = m1.index.get_indexer(sig.index) + 1
    p = p[p < len(t)]
    d = sig["dir"].to_numpy()[:len(p)]
    out = {}
    for hmin in FWD_H:
        j = np.searchsorted(t, t[p] + int(hmin * 60e9), side="right") - 1
        out[f"fwd{hmin}"] = float(np.mean(d * (c[j] - o[p]) / pip)) if len(p) else float("nan")
    return out


# ------------------------------------------------------------------------ aggregation
def moments(tr: pd.DataFrame, tr0: pd.DataFrame | None = None) -> dict:
    net = tr["net_pips"].to_numpy()
    m = {"n": int(len(net)), "s": float(net.sum()), "ss": float((net ** 2).sum()),
         "w": int((net > 0).sum()), "g": float(tr["gross_pips"].sum()),
         "min": float(tr["minutes"].sum())}
    if tr0 is not None:
        m.update(n0=int(len(tr0)), s0=float(tr0["gross_pips"].sum()),
                 w0=int((tr0["gross_pips"] > 0).sum()))
    return m


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
    if all("n0" in m for m in ms):
        n0 = sum(m["n0"] for m in ms)
        out["avg_frictionless"] = sum(m["s0"] for m in ms) / max(n0, 1)
        out["win_frictionless"] = sum(m["w0"] for m in ms) / max(n0, 1)
        out["cost_eaten"] = out["avg_frictionless"] - mean
    return out


def summarize_trades(tr: pd.DataFrame) -> dict:
    s = scalp.stats(tr) if len(tr) else {"n": 0}
    keep = ["n", "trades_per_year", "win_rate", "avg_net_pips", "avg_gross_pips", "t_stat",
            "profit_factor", "total_net_pips", "avg_minutes"]
    return {k: s.get(k, float("nan")) for k in keep}


# ------------------------------------------------------------------------ IS stages
def _load(sym: str, start, end) -> pd.DataFrame:
    m1 = scalp.load(sym, start=start, end=end)[["open", "high", "low", "close"]]
    return m1.astype("float64")


def _eval_pair_is(args):
    sym, cfgs = args
    t0 = time.time()
    pip = INSTRUMENTS[sym].pip
    m1 = _load(sym, IS_START, IS_END)
    cache = {s: raw_signal(m1, SIGNALS[s], pip) for s in {c["signal"] for c in cfgs}}
    res = []
    for cfg in cfgs:
        sig = build_signals(m1, cache, cfg, pip)
        tr1 = scalp.simulate(m1, sig, sym, cost_mult=1.0)
        tr0 = scalp.simulate(m1, sig, sym, cost_mult=0.0)
        m = moments(tr1, tr0)
        m["n_signals"] = int(len(sig))
        if cfg.get("fwd"):
            m.update(fwd_returns(m1, sig, pip))
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
        per_pair = {}
        for s in pairs:
            p = pooled([per[s]])
            if cfg.get("fwd"):
                p.update({k: per[s][k] for k in per[s] if k.startswith("fwd")})
            p["n_signals"] = per[s]["n_signals"]
            per_pair[s] = p
        metrics = {"raw_pool": raw, "syn_pool": syn, "per_pair": per_pair}
        params = {k: v for k, v in cfg.items() if k != "fwd"}
        params["stage"] = stage
        params["filter_v"] = FILTER_V
        LOG.log(params, metrics, period="is")
        rows.append({**params, **{f"raw_{k}": v for k, v in raw.items()},
                     **{f"syn_{k}": v for k, v in syn.items()}})
    return pd.DataFrame(rows)


def stage1():
    cfgs = [dict(signal=s, session=se, **STAGE1_EXIT, fwd=True)
            for s in SIGNALS for se in SESSIONS]
    df = run_is(cfgs, "s1")
    cols = ["signal", "session", "raw_n", "raw_win", "raw_avg_frictionless", "raw_avg_net",
            "raw_t", "raw_cost_eaten", "syn_avg_frictionless", "syn_avg_net"]
    print(df[cols].sort_values("raw_avg_net", ascending=False).round(3).to_string())


def load_log(stage: str | None = None) -> pd.DataFrame:
    if not LOG.path.exists():
        return pd.DataFrame()
    rows = []
    for line in open(LOG.path):
        r = json.loads(line)
        if r.get("period") != "is" or (stage and r["params"].get("stage") != stage):
            continue
        if r["params"].get("filter_v", 1) != FILTER_V:
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
    return df.drop_duplicates(subset=["stage", "signal", "session", "tp", "sl", "hold"],
                              keep="last") if len(df) else df


def stage2():
    s1 = load_log("s1")
    lead = s1.sort_values("raw_avg_net", ascending=False).head(STAGE2_LEADERS)
    print("stage-2 leaders:\n", lead[["signal", "session", "raw_avg_net", "raw_t"]].to_string())
    cfgs = [dict(signal=r.signal, session=r.session, tp=tp, sl=sl, hold=hd)
            for r in lead.itertuples() for tp in STAGE2_GRID["tp"]
            for sl in STAGE2_GRID["sl"] for hd in STAGE2_GRID["hold"]]
    df = run_is(cfgs, "s2")
    cols = ["signal", "session", "tp", "sl", "hold", "raw_n", "raw_win",
            "raw_avg_frictionless", "raw_avg_net", "raw_t", "syn_avg_net"]
    print(df[cols].sort_values("raw_avg_net", ascending=False).head(25).round(3).to_string())


# ------------------------------------------------------------------------ final
def random_baseline(m1, sig, sym, seed=11) -> pd.DataFrame:
    """Random entry times drawn from the candidate's own signal hours, random direction,
    same TP/SL/hold: what the cost structure alone does to this trade shape."""
    rng = np.random.default_rng(seed)
    hrs = sorted(set(sig.index.hour))
    idx = m1.index
    ok = np.flatnonzero(np.isin(idx.hour, hrs))[:-1]
    pick = np.sort(rng.choice(ok, size=min(len(ok), 4 * len(sig) + 1000), replace=False))
    tp = np.resize(sig["tp"].to_numpy(), len(pick))
    return pd.DataFrame({"dir": rng.choice([-1, 1], size=len(pick)), "tp": tp,
                         "sl": sig["sl"].iloc[0], "hold": sig["hold"].iloc[0]}, index=idx[pick])


def _eval_pair_final(args):
    sym, cand = args
    pip = INSTRUMENTS[sym].pip
    m1 = _load(sym, IS_START, OOS_END)
    cache = {cand["signal"]: raw_signal(m1, SIGNALS[cand["signal"]], pip)}
    sig = build_signals(m1, cache, cand, pip)
    runs = {}
    for name, cm, dl in [("base", 1.0, 0), ("cost1.5", 1.5, 0), ("cost2", 2.0, 0),
                         ("frictionless", 0.0, 0), ("delay1", 1.0, 1), ("delay2", 1.0, 2)]:
        s = sig if dl == 0 else build_signals(m1, cache, cand, pip, delay=dl)
        runs[name] = scalp.simulate(m1, s, sym, cost_mult=cm)
    runs["random"] = scalp.simulate(m1, random_baseline(m1, sig, sym), sym, cost_mult=1.0)
    return sym, runs


def final():
    if not FINAL:
        raise SystemExit("FINAL is empty: run --stage 1 / --stage 2 and fix the candidates")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = {}
    for cand in FINAL:
        with ProcessPoolExecutor(WORKERS) as ex:
            out = dict(ex.map(_eval_pair_final, [(s, cand) for s in cand["pairs"]]))
        runs = {k: pd.concat([out[s][k] for s in cand["pairs"]], ignore_index=True)
                for k in out[cand["pairs"][0]]}
        base = runs["base"]
        base.to_parquet(OUT_DIR / f"trades_{KEY}_{cand['name']}.parquet")
        results[cand["name"]] = (cand, runs)
        for s in cand["pairs"]:
            if (cand["name"], s, FILTER_V) in _logged_finals():
                continue
            LOG.log({k: v for k, v in cand.items()} | {"pair": s, "filter_v": FILTER_V},
                    {"is": summarize_trades(out[s]["base"][out[s]["base"].entry_time < IS_END]),
                     "oos": summarize_trades(out[s]["base"][out[s]["base"].entry_time >= IS_END])},
                    period="final")
    write_report(results)


def _logged_finals() -> set:
    if not LOG.path.exists():
        return set()
    recs = [json.loads(x) for x in open(LOG.path)]
    return {(r["params"].get("name"), r["params"].get("pair"), r["params"].get("filter_v", 1))
            for r in recs if r.get("period") == "final"}


def _split(tr):
    return tr[tr.entry_time < IS_END], tr[tr.entry_time >= IS_END]


def verdict(runs) -> dict:
    ins, oos = _split(runs["base"])
    s_is, s_oos = summarize_trades(ins), summarize_trades(oos)
    oos15 = _split(runs["cost1.5"])[1]
    yr = oos.groupby(oos.entry_time.dt.year).net_pips.sum()
    drop = oos[oos.entry_time.dt.year != yr.idxmax()] if len(yr) else oos
    checks = {
        "IS avg net > 0": s_is["avg_net_pips"] > 0,
        "OOS avg net > 0": s_oos["avg_net_pips"] > 0,
        "OOS t >= 2.0": s_oos["t_stat"] >= 2.0,
        "OOS trades >= 200": s_oos["n"] >= 200,
        "OOS cost x1.5 > 0": len(oos15) > 0 and oos15.net_pips.mean() > 0,
        "OOS drop best year > 0": len(drop) > 0 and drop.net_pips.mean() > 0,
    }
    return {"is": s_is, "oos": s_oos, "checks": checks, "survives": all(checks.values()),
            "drop_best_year": float(drop.net_pips.mean()) if len(drop) else float("nan"),
            "best_year": int(yr.idxmax()) if len(yr) else None}


def f(x, d=2):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    if isinstance(x, (int, np.integer)):
        return f"{x:,}"
    return f"{x:+.{d}f}" if d else f"{x:,.0f}"


def write_report(results):
    # the report body is produced by report_text() so it can be regenerated from files
    REPORT.write_text(report_text(results))
    print(REPORT.read_text())


SIG_JA = {
    "bb": "ボリンジャーバンド外で引け", "rsi": "RSI 極端値", "hl": "直近 n 本の高値/安値を終値で更新"}
SES_JA = {"ny_late_all": "NY終盤 21-02時（ロールオーバー含む）",
          "ny_late_ex_roll": "NY終盤 21-23時・01-02時（23:00-00:59除外）",
          "tokyo": "東京 03-09時"}


def _fwd_pool(row, pairs, h):
    w = np.array([row.get(f"{s}_n_signals", 0) or 0 for s in pairs], float)
    v = np.array([row.get(f"{s}_fwd{h}", np.nan) for s in pairs], float)
    ok = np.isfinite(v) & (w > 0)
    return float((v[ok] * w[ok]).sum() / w[ok].sum()) if ok.any() else float("nan")


def stage1_table(s1: pd.DataFrame) -> list[str]:
    lines = ["| シグナル | 時間帯 | 取引数 | 勝率 | 摩擦ゼロの平均 | コスト込み平均 | コストで消えた分 | t値 "
             "| 5分後 | 15分後 | 60分後 | 合成クロス 摩擦ゼロ / コスト込み |",
             "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for r in s1.sort_values("raw_avg_net", ascending=False).to_dict("records"):
        fw = [_fwd_pool(r, RAW, h) for h in FWD_H]
        lines.append(
            f"| {r['signal']} | {r['session']} | {r['raw_n']:,} | {r['raw_win']:.0%} "
            f"| {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} | {r['raw_cost_eaten']:.2f} "
            f"| {r['raw_t']:+.1f} | {f(fw[0])} | {f(fw[1])} | {f(fw[2])} "
            f"| {f(r['syn_avg_frictionless'])} / {f(r['syn_avg_net'])} |")
    return lines


def stage2_table(s2: pd.DataFrame, top=15) -> list[str]:
    lines = ["| シグナル | 時間帯 | TP | SL | 時間 | 取引数 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 | t値 "
             "| 正のペア数(6) | 合成クロス コスト込み |",
             "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in s2.sort_values("raw_avg_net", ascending=False).head(top).to_dict("records"):
        npos = sum((r.get(f"{s}_avg_net", -1) or -1) > 0 for s in RAW)
        lines.append(
            f"| {r['signal']} | {r['session']} | {r['tp']} | {r['sl']:g} | {r['hold']:g}分 "
            f"| {r['raw_n']:,} | {r['raw_win']:.0%} | {f(r['raw_avg_frictionless'])} "
            f"| {f(r['raw_avg_net'])} | {r['raw_t']:+.1f} | {npos} | {f(r['syn_avg_net'])} |")
    return lines


def _row(name, tr):
    s = summarize_trades(tr)
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
            f"損益分岐の勝率 {be:.1%}（平均利益/損失からの逆算）、期待値 {net.mean():+.2f} pips/回")


def candidate_section(cand, runs, v) -> list[str]:
    L = [f"### 候補 {cand['name']}", "",
         f"* ルール: {cand['rule']}",
         f"* ペア: {', '.join(cand['pairs'])}" + ("（合成クロス: 参考扱い）" if set(cand["pairs"]) & set(SYN) else ""),
         f"* 選定理由（IS のみ）: {cand['why']}", "",
         "| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス(スプレッド・スリッページ後) | 平均ネット(pips) | t値 |",
         "|---|---:|---:|---:|---:|---:|---:|"]
    ins, oos = _split(runs["base"])
    L += [_row("IS 2005-2014（コスト1.0）", ins), _row("**OOS 2015-2020.5（コスト1.0）**", oos)]
    for k, lab in [("cost1.5", "OOS コスト1.5倍"), ("cost2", "OOS コスト2倍"),
                   ("frictionless", "OOS 摩擦ゼロ（スプレッド・手数料・滑りなし）"),
                   ("delay1", "OOS エントリー1分遅れ"), ("delay2", "OOS エントリー2分遅れ"),
                   ("random", "OOS ランダム時刻・ランダム方向（同じ形・同じ時間帯）")]:
        L.append(_row(lab, _split(runs[k])[1]))
    L += ["", "IS 側の同じ比較:", "",
          "| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス | 平均ネット | t値 |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for k, lab in [("frictionless", "IS 摩擦ゼロ"), ("cost1.5", "IS コスト1.5倍"),
                   ("delay1", "IS 1分遅れ"), ("delay2", "IS 2分遅れ"), ("random", "IS ランダム")]:
        L.append(_row(lab, _split(runs[k])[0]))
    L += ["", "生き残り判定:", ""]
    for k, ok in v["checks"].items():
        L.append(f"* {'OK' if ok else 'NG'}: {k}")
    L += [f"* 最良年 {v['best_year']} を除いた OOS 平均: {f(v['drop_best_year'])} pips",
          f"* **判定: {'生き残り' if v['survives'] else '不合格'}**", "",
          "年別（コスト1.0、全ペア合算）:", "",
          "| 年 | 区間 | 取引数 | 勝率 | 平均ネット | 合計ネット(pips) | 摩擦ゼロ平均 |",
          "|---|---|---:|---:|---:|---:|---:|"]
    base, fr = runs["base"], runs["frictionless"]
    fy = fr.groupby(fr.entry_time.dt.year).gross_pips.mean()
    for y, g in base.groupby(base.entry_time.dt.year):
        L.append(f"| {y} | {'IS' if y < IS_END.year else 'OOS'} | {len(g):,} | {(g.net_pips > 0).mean():.0%} "
                 f"| {f(g.net_pips.mean())} | {g.net_pips.sum():+,.0f} | {f(fy.get(y, np.nan))} |")
    L += ["", "ペア別:", "",
          "| ペア | IS 取引数 | IS 平均ネット | IS 摩擦ゼロ | OOS 取引数 | OOS 勝率 | OOS 平均ネット | OOS t値 | OOS 摩擦ゼロ |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for s in cand["pairs"]:
        bi, bo = _split(base[base.symbol == s])
        fi, fo = _split(fr[fr.symbol == s])
        so = summarize_trades(bo)
        L.append(f"| {s}{'（合成）' if s in SYN else ''} | {len(bi):,} | {f(bi.net_pips.mean())} | {f(fi.gross_pips.mean())} "
                 f"| {len(bo):,} | {so.get('win_rate', 0):.0%} | {f(so['avg_net_pips'])} | {f(so['t_stat'])} "
                 f"| {f(fo.gross_pips.mean())} |")
    L += ["", "勝率と期待値（OOS、コスト1.0）: " + win_expectancy(oos),
          "", "同じ形のランダム売買（OOS）: " + win_expectancy(_split(runs["random"])[1]), ""]
    return L


def report_text(results) -> str:
    s1, s2 = load_log("s1"), load_log("s2")
    n_cfg = len(s1) + len(s2)
    recs = [json.loads(x) for x in open(LOG.path)]
    n_v1 = sum(1 for r in recs if r.get("period") == "is" and r["params"].get("filter_v", 1) == 1)
    L = [f"# 静かな時間帯の逆張りスキャルピング（ナイトスキャル）検証 — {KEY}", "",
         "再現: `python scripts/scalp_meanrev_quiet.py`（最終評価とこのレポート）、"
         "`--stage 1` / `--stage 2`（IS 探索、試行ログ `reports/trials/scalp_meanrev_quiet.jsonl` に追記）。", ""]
    L += REPORT_SUMMARY(results, s1, s2)
    L += ["", "## 1. 何を検証したか", "",
          "* データ: OANDA M1 仲値 2005-01〜2020-05-14。主証拠は実データの6ペア "
          f"({', '.join(RAW)})。合成クロス ({', '.join(SYN)}) は M1 の高値・安値が広すぎるため参考扱い。",
          "* 約定: fxlab/scalp.py（シグナル足の終値で判断、次の M1 足の始値で成行、Titan FX ブレード相当の"
          "スプレッド×時間帯倍率（サーバー23時 2倍、0時 5倍、1-2時 1.5倍、3-8時 1.2倍）、滑り、損切り追加滑り、"
          "手数料 720円/lot 往復、同一足内は損切り優先、1銘柄1ポジション）。",
          "* IS = 2005-2014 だけでルールとパラメータを選び、最終候補を OOS = 2015-2020.5 で1回だけ評価。",
          "* シグナル（すべて逆張り、特徴量はシグナル足までの過去データだけ）:",
          "  * `bb_m1_20_k` / `bb_m5_20_k`: M1 / M5 の20本ボリンジャーバンド(k=2.0/2.5/3.0σ)の外で引けたら逆方向",
          "  * `z_m1_60_2.5`: 60本平均からの z スコアが ±2.5 超",
          "  * `rsi_m1_2_3`, `rsi_m1_14_20`, `rsi_m5_2_5`: RSI(期間)が下限未満で買い・(100-下限)超で売り",
          "  * `hl_m1_60`: 終値が直前60本の最安値を下回ったら買い（最高値更新なら売り）",
          "* 時間帯（サーバー時間 = NY+7h、日本時間は夏 +6h / 冬 +7h）: " +
          "; ".join(f"`{k}` = {v}" for k, v in SES_JA.items()) +
          "。日本時間では、NY終盤 = 夏 03-08時 / 冬 04-09時（ロールオーバーは夏 05-07時 / 冬 06-08時）、"
          "東京 = 夏 09-15時 / 冬 10-16時。金曜21時以降（週末クローズ）と月曜02時前（週明け）は常に除外。窓内にデータ欠落がある足も除外。",
          f"* 出口: 利確 TP（固定 pips、または `mean` = シグナル時点の20本平均までの距離を {MEAN_TP_CLIP[0]:g}〜{MEAN_TP_CLIP[1]:g} pips にクリップ）、"
          "損切り SL（固定 pips）、時間切れ（分）。",
          f"* 試した設定数: ステージ1 {len(s1)} 通り（10シグナル×3時間帯、出口は TP4/SL12/60分で固定）＋ "
          f"ステージ2 {len(s2)} 通り（上位4組 × TP{{3,6,10,mean}} × SL{{8,20}} × {{20,90}}分）＝ **{n_cfg} 通り**。"
          "各設定を10ペア（実6＋合成4）で評価。"
          f"最初の {n_v1} 通り（v1）は、初期の OANDA データ（2005-2013）にある土日のサーバー時間の足を除外し忘れていました。"
          "修正後に同じ格子を同じ選び方で再評価（v2、この表の数字）しています。"
          f"試行ログには v1・v2 の計 {n_v1 + n_cfg} 行（IS）が残っています。v1 でも、実ペアで IS プラスの設定は0でした。",
          "* 「摩擦ゼロ」= cost_mult=0（スプレッド・滑り・手数料なし、仲値で約定）＝ コスト前のグロスエッジ。"
          "「コストで消えた分」= 摩擦ゼロ平均 − コスト込み平均。", "",
          "## 2. ステージ1: コスト前にエッジはあるか（IS 2005-2014、実6ペア合算、TP4/SL12/60分）", "",
          "5分後/15分後/60分後 = シグナル発生後（次足始値から）の仲値の動き（シグナル方向を正、全シグナル平均、pips）。", ""]
    L += stage1_table(s1)
    L += ["", "## 3. ステージ2: 出口の格子（IS、上位15件）", ""]
    L += stage2_table(s2)
    L += ["", "## 4. 最終候補（OOS は1回だけ評価）", ""]
    for name, (cand, runs) in results.items():
        L += candidate_section(cand, runs, verdict(runs))
    L += REPORT_DISCUSSION(results, s1, s2)
    return "\n".join(L) + "\n"


def _oos(runs, k="base"):
    return summarize_trades(_split(runs[k])[1])


def _raw_pos_note(allis) -> str:
    rows = []
    for s in RAW:
        for r in allis[allis[f"{s}_avg_net"] > 0].to_dict("records"):
            rows.append(f"{s} {r['signal']} / {r['session']} / TP {r['tp']} / SL {r['sl']:g} / {r['hold']:g}分: "
                        f"{r[f'{s}_avg_net']:+.2f} pips（t={r[f'{s}_t']:+.2f}、{r[f'{s}_n']:,}回）")
    if not rows:
        return ""
    return ("実ペアでプラスだったのは " + "、".join(rows) + "。t 値が小さく、564 通りの最大値としては偶然の範囲"
            "なので、候補には上げていません（ほぼ同じルールの GBPUSD の OOS は、候補 rsi14_nylate のペア別表に出ています）。")


def REPORT_SUMMARY(results, s1, s2) -> list[str]:
    allis = pd.concat([s1, s2], ignore_index=True)
    best = allis.sort_values("raw_avg_net", ascending=False).iloc[0]
    raw_pos = int(sum((allis[f"{s}_avg_net"] > 0).sum() for s in RAW))
    syn_pos = int(sum((allis[f"{s}_avg_net"] > 0).sum() for s in SYN))
    fr, ce = s1["raw_avg_frictionless"], s1["raw_cost_eaten"]
    fr2 = allis["raw_avg_frictionless"]
    surv = [n for n, (c, r) in results.items() if verdict(r)["survives"]]
    ok = fr > 0.1
    ratio = (ce[ok] / fr[ok]) if ok.any() else pd.Series([np.nan])
    a = s1[s1.session == "ny_late_all"].set_index("signal")
    x = s1[s1.session == "ny_late_ex_roll"].set_index("signal")
    roll_fr = int((a["raw_avg_frictionless"] > x["raw_avg_frictionless"]).sum())
    roll_net = int((a["raw_avg_net"] < x["raw_avg_net"]).sum())
    L = ["## 結論", "",
         f"* **生き残った候補: {len(surv)} / {len(results)}**" +
         (f"（{', '.join(surv)}）" if surv else "。静かな時間帯の逆張りスキャルピングは、Titan FX ブレード相当のコストでは"
          "実データ6ペアのどれでも統計的に意味のある利益は出ませんでした。"),
         f"* コスト前のエッジ（摩擦ゼロ）は確かに存在します: ステージ1の30通りで実6ペア合算 "
         f"{fr.min():+.2f}〜{fr.max():+.2f} pips/回（{(fr > 0).sum()}/30 がプラス）、出口を調整したステージ2でも最大 "
         f"{fr2.max():+.2f} pips/回。ところがスプレッド・滑り・手数料で {ce.min():.1f}〜{ce.max():.1f} pips/回が消えます。"
         f"コストはエッジの {ratio.min():.0f}〜{ratio.max():.0f} 倍（中央値 {ratio.median():.1f} 倍、摩擦ゼロが +0.1 pips 超の設定で計算）です。",
         f"* IS（2005-2014）で最良だった設定でも実6ペア合算 {best['raw_avg_net']:+.2f} pips/回"
         f"（{best['signal']} / {best['session']} / TP {best['tp']} / SL {best['sl']:g} / {best['hold']:g}分）。"
         f"94設定 × 実6ペア = 564 通りのうち IS でプラスは **{raw_pos} 通り**。合成クロスでは {syn_pos} 通りがプラスでしたが、"
         "合成データ特有の見かけの逆張り（後述）の影響を受けています。" + _raw_pos_note(allis),
         f"* ロールオーバー（サーバー23:00-00:59）を含めると、10シグナル中 {roll_fr} 個でコスト前のエッジが大きくなりました"
         f"（価格の跳ねが戻るため）。しかしスプレッドが2〜5倍に広がるので、コスト込みでは 10 個中 {roll_net} 個で悪化しました。",
    ]
    for name, (c, r) in results.items():
        o, v = _oos(r), verdict(r)
        L.append(f"* 候補 `{name}`（{', '.join(c['pairs'])}）: IS {v['is']['avg_net_pips']:+.2f} → OOS "
                 f"{o['avg_net_pips']:+.2f} pips/回（勝率 {o['win_rate']:.0%}、t={o['t_stat']:+.1f}、{o['n']:,}回）、"
                 f"摩擦ゼロなら OOS {_oos(r, 'frictionless')['avg_net_pips']:+.2f}。"
                 f"判定: {'生き残り' if v['survives'] else '不合格'}")
    lead = s2.sort_values("raw_avg_net", ascending=False).iloc[0]
    sub = s2[(s2.signal == lead.signal) & (s2.session == lead.session)]
    hi, lo = sub.loc[sub.raw_win.idxmax()], sub.loc[sub.raw_win.idxmin()]
    L += [f"* 勝率は TP/SL の形で大きく変わります（同じシグナルで IS 勝率 {lo.raw_win:.0%}〜{hi.raw_win:.0%}）。"
          f"しかし期待値はどの形でもマイナスで、最も勝率の高い形（TP {hi.tp} / SL {hi.sl:g}、勝率 {hi.raw_win:.0%}）は "
          f"{hi.raw_avg_net:+.2f} pips/回、最良の形は勝率 {lead.raw_win:.0%} で {lead.raw_avg_net:+.2f} pips/回でした（第5節）。"
          "「高速判断で勝率を上げる」ことが利益につながるのは、1回あたりのグロスエッジがコストを超える場合だけです。",
          _delay_sentence(results) + "（第6節）"]
    return L


def _delay_stats(results):
    """OOS avg-net change per candidate for 1 and 2 minutes of extra entry delay (raw only)."""
    rows = []
    for name, (c, r) in results.items():
        if set(c["pairs"]) & set(SYN):
            continue
        b = _oos(r)["avg_net_pips"]
        rows.append((name, _oos(r, "delay1")["avg_net_pips"] - b, _oos(r, "delay2")["avg_net_pips"] - b,
                     _oos(r, "frictionless")["avg_net_pips"], b))
    return rows


def _delay_sentence(results) -> str:
    rows = _delay_stats(results)
    if not rows:
        return ""
    d1, d2 = np.mean([r[1] for r in rows]), np.mean([r[2] for r in rows])
    fr = max(r[3] for r in rows)
    if min(d1, d2) < -0.1:
        head = (f"* 分単位の速さは効きます。エントリーが1分遅れると平均 {d1:+.2f}、2分遅れると {d2:+.2f} pips/回悪化しました"
                "（逆張りの戻りの一部は最初の数分で出るため）。")
    else:
        head = (f"* エントリーを1〜2分遅らせても変化は小さく（平均 {d1:+.2f} / {d2:+.2f} pips/回）、"
                "分単位の速さは決め手になりません。")
    return (head + f"ただし、基準ケース（シグナル足の終値の直後に約定）でも、OOS のコスト前エッジは最大 {fr:+.2f} pips/回です。"
            "約2 pips のコストに届きません。速くすればマイナスは縮みますが、プラスには変わりません。ボトルネックは速度ではなくコストです。")


def autocorr_quiet(pairs=("EURUSD", "GBPUSD", "AUDUSD", "EURGBP", "AUDCAD", "GBPCAD")) -> dict:
    """Lag-1 autocorrelation of consecutive M1 close-to-close log returns (IS, signal hours of
    ny_late_ex_roll + tokyo).  Synthetic crosses built from two asynchronous legs show
    spurious negative autocorrelation (quote-timing noise that reverts)."""
    hours = SESSIONS["ny_late_ex_roll"] + SESSIONS["tokyo"]
    out = {}
    for sym in pairs:
        m1 = scalp.load(sym, start=IS_START, end=IS_END)
        t = m1.index.as_unit("ns").asi8
        r = np.diff(np.log(m1["close"].to_numpy(float)))
        step = np.diff(t) == 60e9
        ok = step[1:] & step[:-1] & np.isin(m1.index.hour.to_numpy()[2:], hours)
        out[sym] = float(np.corrcoef(r[1:][ok], r[:-1][ok])[0, 1])
        del m1
    return out


def _fwd_sentence(s1) -> str:
    ratios = []
    for r in s1.to_dict("records"):
        f5, f60 = _fwd_pool(r, RAW, 5), _fwd_pool(r, RAW, 60)
        if np.isfinite(f5) and np.isfinite(f60) and f60 > 0.1:
            ratios.append(f5 / f60)
    if not ratios:
        return ""
    return (f"* ステージ1の仲値の動き（5分後/60分後）を見ると、60分間の戻りのうち中央値で {np.median(ratios):.0%} が"
            "最初の5分で出ています（30通り中、60分後の戻りが0.1 pips 超のもの）。一方、60分後でも戻りは実ペアで"
            "おおむね 1 pips 前後にとどまり、コストを払えるほど大きくありません。")


def REPORT_DISCUSSION(results, s1, s2) -> list[str]:
    ac = autocorr_quiet()
    s2s = s2.sort_values("raw_avg_net", ascending=False)
    L = ["", "## 5. 勝率と期待値の関係", "",
         "1回あたりの期待値 = 勝率 × 平均利益 − (1 − 勝率) × 平均損失。損益分岐の勝率 = 平均損失 ÷ (平均利益 + 平均損失)。"
         "TP を小さく SL を大きくすれば勝率は上がりますが、損益分岐の勝率も同じだけ上がります。"
         "さらにコスト（1回 約2 pips）が利益を削り損失を増やすので、分岐点はもっと上に動きます。", "",
         "同じシグナル（IS、実6ペア合算）で出口だけを変えた例:", "",
         "| シグナル | TP / SL / 時間 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 |", "|---|---|---:|---:|---:|"]
    lead = s2s.iloc[0]
    sub = s2[(s2.signal == lead.signal) & (s2.session == lead.session)].sort_values("raw_win", ascending=False)
    for r in sub.iloc[[0, 1, 3, 7, 11, 15]].to_dict("records") if len(sub) >= 16 else sub.to_dict("records"):
        L.append(f"| {r['signal']} | {r['tp']} / {r['sl']:g} / {r['hold']:g}分 | {r['raw_win']:.0%} "
                 f"| {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} |")
    L += ["", "勝率の高い設定ほど勝ち1回の利益が小さく、コストに占められる割合が大きくなります。"
          "勝率を見て選ぶと、コスト負けする形を選びがちです。見るべきは「1回あたりネット pips とその t 値」です。"
          "過去の計測でも、ランダム売買は TP1/SL20 で勝率91%、TP20/SL1 で勝率4%でしたが、どちらも1回 約1.3 pips の負けでした。", "",
          "## 6. 「高速判断」「AI」で勝率は上がるか（この系統での答え）", "",
          "| 候補 | OOS 通常（次の足で約定） | 1分遅れ | 2分遅れ | 摩擦ゼロ | コスト1.5倍 | コスト2倍 |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for name, (c, r) in results.items():
        L.append(f"| {name} | " + " | ".join(
            f"{_oos(r, k)['avg_net_pips']:+.2f}" for k in
            ["base", "delay1", "delay2", "frictionless", "cost1.5", "cost2"]) + " |")
    L += ["", "（OOS 平均ネット pips/回。摩擦ゼロだけはコスト前のグロス）", "",
          _delay_sentence(results),
          _fwd_sentence(s1),
          "* この表の「通常」は、シグナル足の終値の直後（次の足の始値＝次の最初の気配）で約定する想定です。"
          "M1 で表せる最速の執行で、判断に AI を使っても、これより前に約定させることはできません。",
          "* 秒・ミリ秒単位の速さは、M1 データでは検証できません。個人が MT5 経由でその速さを競う手法"
          "（指標発表直後の飛び乗り、他社レートとの遅延裁定など）は、約定の滑りや業者の禁止事項に阻まれます。"
          "今回の逆張りでは、そもそも速さが効く場面ではありません。",
          "* AI（機械学習）でエントリーをふるいにかければ、勝率は上がるかもしれません。ただし利益にするには、"
          "1回あたりのコスト前エッジを今の 0〜1 pips から 2 pips 超へ、2〜4倍に引き上げる必要があります。"
          "94通りの単純ルールでは、どの実ペアでも届きませんでした。自由度の高いモデルほど IS に過剰適合しやすく、"
          "同じ IS/OOS の手順で確かめないと「バックテストだけ高勝率」になります。",
          "* 10万円→100万円チャレンジへの含意: 期待値がマイナスの手法は、回数とレバレッジを増やすほど早く資金を失います"
          "（reports/scalping/scalp_10x_mc.md のランダム売買の例: 1日20回・1回5%リスクで3か月の破産率 99%以上）。",
          "", "## 7. データ・シミュレーター上の注意", "",
          "* **合成クロスは、この系統では楽観側にずれます**。IS の静かな時間帯（サーバー21-23・01-02・03-09時）の"
          "連続する M1 リターンの1次自己相関は、" +
          " / ".join(f"{k}{'（合成）' if k in SYN else ''} {v:+.3f}" for k, v in ac.items()) +
          " でした。2つの通貨ペアの終値の時刻ずれから、戻るだけの見かけの値動きが生まれるためです。"
          f"ステージ1の摩擦ゼロのエッジも、合成クロスは {s1.syn_avg_frictionless.min():+.2f}〜{s1.syn_avg_frictionless.max():+.2f} pips/回で、"
          f"実ペアの {s1.raw_avg_frictionless.min():+.2f}〜{s1.raw_avg_frictionless.max():+.2f} pips/回より大きく出ています。"
          "監査で指摘された「高安値が広すぎて TP/SL 型では悲観側」というずれとは逆向きです。どちらが勝つかはデータから判別できないので、"
          "合成クロスの結果は採否の根拠にしていません。",
          "* ロールオーバー前後の実際のブレード口座のスプレッドは、モデル（23時2倍・0時5倍）より広いことがあります。"
          "その場合 `ny_late_all` はさらに悪化します。",
          "* 約定は次の足の始値での成行です。指値で入ればスプレッドは節約できますが、逆行した時だけ約定する"
          "（逆選択）ので、この M1 データでは公平に検証できません（未検証）。",
          "* OANDA の仲値の M1 足です。夜間の実データペアにも、わずかな「気配の揺れ」による見かけの戻りが含まれている"
          "可能性があります。その場合、実際のコスト前エッジは表の値よりさらに小さくなります。"]
    return L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, default=0)
    a = ap.parse_args()
    t0 = time.time()
    {1: stage1, 2: stage2}.get(a.stage, final)()
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
