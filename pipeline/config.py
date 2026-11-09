"""Universe, substitutions and modelling choices. Every value here is deliberate."""

SCHEMA_VERSION = "v1"
MIN_YEARS = 5.0
ANNUAL_RF_LOOKBACK_DAYS = 365

SLEEVES = [
    {"id": "india_equity", "name": "Indian Equity", "benchmark_weight": 0.50},
    {"id": "gold", "name": "Indian Gold", "benchmark_weight": 0.10},
    {"id": "india_debt", "name": "Indian Debt", "benchmark_weight": 0.20},
    {"id": "global_equity", "name": "Global Equity", "benchmark_weight": 0.15},
    {"id": "global_bonds", "name": "Global Bonds", "benchmark_weight": 0.05},
]

# Ordered candidates: the first to pass the runtime checks is used.
INSTRUMENTS = [
    {"key": "HDFCBANK", "name": "HDFC Bank", "sleeve": "india_equity", "sector": "Financials", "currency": "INR", "cap": 0.10, "tickers": ["HDFCBANK.NS"]},
    {"key": "ICICIBANK", "name": "ICICI Bank", "sleeve": "india_equity", "sector": "Financials", "currency": "INR", "cap": 0.10, "tickers": ["ICICIBANK.NS"]},
    {"key": "TCS", "name": "Tata Consultancy Services", "sleeve": "india_equity", "sector": "IT Services", "currency": "INR", "cap": 0.10, "tickers": ["TCS.NS"]},
    {"key": "INFY", "name": "Infosys", "sleeve": "india_equity", "sector": "IT Services", "currency": "INR", "cap": 0.10, "tickers": ["INFY.NS"]},
    {"key": "RELIANCE", "name": "Reliance Industries", "sleeve": "india_equity", "sector": "Energy", "currency": "INR", "cap": 0.10, "tickers": ["RELIANCE.NS"]},
    {"key": "NTPC", "name": "NTPC", "sleeve": "india_equity", "sector": "Utilities", "currency": "INR", "cap": 0.10, "tickers": ["NTPC.NS"]},
    {"key": "ITC", "name": "ITC", "sleeve": "india_equity", "sector": "Consumer Staples", "currency": "INR", "cap": 0.10, "tickers": ["ITC.NS"]},
    {"key": "HINDUNILVR", "name": "Hindustan Unilever", "sleeve": "india_equity", "sector": "Consumer Staples", "currency": "INR", "cap": 0.10, "tickers": ["HINDUNILVR.NS"]},
    {"key": "MARUTI", "name": "Maruti Suzuki", "sleeve": "india_equity", "sector": "Automobiles", "currency": "INR", "cap": 0.10, "tickers": ["MARUTI.NS"]},
    {"key": "LT", "name": "Larsen & Toubro", "sleeve": "india_equity", "sector": "Industrials", "currency": "INR", "cap": 0.10, "tickers": ["LT.NS"]},
    {"key": "BHARTIARTL", "name": "Bharti Airtel", "sleeve": "india_equity", "sector": "Telecom", "currency": "INR", "cap": 0.10, "tickers": ["BHARTIARTL.NS"]},
    {"key": "SUNPHARMA", "name": "Sun Pharmaceutical", "sleeve": "india_equity", "sector": "Healthcare", "currency": "INR", "cap": 0.10, "tickers": ["SUNPHARMA.NS"]},
    {"key": "GOLD", "name": "Nippon India ETF Gold BeES", "sleeve": "gold", "sector": "Gold", "currency": "INR", "cap": 0.25, "tickers": ["GOLDBEES.NS", "GOLD1.NS"]},
    {"key": "INDEBT", "name": "Bharat Bond ETF April 2030", "sleeve": "india_debt", "sector": "AAA PSU Bonds", "currency": "INR", "cap": 0.40, "tickers": ["EBBETF0430.NS", "LTGILTBEES.NS"]},
    {"key": "GLOBALEQ", "name": "iShares MSCI World ETF", "sleeve": "global_equity", "sector": "Developed Equity", "currency": "USD", "cap": 0.40, "tickers": ["URTH", "ACWI"]},
    {"key": "GLOBALBD", "name": "Vanguard Total International Bond ETF", "sleeve": "global_bonds", "sector": "Hedged Global Bonds", "currency": "USD", "cap": 0.40, "tickers": ["BNDX", "BND"]},
]

RISK_FREE = {"key": "RF", "name": "Nippon India Liquid Fund (Growth) NAV", "currency": "INR", "tickers": ["0P00005UPP.BO"]}
FX = {"key": "USDINR", "name": "USD/INR", "currency": "INR", "tickers": ["USDINR=X"]}
MARKET_BENCHMARK = {"key": "NIFTY", "name": "Nippon India ETF Nifty 50 BeES", "currency": "INR", "tickers": ["NIFTYBEES.NS", "^NSEI"]}

# Attribution benchmarks by sleeve. Gold and debt use the held instrument, so selection there is zero.
SLEEVE_BENCHMARKS = {
    "india_equity": {"key": "NIFTY"},
    "gold": {"key": "GOLD"},
    "india_debt": {"key": "INDEBT"},
    "global_equity": {"key": "ACWI", "name": "iShares MSCI ACWI ETF", "currency": "USD", "tickers": ["ACWI"]},
    "global_bonds": {"key": "AGG", "name": "iShares Core US Aggregate Bond ETF", "currency": "USD", "tickers": ["AGG"]},
}

# Instruments too young for 2008 are stood in for by the longest honest proxy.
STRESS_PROXIES = {
    "NSEI": {"name": "Nifty 50 index (price)", "currency": "INR", "ticker": "^NSEI"},
    "GSPC": {"name": "S&P 500 index (price), USD/INR adjusted", "currency": "USD", "ticker": "^GSPC"},
    "GOLD_FUT": {"name": "COMEX gold front future, USD/INR adjusted", "currency": "USD", "ticker": "GC=F"},
    "BND": {"name": "Vanguard Total Bond Market ETF, USD/INR adjusted", "currency": "USD", "ticker": "BND"},
}

STRESS_SCENARIOS = [
    {
        "id": "gfc_2008", "name": "2008 Global Financial Crisis", "search_start": "2008-01-01", "search_end": "2009-03-31",
        "note": "Peak to trough of the Nifty 50. Most vehicles did not exist yet, so each sleeve uses a stated proxy. "
                "Indian debt and cash are held flat because no clean series goes back that far.",
        "sources": {"india_equity": "NSEI", "gold": "GOLD_FUT", "india_debt": None, "global_equity": "GSPC", "global_bonds": "BND", "cash": None},
    },
    {
        "id": "covid_2020", "name": "2020 COVID Crash", "search_start": "2020-01-01", "search_end": "2020-04-30",
        "note": "Peak to trough of the Nifty 50, replayed on the actual instruments held.",
        "sources": {"india_equity": "PANEL", "gold": "PANEL", "india_debt": "PANEL", "global_equity": "PANEL", "global_bonds": "PANEL", "cash": "PANEL"},
    },
]

SUBSTITUTIONS = [
    {"requested": "LIQUIDBEES.NS", "replaced_by": "0P00005UPP.BO", "role": "Risk-free anchor",
     "reason": "Half of its daily price returns are exactly zero because yield is paid out as extra units, so the price understates the true return."},
    {"requested": "SETF10GILT.NS", "replaced_by": "EBBETF0430.NS", "role": "Indian debt",
     "reason": "Yahoo returns only about 0.3 years of history for this ticker, far short of the five-year rule."},
    {"requested": "VT", "replaced_by": "URTH", "role": "Global equity",
     "reason": "Both resolve cleanly. URTH holds developed markets only, while VT holds India and would double-count the Indian sleeve."},
]

FRONTIER_POINTS = 60
VAR_CONFIDENCES = [0.95, 0.99]
REFERENCE_RISK_AVERSIONS = [2, 4, 6, 8]
DEFAULT_REBALANCE_BAND = 0.05
DEFAULT_ONE_WAY_COST = 0.001
