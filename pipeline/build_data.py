"""Build every analytic the site reads and write versioned JSON to data/v1.

Output replaces the previous data only after all sanity checks pass, so a bad
download can never reach the site.

Run: python pipeline/build_data.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analytics as an  # noqa: E402
import config as cfg  # noqa: E402
import fetch  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / cfg.SCHEMA_VERSION


def rounded(value, digits: int = 6):
    if isinstance(value, dict):
        return {k: rounded(v, digits) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(v, digits) for v in value]
    if isinstance(value, (np.floating, float)):
        number = float(value)
        if not np.isfinite(number):
            raise ValueError("non-finite number in output")
        return round(number, digits)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def load_market() -> dict:
    print("Downloading market data", flush=True)
    fx_ticker, fx_close, fx_bad = fetch.first_usable(cfg.FX, cfg.MIN_YEARS)
    prices: dict[str, pd.Series] = {}
    meta: list[dict] = []

    def add(entry: dict, role: str) -> None:
        ticker, close, removed = fetch.first_usable(entry, cfg.MIN_YEARS)
        prices[entry["key"]] = fetch.to_inr(close, entry["currency"], fx_close)
        meta.append({"key": entry["key"], "name": entry["name"], "ticker": ticker, "role": role, "currency": entry["currency"],
                     "sleeve": entry.get("sleeve"), "sector": entry.get("sector"), "cap": entry.get("cap"),
                     "primary_ticker": entry["tickers"][0], "bad_ticks_removed": removed,
                     "first_date": close.index[0].strftime("%Y-%m-%d"), "last_date": close.index[-1].strftime("%Y-%m-%d"),
                     "years_available": round((close.index[-1] - close.index[0]).days / 365.25, 2)})
        print(f"  {entry['key']:12s} {ticker:16s} from {close.index[0]:%Y-%m-%d}", flush=True)
        time.sleep(0.3)

    for entry in cfg.INSTRUMENTS:
        add(entry, "held")
    add(cfg.RISK_FREE, "risk_free")
    add(cfg.MARKET_BENCHMARK, "market_benchmark")
    for bench in cfg.SLEEVE_BENCHMARKS.values():
        if "tickers" in bench:
            add(bench, "sleeve_benchmark")

    proxies = {}
    for key, proxy in cfg.STRESS_PROXIES.items():
        close = fetch.download(proxy["ticker"])
        if close.empty:
            raise RuntimeError(f"stress proxy {proxy['ticker']} returned no data")
        proxies[key] = fetch.to_inr(close, proxy["currency"], fx_close)
        time.sleep(0.3)

    meta.append({"key": "USDINR", "name": cfg.FX["name"], "ticker": fx_ticker, "role": "fx", "currency": "INR", "bad_ticks_removed": fx_bad,
                 "first_date": fx_close.index[0].strftime("%Y-%m-%d"), "last_date": fx_close.index[-1].strftime("%Y-%m-%d"),
                 "years_available": round((fx_close.index[-1] - fx_close.index[0]).days / 365.25, 2)})
    return {"prices": prices, "proxies": proxies, "meta": meta, "fx": fx_close}


def build_panel(prices: dict[str, pd.Series]) -> pd.DataFrame:
    """Daily panel on the NSE calendar. Foreign and NAV series carry their last known value."""
    start = max(series.index[0] for series in prices.values())
    calendar = prices["NIFTY"].loc[start:].index
    columns = {}
    for key, series in prices.items():
        union = series.index.union(calendar)
        columns[key] = series.reindex(union).ffill(limit=7).reindex(calendar)
    panel = pd.DataFrame(columns, index=calendar).dropna()
    years = (panel.index[-1] - panel.index[0]).days / 365.25
    if years < cfg.MIN_YEARS:
        raise RuntimeError(f"common window is only {years:.2f} years")
    return panel


def sleeve_daily_returns(returns: pd.DataFrame, keys: list[str], sleeve_of: dict, weights: dict, bench_daily: pd.DataFrame) -> pd.DataFrame:
    """Fixed-mix return of each sleeve. An unheld sleeve takes its benchmark return."""
    data = {}
    for sleeve in [s["id"] for s in cfg.SLEEVES]:
        members = [k for k in keys if sleeve_of[k] == sleeve]
        held = np.array([weights[k] for k in members])
        data[sleeve] = returns[members].to_numpy() @ (held / held.sum()) if held.sum() > 1e-9 else bench_daily[sleeve].to_numpy()
    data["cash"] = returns["RF"].to_numpy()
    return pd.DataFrame(data, index=returns.index)


def stress_tests(panel_returns: pd.DataFrame, sleeve_returns: pd.DataFrame, proxies: dict[str, pd.Series], nifty_index: pd.Series) -> list[dict]:
    sleeves = [s["id"] for s in cfg.SLEEVES] + ["cash"]
    results = []
    for scenario in cfg.STRESS_SCENARIOS:
        window = nifty_index.loc[scenario["search_start"]:scenario["search_end"]]
        trough = window.idxmin()
        peak = window.loc[:trough].idxmax()
        dates = window.loc[peak:trough].index
        paths, shocks, labels = {}, {}, {}
        for sleeve in sleeves:
            source = scenario["sources"][sleeve]
            if source is None:
                path = pd.Series(1.0, index=dates)
                labels[sleeve] = "Assumed flat"
            elif source == "PANEL":
                daily = sleeve_returns[sleeve].reindex(dates).fillna(0.0)
                path = (1 + daily).cumprod() / (1 + daily.iloc[0])
                labels[sleeve] = "Actual instruments held"
            else:
                series = proxies[source]
                union = series.index.union(dates)
                aligned = series.reindex(union).ffill().reindex(dates)
                if aligned.isna().any():
                    raise RuntimeError(f"proxy {source} does not cover {scenario['id']}")
                path = aligned / aligned.iloc[0]
                labels[sleeve] = cfg.STRESS_PROXIES[source]["name"]
            paths[sleeve] = (path - 1).tolist()
            shocks[sleeve] = float(path.iloc[-1] - 1)
        results.append({"id": scenario["id"], "name": scenario["name"], "note": scenario["note"],
                        "start": peak.strftime("%Y-%m-%d"), "end": trough.strftime("%Y-%m-%d"),
                        "nifty_change": float(window.loc[trough] / window.loc[peak] - 1),
                        "sources": labels, "shocks": shocks, "dates": [d.strftime("%Y-%m-%d") for d in dates], "paths": paths})
    return results


def main() -> int:
    market = load_market()
    prices = market["prices"]
    panel = build_panel(prices)
    keys = [i["key"] for i in cfg.INSTRUMENTS]
    sleeve_of = {i["key"]: i["sleeve"] for i in cfg.INSTRUMENTS}
    upper = np.array([i["cap"] for i in cfg.INSTRUMENTS])
    print(f"Common window {panel.index[0]:%Y-%m-%d} to {panel.index[-1]:%Y-%m-%d}, {len(panel)} sessions", flush=True)

    daily = panel.pct_change().dropna()
    daily_log = np.log(panel).diff().dropna()
    weekly_prices = panel.resample("W-FRI").last().dropna()
    weekly_log = np.log(weekly_prices).diff().dropna()

    weekly_held = weekly_log[keys]
    shrunk_log_mean, shrinkage = an.bayes_stein_mean(weekly_held)
    weekly_var = weekly_held.var().to_numpy()
    mu = an.annual_arithmetic_mean(shrunk_log_mean, weekly_var)
    mu_historical = an.annual_arithmetic_mean(weekly_held.mean().to_numpy(), weekly_var)
    cov = weekly_held.cov().to_numpy() * an.WEEKS

    rf_recent = panel["RF"].loc[panel.index[-1] - pd.Timedelta(days=cfg.ANNUAL_RF_LOOKBACK_DAYS):]
    rf_days = (rf_recent.index[-1] - rf_recent.index[0]).days
    rf = float((rf_recent.iloc[-1] / rf_recent.iloc[0]) ** (365.25 / rf_days) - 1)

    solved = an.efficient_frontier(mu, cov, upper, rf, cfg.FRONTIER_POINTS)
    orp, mvp = solved["tangency"], solved["mvp"]
    orp_stats = an.describe(orp, mu, cov, rf)
    mvp_stats = an.describe(mvp, mu, cov, rf)

    def point(weights: np.ndarray) -> dict:
        return {**an.describe(weights, mu, cov, rf), "weights": weights.tolist()}

    efficient_points = [point(w) for w in solved["efficient"]]
    inefficient_points = [point(w) for w in solved["inefficient"]]

    returns_held = daily[keys].to_numpy()
    rf_series = daily["RF"]
    bench_series = daily["NIFTY"]

    def portfolio_series(weights: np.ndarray, y: float = 1.0) -> pd.Series:
        return pd.Series(y * (returns_held @ weights) + (1 - y) * rf_series.to_numpy(), index=daily.index)

    def y_star(a: float) -> float:
        return (orp_stats["expected_return"] - rf) / (a * orp_stats["volatility"] ** 2)

    def risk_block(series: pd.Series) -> dict:
        return {"var": [an.value_at_risk(series, c) for c in cfg.VAR_CONFIDENCES], "drawdown": an.max_drawdown(series),
                "daily_volatility": float(series.std()), "annual_volatility": float(series.std() * np.sqrt(an.TRADING_DAYS)),
                "performance": an.performance(series, rf_series, bench_series)}

    references = {"orp": risk_block(portfolio_series(orp)), "mvp": risk_block(portfolio_series(mvp))}
    for a in cfg.REFERENCE_RISK_AVERSIONS:
        y = min(1.0, y_star(a))
        references[f"A{a}"] = {"a": a, "y": y, "y_unconstrained": y_star(a), **risk_block(portfolio_series(orp, y))}
    references["benchmark"] = risk_block(bench_series)

    orp_by_key = dict(zip(keys, orp))
    bench_daily = pd.DataFrame({sleeve: daily[b["key"]].to_numpy() for sleeve, b in cfg.SLEEVE_BENCHMARKS.items()}, index=daily.index)
    bench_daily["cash"] = rf_series.to_numpy()
    port_sleeve_daily = sleeve_daily_returns(daily, keys, sleeve_of, orp_by_key, bench_daily)

    sleeve_ids = [s["id"] for s in cfg.SLEEVES] + ["cash"]
    orp_sleeves = np.array([sum(orp_by_key[k] for k in keys if sleeve_of[k] == s["id"]) for s in cfg.SLEEVES] + [0.0])
    bench_sleeves = np.array([s["benchmark_weight"] for s in cfg.SLEEVES] + [0.0])
    monthly_port = (1 + port_sleeve_daily[sleeve_ids]).resample("ME").prod() - 1
    monthly_bench = (1 + bench_daily[sleeve_ids]).resample("ME").prod() - 1
    # Complete months only, so a partial first or last month does not distort the attribution.
    first_full = panel.index[0] + pd.offsets.MonthEnd(1)
    keep = (monthly_port.index > first_full) & (monthly_port.index < pd.Timestamp(panel.index[-1] + pd.offsets.MonthEnd(0)))
    monthly_port, monthly_bench = monthly_port[keep], monthly_bench[keep]
    brinson_orp = an.brinson(orp_sleeves, bench_sleeves, monthly_port.to_numpy(), monthly_bench.to_numpy())

    nifty_index = market["proxies"]["NSEI"]
    stress = stress_tests(daily, port_sleeve_daily, market["proxies"], nifty_index)
    target_cash = np.append(orp, 0.0)
    all_returns = np.column_stack([returns_held, rf_series.to_numpy()])
    drift = an.rebalance_backtest(all_returns, target_cash, None, cfg.DEFAULT_ONE_WAY_COST)
    banded = an.rebalance_backtest(all_returns, target_cash, cfg.DEFAULT_REBALANCE_BAND, cfg.DEFAULT_ONE_WAY_COST)
    reference_rebalance = {k: {x: v[x] for x in v if x != "path"} for k, v in {"buy_and_hold": drift, "banded": banded}.items()}

    checks = run_checks(orp, mvp, efficient_points, mu, cov, rf, references, brinson_orp, stress, upper, orp_stats)
    failed = [c for c in checks if not c["passed"]]
    for check in checks:
        print(f"{'PASS' if check['passed'] else 'FAIL'}  {check['name']}: {check['detail']}", flush=True)

    dates = [d.strftime("%Y-%m-%d") for d in daily.index]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta_by_key = {m["key"]: m for m in market["meta"]}
    per_asset = []
    for index, key in enumerate(keys):
        instrument = cfg.INSTRUMENTS[index]
        per_asset.append({**meta_by_key[key], "expected_return": mu[index], "historical_return": mu_historical[index],
                          "volatility": float(np.sqrt(cov[index, index])), "cap": float(instrument["cap"]),
                          "orp_weight": orp[index], "mvp_weight": mvp[index]})

    files = {
        "universe.json": {"sleeves": cfg.SLEEVES, "instruments": per_asset, "support": [m for m in market["meta"] if m["key"] not in keys],
                          "substitutions": cfg.SUBSTITUTIONS, "window": {"start": panel.index[0].strftime("%Y-%m-%d"), "end": panel.index[-1].strftime("%Y-%m-%d"),
                          "sessions": len(panel), "years": (panel.index[-1] - panel.index[0]).days / 365.25}},
        "market.json": {"keys": keys, "expected_return": mu.tolist(), "historical_return": mu_historical.tolist(), "shrinkage_intensity": shrinkage,
                        "covariance_annual": cov.tolist(), "correlation_weekly": weekly_held.corr().to_numpy().tolist(),
                        "correlation_daily": daily_log[keys].corr().to_numpy().tolist(), "risk_free_rate": rf, "condition_number": float(np.linalg.cond(cov)),
                        "weeks_used": len(weekly_held)},
        "frontier.json": {"risk_free_rate": rf, "keys": keys, "caps": upper.tolist(), "mvp": {**mvp_stats, "weights": mvp.tolist()},
                          "orp": {**orp_stats, "weights": orp.tolist()}, "efficient": efficient_points, "inefficient": inefficient_points,
                          "cal_slope": orp_stats["sharpe"]},
        "risk.json": {"references": references, "stress": stress, "var_confidences": cfg.VAR_CONFIDENCES},
        "performance.json": {"sleeves": sleeve_ids, "months": [d.strftime("%Y-%m") for d in monthly_port.index], "port_returns": monthly_port.to_numpy().tolist(),
                             "bench_returns": monthly_bench.to_numpy().tolist(), "orp_sleeve_weights": orp_sleeves.tolist(),
                             "bench_sleeve_weights": bench_sleeves.tolist(), "sleeve_benchmarks": {k: meta_by_key.get(v["key"], {}).get("name", v["key"]) for k, v in cfg.SLEEVE_BENCHMARKS.items()},
                             "reference_brinson_orp": brinson_orp, "reference_rebalance_orp": reference_rebalance},
        "series.json": {"dates": dates, "keys": keys, "returns": returns_held.tolist(), "risk_free": rf_series.tolist(), "benchmark": bench_series.tolist()},
        "checks.json": {"generated_at_utc": now, "all_passed": not failed, "checks": checks},
    }
    manifest = {"schema_version": cfg.SCHEMA_VERSION, "generated_at_utc": now, "data_through": dates[-1],
                "yfinance_version": __import__("yfinance").__version__, "files": sorted(files)}

    if failed:
        print(f"{len(failed)} checks failed; keeping the previous data", flush=True)
        return 1
    with tempfile.TemporaryDirectory() as temp:
        staging = Path(temp)
        for name, content in files.items():
            digits = 8 if name in {"series.json", "performance.json"} else 6
            (staging / name).write_text(json.dumps(rounded(content, digits), separators=(",", ":")) + "\n")
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        OUT.mkdir(parents=True, exist_ok=True)
        for item in staging.iterdir():
            shutil.copy(item, OUT / item.name)
    print(f"Wrote {len(files) + 1} files to {OUT}", flush=True)
    return 0


def run_checks(orp, mvp, efficient, mu, cov, rf, references, brinson_orp, stress, upper, orp_stats) -> list[dict]:
    checks: list[dict] = []

    def check(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    check("ORP weights sum to one", abs(orp.sum() - 1) < 1e-8, f"sum={orp.sum():.10f}")
    check("MVP weights sum to one", abs(mvp.sum() - 1) < 1e-8, f"sum={mvp.sum():.10f}")
    worst_sum = max(abs(sum(p["weights"]) - 1) for p in efficient)
    check("Frontier weights sum to one", worst_sum < 1e-8, f"worst error={worst_sum:.2e}")
    weights_matrix = np.array([p["weights"] for p in efficient])
    check("Weights respect long-only bounds and caps", weights_matrix.min() >= -1e-9 and np.all(weights_matrix <= upper + 1e-7),
          f"min={weights_matrix.min():.2e}, largest cap excess={(weights_matrix - upper).max():.2e}")
    returns = np.array([p["expected_return"] for p in efficient])
    vols = np.array([p["volatility"] for p in efficient])
    check("Frontier is upward sloping and concave", an.is_concave_frontier(returns, vols),
          f"min second difference of volatility={np.diff(vols, 2).min():.2e}")
    check("MVP is the lowest-risk frontier point", vols.min() >= float(np.sqrt(mvp @ cov @ mvp)) - 1e-6, f"MVP vol={np.sqrt(mvp @ cov @ mvp):.4f}")
    best_sharpe = max(p["sharpe"] for p in efficient)
    check("Tangency Sharpe beats every frontier point", orp_stats["sharpe"] >= best_sharpe - 1e-6, f"ORP={orp_stats['sharpe']:.4f}, best point={best_sharpe:.4f}")
    check("Risk-free rate is plausible", 0.02 < rf < 0.12, f"rf={rf:.4f}")
    check("ORP earns a premium over risk-free", orp_stats["expected_return"] > rf, f"E={orp_stats['expected_return']:.4f}")
    eigen = np.linalg.eigvalsh(cov).min()
    check("Covariance matrix is positive definite", eigen > 0, f"smallest eigenvalue={eigen:.2e}")

    for label, block in references.items():
        volatility = block["daily_volatility"]
        for var in block["var"]:
            c = var["confidence"]
            positive = all(var[k] > 0 for k in ("var_parametric", "var_historical", "cvar_parametric", "cvar_historical"))
            ordered = var["cvar_historical"] >= var["var_historical"] and var["cvar_parametric"] >= var["var_parametric"]
            sized = 0.3 * volatility < var["var_historical"] < 5 * volatility
            check(f"{label} {c:.0%} VaR sign, order and size", positive and ordered and sized,
                  f"VaR/daily vol={var['var_historical'] / volatility:.2f}, CVaR={var['cvar_historical']:.4f}")
        perf = block["performance"]
        in_range = -1 < perf["sharpe"] < 5 and -1 < perf["sortino"] < 8 and np.isfinite(perf["treynor"])
        check(f"{label} performance ratios plausible", in_range and (perf["ann_return"] <= perf["ann_risk_free"] or perf["sharpe"] > 0),
              f"Sharpe={perf['sharpe']:.2f}, Sortino={perf['sortino']:.2f}, beta={perf['beta']:.2f}")
        check(f"{label} drawdown is negative", -1 < block["drawdown"]["max_drawdown"] < 0, f"MDD={block['drawdown']['max_drawdown']:.4f}")

    gap = brinson_orp["allocation_total"] + brinson_orp["selection_total"] - brinson_orp["active_return"]
    check("Brinson effects sum to active return", abs(gap) < 1e-8, f"residual={gap:.2e}")
    for scenario in stress:
        check(f"{scenario['name']} is a real drawdown", scenario["nifty_change"] < -0.15, f"Nifty {scenario['nifty_change']:.1%} from {scenario['start']} to {scenario['end']}")
    return checks


if __name__ == "__main__":
    sys.exit(main())
