"""Portfolio mathematics used by the build. Pure functions over numpy and pandas."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import linprog, minimize
from scipy.stats import norm

TRADING_DAYS = 252
WEEKS = 52


def bayes_stein_mean(weekly_log_returns: pd.DataFrame) -> tuple[np.ndarray, float]:
    """Jorion (1986) shrinkage of sample means toward the minimum-variance mean."""
    sample_mean = weekly_log_returns.mean().to_numpy()
    sample_cov = weekly_log_returns.cov().to_numpy()
    observations, assets = weekly_log_returns.shape
    inverse = np.linalg.inv(sample_cov)
    ones = np.ones(assets)
    grand_mean = float(ones @ inverse @ sample_mean / (ones @ inverse @ ones))
    deviation = sample_mean - grand_mean
    intensity = (assets + 2) / ((assets + 2) + observations * float(deviation @ inverse @ deviation))
    return (1 - intensity) * sample_mean + intensity * grand_mean, float(intensity)


def annual_arithmetic_mean(weekly_log_mean: np.ndarray, weekly_log_var: np.ndarray) -> np.ndarray:
    """Lognormal conversion from weekly log moments to an annual simple expected return."""
    return np.exp(WEEKS * weekly_log_mean + 0.5 * WEEKS * weekly_log_var) - 1


def _solve_qp(cov: np.ndarray, upper: np.ndarray, start: np.ndarray, equalities: list[dict]) -> np.ndarray:
    def objective(weights: np.ndarray) -> float:
        return float(weights @ cov @ weights)

    def gradient(weights: np.ndarray) -> np.ndarray:
        return 2 * cov @ weights

    budget = {"type": "eq", "fun": lambda w: w.sum() - 1, "jac": lambda w: np.ones_like(w)}
    result = minimize(objective, start, jac=gradient, method="SLSQP", bounds=[(0.0, u) for u in upper],
                      constraints=[budget, *equalities], options={"maxiter": 2000, "ftol": 1e-13})
    if not result.success:
        raise RuntimeError(f"quadratic program failed: {result.message}")
    return _clean(result.x)


def _clean(weights: np.ndarray) -> np.ndarray:
    cleaned = np.where(np.abs(weights) < 1e-7, 0.0, weights)
    return cleaned / cleaned.sum()


def feasible_start(upper: np.ndarray) -> np.ndarray:
    return upper / upper.sum()


def minimum_variance(cov: np.ndarray, upper: np.ndarray) -> np.ndarray:
    return _solve_qp(cov, upper, feasible_start(upper), [])


def _extreme_return(mu: np.ndarray, upper: np.ndarray, sign: float) -> np.ndarray:
    result = linprog(-sign * mu, A_eq=np.ones((1, len(mu))), b_eq=[1.0], bounds=[(0.0, u) for u in upper], method="highs")
    if not result.success:
        raise RuntimeError(f"linear program failed: {result.message}")
    return _clean(result.x)


def _target_portfolio(mu: np.ndarray, cov: np.ndarray, upper: np.ndarray, target: float, start: np.ndarray) -> np.ndarray:
    return _solve_qp(cov, upper, start, [{"type": "eq", "fun": lambda w: (w @ mu - target) * 100, "jac": lambda w: mu * 100}])


def describe(weights: np.ndarray, mu: np.ndarray, cov: np.ndarray, rf: float) -> dict:
    expected = float(weights @ mu)
    volatility = float(np.sqrt(weights @ cov @ weights))
    return {"expected_return": expected, "volatility": volatility, "sharpe": (expected - rf) / volatility}


def efficient_frontier(mu: np.ndarray, cov: np.ndarray, upper: np.ndarray, rf: float, points: int = 60) -> dict:
    mvp = minimum_variance(cov, upper)
    mvp_return = float(mvp @ mu)
    top = _extreme_return(mu, upper, 1.0)
    bottom = _extreme_return(mu, upper, -1.0)

    efficient: list[np.ndarray] = []
    start = mvp
    for target in np.linspace(mvp_return, float(top @ mu), points):
        start = mvp if target == mvp_return else _target_portfolio(mu, cov, upper, float(target), start)
        efficient.append(start)

    inefficient: list[np.ndarray] = []
    start = mvp
    for target in np.linspace(mvp_return, float(bottom @ mu), 16)[1:]:
        start = _target_portfolio(mu, cov, upper, float(target), start)
        inefficient.append(start)

    best = max(efficient, key=lambda w: describe(w, mu, cov, rf)["sharpe"])

    def negative_sharpe(weights: np.ndarray) -> float:
        return -(weights @ mu - rf) / np.sqrt(weights @ cov @ weights)

    budget = {"type": "eq", "fun": lambda w: w.sum() - 1, "jac": lambda w: np.ones_like(w)}
    refined = minimize(negative_sharpe, best, method="SLSQP", bounds=[(0.0, u) for u in upper],
                       constraints=[budget], options={"maxiter": 2000, "ftol": 1e-13})
    tangency = _clean(refined.x) if refined.success else best
    if describe(tangency, mu, cov, rf)["sharpe"] < describe(best, mu, cov, rf)["sharpe"]:
        tangency = best
    return {"mvp": mvp, "tangency": tangency, "efficient": efficient, "inefficient": inefficient}


def is_concave_frontier(returns: np.ndarray, volatilities: np.ndarray, tolerance: float = 1e-5) -> bool:
    """On evenly spaced returns, volatility must rise and be convex, which makes return concave in risk."""
    return bool(np.all(np.diff(volatilities) > -tolerance) and np.all(np.diff(volatilities, 2) > -tolerance))


def max_drawdown(returns: pd.Series) -> dict:
    wealth = (1 + returns).cumprod()
    wealth = pd.concat([pd.Series([1.0], index=[returns.index[0] - pd.Timedelta(days=1)]), wealth])
    drawdown = wealth / wealth.cummax() - 1
    trough = drawdown.idxmin()
    peak = wealth.loc[:trough].idxmax()
    return {"max_drawdown": float(drawdown.min()), "peak": peak.strftime("%Y-%m-%d"), "trough": trough.strftime("%Y-%m-%d")}


def value_at_risk(returns: pd.Series, confidence: float) -> dict:
    """All measures are returned as positive daily loss fractions."""
    mean = float(returns.mean())
    deviation = float(returns.std())
    tail = 1 - confidence
    z = float(norm.ppf(tail))
    cutoff = float(returns.quantile(tail))
    return {
        "confidence": confidence,
        "var_parametric": -(mean + z * deviation),
        "var_historical": -cutoff,
        "cvar_parametric": deviation * float(norm.pdf(z)) / tail - mean,
        "cvar_historical": -float(returns[returns <= cutoff].mean()),
    }


def performance(returns: pd.Series, risk_free: pd.Series, benchmark: pd.Series) -> dict:
    excess = returns - risk_free
    market_excess = benchmark - risk_free
    years = len(returns) / TRADING_DAYS
    ann_return = float((1 + returns).prod() ** (1 / years) - 1)
    ann_benchmark = float((1 + benchmark).prod() ** (1 / years) - 1)
    ann_rf = float((1 + risk_free).prod() ** (1 / years) - 1)
    ann_vol = float(returns.std() * np.sqrt(TRADING_DAYS))
    ann_excess_mean = float(excess.mean() * TRADING_DAYS)
    downside = float(np.sqrt((np.minimum(excess, 0) ** 2).mean()) * np.sqrt(TRADING_DAYS))
    beta = float(np.cov(excess, market_excess, ddof=1)[0, 1] / market_excess.var())
    active = returns - benchmark
    tracking_error = float(active.std() * np.sqrt(TRADING_DAYS))
    return {
        "ann_return": ann_return, "ann_volatility": ann_vol, "ann_risk_free": ann_rf, "ann_benchmark": ann_benchmark,
        "sharpe": ann_excess_mean / ann_vol, "sortino": ann_excess_mean / downside, "downside_deviation": downside,
        "beta": beta, "treynor": (ann_return - ann_rf) / beta,
        "jensen_alpha": ann_return - (ann_rf + beta * (ann_benchmark - ann_rf)),
        "tracking_error": tracking_error,
        "information_ratio": float(active.mean() * TRADING_DAYS) / tracking_error if tracking_error > 1e-12 else 0.0,
    }


def brinson(port_weights: np.ndarray, bench_weights: np.ndarray, port_returns: np.ndarray, bench_returns: np.ndarray) -> dict:
    """Brinson-Fachler effects by month and sleeve, linked with Carino smoothing.

    Interaction is held inside selection, so the two effects add up to active return.
    Inputs are months-by-sleeves return arrays and sleeve weight vectors.
    """
    total_port = (port_returns * port_weights).sum(axis=1)
    total_bench = (bench_returns * bench_weights).sum(axis=1)
    allocation = (port_weights - bench_weights) * (bench_returns - total_bench[:, None])
    selection = port_weights * (port_returns - bench_returns)

    cumulative_port = float(np.prod(1 + total_port) - 1)
    cumulative_bench = float(np.prod(1 + total_bench) - 1)

    def carino(portfolio: float | np.ndarray, benchmark: float | np.ndarray):
        portfolio, benchmark = np.asarray(portfolio, float), np.asarray(benchmark, float)
        same = np.isclose(portfolio, benchmark)
        ratio = np.divide(np.log1p(portfolio) - np.log1p(benchmark), portfolio - benchmark,
                          out=np.zeros_like(portfolio), where=~same)
        return np.where(same, 1 / (1 + portfolio), ratio)

    period = carino(total_port, total_bench)
    overall = float(carino(cumulative_port, cumulative_bench))
    scale = period / overall
    linked_allocation = (allocation * scale[:, None]).sum(axis=0)
    linked_selection = (selection * scale[:, None]).sum(axis=0)
    return {
        "portfolio_return": cumulative_port, "benchmark_return": cumulative_bench,
        "active_return": cumulative_port - cumulative_bench,
        "allocation_by_sleeve": linked_allocation.tolist(), "selection_by_sleeve": linked_selection.tolist(),
        "allocation_total": float(linked_allocation.sum()), "selection_total": float(linked_selection.sum()),
    }


def rebalance_backtest(returns: np.ndarray, target: np.ndarray, band: float, cost: float, relative: bool = False) -> dict:
    """Daily drift against a tolerance band. A band of None is pure buy and hold.

    returns is days-by-assets. When any asset breaches, the whole book returns to target.
    cost is charged per unit of traded notional, on both buys and sells.
    """
    weights = target.copy()
    value = 1.0
    path, drift = [], []
    rebalances = 0
    traded = 0.0
    costs = 0.0
    for day in returns:
        growth = weights * (1 + day)
        gross = float(growth.sum())
        value *= gross
        weights = growth / gross
        if band is not None:
            gap = np.abs(weights - target)
            breached = gap > band * target if relative else gap > band
            active = target > 0 if relative else np.ones_like(target, dtype=bool)
            if np.any(breached & active):
                turnover = float(np.abs(target - weights).sum())
                fee = turnover * cost
                value *= 1 - fee
                traded += turnover
                costs += fee
                rebalances += 1
                weights = target.copy()
        path.append(value)
        drift.append(float(np.abs(weights - target).sum() / 2))
    return {"final_value": value, "rebalances": rebalances, "turnover": traded, "cost_drag": costs,
            "path": path, "average_drift": float(np.mean(drift))}
