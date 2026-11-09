"""Check that every candidate ticker resolves in yfinance and has clean history.

Writes data/validation/universe_report.json. Nothing is locked into the universe
until it passes here: at least MIN_YEARS of daily history, a recent last print,
no long gaps and no unexplained jumps.

Run: python pipeline/validate_universe.py
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "validation" / "universe_report.json"

MIN_YEARS = 5.0
MAX_STALE_DAYS = 10
MAX_GAP_DAYS = 10
MAX_ABS_DAILY_MOVE = 0.25
MAX_ZERO_RETURN_SHARE = 0.20

CANDIDATES: dict[str, list[str]] = {
    "india_equity": [
        "HDFCBANK.NS", "ICICIBANK.NS", "TCS.NS", "INFY.NS", "RELIANCE.NS", "NTPC.NS",
        "ITC.NS", "HINDUNILVR.NS", "MARUTI.NS", "LT.NS", "BHARTIARTL.NS", "SUNPHARMA.NS",
    ],
    "gold": ["GOLDBEES.NS", "SETFGOLD.NS", "HDFCMFGETF.NS", "GOLD1.NS"],
    "india_debt": ["EBBETF0430.NS", "GILT5YBEES.NS", "SETF10GILT.NS", "LTGILTBEES.NS"],
    "risk_free": ["LIQUIDBEES.NS", "0P00005UPP.BO", "LIQUIDCASE.NS", "LIQUID1.NS"],
    "global_equity": ["URTH", "VT", "ACWI"],
    "global_bonds": ["BNDX", "BND", "AGG"],
    "fx": ["USDINR=X"],
    "benchmark": ["NIFTYBEES.NS", "^NSEI"],
    "stress_proxy": ["^GSPC", "GC=F"],
}


def assess(ticker: str, sleeve: str) -> dict:
    record: dict = {"ticker": ticker, "sleeve": sleeve, "resolved": False, "passes": False, "problems": []}
    try:
        frame = yf.Ticker(ticker).history(period="max", interval="1d", auto_adjust=True, actions=False)
    except Exception as exc:  # yfinance raises a wide range of network and parsing errors
        record["problems"].append(f"download error: {type(exc).__name__}: {exc}")
        return record
    if frame is None or frame.empty or "Close" not in frame:
        record["problems"].append("no price history returned")
        return record

    close = frame["Close"].copy()
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    close = close[~close.index.duplicated(keep="last")].sort_index()
    missing_prices = int(close.isna().sum())
    close = close.dropna()
    close = close[close > 0]
    if len(close) < 2:
        record["problems"].append("fewer than two valid prices")
        return record

    record["resolved"] = True
    window = close[close.index >= close.index[-1] - pd.Timedelta(days=int(MIN_YEARS * 365.25))]
    full_returns = close.pct_change().dropna()
    returns = window.pct_change().dropna()
    gaps = close.index.to_series().diff().dt.days.dropna()
    recent_gaps = window.index.to_series().diff().dt.days.dropna()
    years = (close.index[-1] - close.index[0]).days / 365.25
    stale_days = (pd.Timestamp.now().normalize() - close.index[-1]).days
    worst = returns.abs().idxmax()
    zero_share = float((returns == 0).mean())
    annual_factor = 252

    record.update(
        first_date=close.index[0].strftime("%Y-%m-%d"),
        last_date=close.index[-1].strftime("%Y-%m-%d"),
        observations=int(len(close)),
        years=round(years, 2),
        stale_days=int(stale_days),
        missing_prices=missing_prices,
        max_gap_days_all=int(gaps.max()) if len(gaps) else None,
        max_gap_days_5y=int(recent_gaps.max()) if len(recent_gaps) else None,
        zero_return_share_5y=round(zero_share, 4),
        largest_abs_move_5y=round(float(returns.abs().max()), 4),
        largest_move_date_5y=worst.strftime("%Y-%m-%d"),
        largest_abs_move_all=round(float(full_returns.abs().max()), 4),
        ann_return_5y=round(float((window.iloc[-1] / window.iloc[0]) ** (1 / MIN_YEARS) - 1), 4),
        ann_vol_5y=round(float(returns.std() * np.sqrt(annual_factor)), 4),
        last_close=round(float(close.iloc[-1]), 4),
    )

    if years < MIN_YEARS:
        record["problems"].append(f"only {years:.2f} years of history")
    if stale_days > MAX_STALE_DAYS:
        record["problems"].append(f"last print is {stale_days} days old")
    if len(recent_gaps) and recent_gaps.max() > MAX_GAP_DAYS:
        record["problems"].append(f"{int(recent_gaps.max())}-day gap in the last five years")
    if returns.abs().max() > MAX_ABS_DAILY_MOVE:
        record["problems"].append(f"{returns.abs().max():.1%} one-day move on {worst:%Y-%m-%d}")
    if zero_share > MAX_ZERO_RETURN_SHARE:
        record["problems"].append(f"{zero_share:.1%} of daily returns are exactly zero")
    record["passes"] = not record["problems"]
    return record


def main() -> int:
    results = []
    for sleeve, tickers in CANDIDATES.items():
        for ticker in tickers:
            result = assess(ticker, sleeve)
            results.append(result)
            print(f"{'PASS' if result['passes'] else 'FAIL'} {sleeve:14s} {ticker:16s} "
                  f"{result.get('first_date', '-')} {result.get('years', '-')}y {result['problems']}", flush=True)
            time.sleep(0.4)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "yfinance_version": yf.__version__,
        "criteria": {
            "min_years": MIN_YEARS, "max_stale_days": MAX_STALE_DAYS, "max_gap_days": MAX_GAP_DAYS,
            "max_abs_daily_move": MAX_ABS_DAILY_MOVE, "max_zero_return_share": MAX_ZERO_RETURN_SHARE,
        },
        "results": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    return 0 if any(r["passes"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
