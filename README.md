# Wealth Command Center

A private wealth and portfolio construction platform that reads the way a boutique wealth manager would present it to a client: **profile the investor, build the allocation, examine the risk, attribute the performance, plan the rebalancing, then test whether the goal is reachable.**

It brings together three strands of study: Markowitz mean-variance optimisation from investment analysis and portfolio management, VaR and stress testing from financial risk management, and client-facing risk profiling and goals-based planning from wealth management. It is an independent passion project, built out of a genuine interest in investment banking and wealth management.

**Live site:** https://palakguptajiit6-design.github.io/wealth-command-center/

Plain HTML, CSS and JavaScript with Chart.js. No framework, no build step, no backend and **no API keys anywhere**. The browser only reads static JSON committed to this repository.

## The six modules

| # | Module | What it does |
|---|---|---|
| 01 | **Client Profile** | Eight questions score capacity and willingness for risk. The lower governs and maps to the risk aversion coefficient A in `U = E(r) − ½Aσ²`. |
| 02 | **Allocation** | A 16-instrument efficient frontier solved by quadratic programming in SciPy and shipped precomputed, with the minimum variance portfolio, tangency portfolio, capital allocation line and the client's optimal complete portfolio. A slider overrides the questionnaire. |
| 03 | **Risk & Stress** | Parametric and historical VaR, parametric and historical CVaR, maximum drawdown, a full correlation heatmap and replays of the 2008 and 2020 crises on the current allocation. |
| 04 | **Performance** | Sharpe, Sortino, Treynor, Jensen's alpha and tracking error against the Nifty 50, with Brinson attribution into allocation and selection effects. |
| 05 | **Rebalancing** | Daily drift under buy and hold against a configurable tolerance band, net of trading costs. |
| 06 | **Goals** | A browser-side Monte Carlo of up to 25,000 paths from the portfolio's expected return and volatility, giving the probability of reaching a target corpus and a fan chart. |

## Universe

Every ticker was checked in yfinance for at least five years of clean daily history before being accepted. The full report is in `data/validation/universe_report.json`.

| Sleeve | Instruments |
|---|---|
| Indian equity | HDFCBANK, ICICIBANK, TCS, INFY, RELIANCE, NTPC, ITC, HINDUNILVR, MARUTI, LT, BHARTIARTL, SUNPHARMA (`.NS`) |
| Indian gold | `GOLDBEES.NS` |
| Indian debt | `EBBETF0430.NS` |
| Global equity | `URTH` |
| Global bonds | `BNDX` |
| Risk-free anchor | `0P00005UPP.BO` (Nippon India Liquid Fund NAV) |
| Benchmarks and FX | `NIFTYBEES.NS`, `ACWI`, `AGG`, `USDINR=X` |

**Substitutions.** `LIQUIDBEES.NS` was replaced as the risk-free series because half of its daily price returns are exactly zero, with yield paid out as extra units. `SETF10GILT.NS` was rejected because Yahoo returns only about 0.3 years of history. `URTH` was preferred to `VT` because `VT` holds India and would double-count the Indian sleeve.

## How it works

```
GitHub Actions, weekly (Saturday 07:00 IST)
  └─ pipeline/build_data.py
       ├─ fetch.py       yfinance download, bad-tick filter, USD to INR conversion
       ├─ analytics.py   log returns, covariance, Bayes-Stein means, SLSQP frontier,
       │                 VaR and CVaR, drawdown, performance, Brinson, rebalancing
       └─ 49 sanity checks. Data is replaced only if all of them pass.
            └─ data/v1/*.json, committed to the repository
                 └─ site/ reads the JSON passively
```

The refresh is weekly because this is a long-horizon strategic tool, and weekly returns reduce the correlation bias from Indian and US markets closing at different times.

## Modelling choices

- **Returns** are in rupees. Weekly log returns give the covariance matrix; daily simple returns drive VaR, drawdown and rebalancing.
- **Expected returns** use Bayes-Stein shrinkage toward the minimum-variance mean, because raw historical means are too noisy to optimise on.
- **Constraints** are long only, with limits of 10% per stock, 25% for gold and 40% for each other fund.
- **No borrowing.** When y* is at or below one, the client mixes the tangency portfolio with the risk-free asset. Above one, the client moves along the frontier to the highest-utility point.
- **Risk-free rate** is the trailing one-year return of the liquid fund.
- **Benchmark policy for attribution** is 50% Indian equity, 10% gold, 20% Indian debt, 15% global equity and 5% global bonds.

## Known limitations

- The window starts on 30 December 2019, when the Indian debt ETF listed, so estimates rest on under seven years of data.
- Performance, attribution and rebalancing results are in-sample: the weights use the same history they are measured on.
- Most instruments did not exist in 2008. That scenario uses stated proxies, and holds Indian debt and cash flat.
- `EBBETF0430.NS` matures in April 2030 and will need replacing before then.

## Run it locally

```bash
pip install -r pipeline/requirements.txt
python pipeline/build_data.py
python -m http.server 8000     # then open http://localhost:8000/site/
```

For education only. Nothing here is investment advice.
