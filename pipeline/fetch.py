"""Keyless market data download through yfinance, with cleaning and INR conversion."""
from __future__ import annotations

import time

import pandas as pd
import yfinance as yf

BAD_TICK_MOVE = 0.15
BAD_TICK_REVERSAL = 0.8
STALE_LIMIT_DAYS = 10


def download(ticker: str, retries: int = 3) -> pd.Series:
    for attempt in range(retries):
        try:
            frame = yf.Ticker(ticker).history(period="max", interval="1d", auto_adjust=True, actions=False)
        except Exception as exc:  # yfinance raises a wide range of network and parsing errors
            print(f"  {ticker}: attempt {attempt + 1} failed with {type(exc).__name__}", flush=True)
            frame = None
        if frame is not None and not frame.empty and "Close" in frame:
            close = frame["Close"].dropna()
            close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
            close = close[~close.index.duplicated(keep="last")].sort_index()
            return close[close > 0].rename(ticker)
        time.sleep(2 * (attempt + 1))
    return pd.Series(dtype=float, name=ticker)


def remove_bad_ticks(close: pd.Series) -> tuple[pd.Series, int]:
    """Drop a print only when a large move is almost fully undone the next session."""
    returns = close.pct_change()
    following = returns.shift(-1)
    spike = (returns.abs() > BAD_TICK_MOVE) & (following.abs() > BAD_TICK_MOVE) & (
        ((1 + returns) * (1 + following) - 1).abs() < returns.abs() * (1 - BAD_TICK_REVERSAL))
    return close[~spike], int(spike.sum())


def first_usable(entry: dict, min_years: float) -> tuple[str, pd.Series, int]:
    """Return the first ordered candidate with enough recent, long history."""
    for ticker in entry["tickers"]:
        close = download(ticker)
        if close.empty:
            print(f"  {ticker}: no data, trying the next candidate", flush=True)
            continue
        years = (close.index[-1] - close.index[0]).days / 365.25
        stale = (pd.Timestamp.now().normalize() - close.index[-1]).days
        if years < min_years or stale > STALE_LIMIT_DAYS:
            print(f"  {ticker}: rejected, {years:.2f}y history and {stale}d stale", flush=True)
            continue
        cleaned, removed = remove_bad_ticks(close)
        return ticker, cleaned, removed
    raise RuntimeError(f"no usable ticker for {entry['key']}: tried {entry['tickers']}")


def to_inr(close: pd.Series, currency: str, fx: pd.Series) -> pd.Series:
    if currency == "INR":
        return close
    union = close.index.union(fx.index)
    rate = fx.reindex(union).ffill().reindex(close.index)
    return (close * rate).dropna()
