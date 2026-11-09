/* Shared data, client state and calculations. Reads committed JSON only; makes no live market calls. */
window.WCC = (function () {
  "use strict";

  const DATA_FILES = ["manifest", "universe", "market", "frontier", "risk", "performance", "series"];
  const SERIES_COLORS = { india_equity: "#3987e5", gold: "#d95926", india_debt: "#199e70", global_equity: "#c98500", global_bonds: "#d55181", cash: "#7f8ea3" };
  const INK = { primary: "#e6edf7", secondary: "#9fb0c3", muted: "#7f8ea3", grid: "rgba(255,255,255,0.06)", axis: "rgba(255,255,255,0.14)" };

  const modules = [];
  const listeners = [];
  const charts = {};
  const state = { A: 6, source: "default", activeTab: null };
  let cachedClient = null;

  const api = { data: {}, state, modules, SERIES_COLORS, INK };

  api.register = function (module) {
    modules.push(module);
    modules.sort((a, b) => a.order - b.order);
  };

  api.loadData = async function () {
    const stamp = Date.now();
    const manifest = await (await fetch("../data/v1/manifest.json?t=" + stamp)).json();
    const version = encodeURIComponent(manifest.generated_at_utc);
    const parts = await Promise.all(DATA_FILES.map(async (name) => {
      const response = await fetch("../data/v1/" + name + ".json?v=" + version);
      if (!response.ok) throw new Error("Could not load " + name);
      return [name, await response.json()];
    }));
    parts.forEach(([name, value]) => { api.data[name] = value; });
    api.data.seriesLength = api.data.series.dates.length;
  };

  api.setA = function (value, source) {
    state.A = Math.max(1, Math.min(20, Number(value)));
    state.source = source;
    cachedClient = null;
    listeners.forEach((fn) => fn());
  };
  api.onChange = (fn) => listeners.push(fn);

  /* Maths helpers */
  const sum = (values) => values.reduce((total, v) => total + v, 0);
  const mean = (values) => sum(values) / values.length;
  function stdev(values) {
    const m = mean(values);
    return Math.sqrt(values.reduce((t, v) => t + (v - m) * (v - m), 0) / (values.length - 1));
  }
  function covariance(a, b) {
    const ma = mean(a), mb = mean(b);
    return a.reduce((t, v, i) => t + (v - ma) * (b[i] - mb), 0) / (a.length - 1);
  }
  function quantile(values, q) {
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const fraction = position - low;
    return low + 1 < sorted.length ? sorted[low] + fraction * (sorted[low + 1] - sorted[low]) : sorted[low];
  }
  /* Inverse standard normal CDF (Acklam). */
  function normInv(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469876, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const low = 0.02425;
    let q, r;
    if (p < low) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= 1 - low) {
      q = p - 0.5; r = q * q;
      return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  api.math = { sum, mean, stdev, covariance, quantile, normInv, normPdf };

  /* Model volatility from the annual covariance matrix. */
  api.portfolioVolatility = function (weights) {
    const cov = api.data.market.covariance_annual;
    let variance = 0;
    for (let i = 0; i < weights.length; i++) for (let j = 0; j < weights.length; j++) variance += weights[i] * weights[j] * cov[i][j];
    return Math.sqrt(variance);
  };

  /* Optimal complete portfolio for a risk aversion, matching the pipeline's no-borrowing rule. */
  api.solveClient = function (A) {
    const frontier = api.data.frontier;
    const mu = api.data.market.expected_return;
    const rf = frontier.risk_free_rate;
    const orp = frontier.orp;
    const yStar = (orp.expected_return - rf) / (A * orp.volatility * orp.volatility);
    let weights, cash, y, onCal;
    if (yStar <= 1) {
      y = yStar; cash = 1 - yStar; onCal = true;
      weights = orp.weights.map((w) => w * yStar);
    } else {
      y = 1; cash = 0; onCal = false;
      let best = null, bestUtility = -Infinity;
      frontier.efficient.forEach((point) => {
        if (point.expected_return < orp.expected_return) return;
        const utility = point.expected_return - 0.5 * A * point.volatility * point.volatility;
        if (utility > bestUtility) { bestUtility = utility; best = point; }
      });
      weights = (best || orp).weights.slice();
    }
    const total = sum(weights) + cash;
    weights = weights.map((w) => w / total);
    cash /= total;
    const expected = sum(weights.map((w, i) => w * mu[i])) + cash * rf;
    const volatility = api.portfolioVolatility(weights);
    return { A, yStar, y, cash, onCal, weights, expected, volatility, utility: expected - 0.5 * A * volatility * volatility };
  };

  api.client = function () {
    if (!cachedClient || cachedClient.A !== state.A) cachedClient = api.solveClient(state.A);
    return cachedClient;
  };

  api.dailySeries = function (client) {
    const { returns, risk_free: rf } = api.data.series;
    return returns.map((row, day) => {
      let total = client.cash * rf[day];
      for (let i = 0; i < row.length; i++) total += client.weights[i] * row[i];
      return total;
    });
  };

  /* Sleeve weights in the order sleeves, then cash. */
  api.sleeveWeights = function (client) {
    const { sleeves, instruments } = api.data.universe;
    const list = sleeves.map((s) => sum(instruments.map((inst, i) => (inst.sleeve === s.id ? client.weights[i] : 0))));
    list.push(client.cash);
    return list;
  };
  api.sleeveNames = function () { return api.data.universe.sleeves.map((s) => s.name).concat("Cash"); };
  api.sleeveIds = function () { return api.data.universe.sleeves.map((s) => s.id).concat("cash"); };

  /* All four measures are positive one-day loss fractions. */
  api.valueAtRisk = function (returns, confidence) {
    const m = mean(returns), s = stdev(returns), tail = 1 - confidence, z = normInv(tail), cutoff = quantile(returns, tail);
    const tailValues = returns.filter((r) => r <= cutoff);
    return { confidence, var_parametric: -(m + z * s), var_historical: -cutoff,
      cvar_parametric: (s * normPdf(z)) / tail - m, cvar_historical: -mean(tailValues), cutoff, mean: m, stdev: s };
  };

  /* Formatting */
  api.fmt = {
    pct: (v, digits = 1) => (v * 100).toFixed(digits) + "%",
    signedPct: (v, digits = 1) => (v >= 0 ? "+" : "") + (v * 100).toFixed(digits) + "%",
    num: (v, digits = 2) => Number(v).toFixed(digits),
    inr: (v) => "₹" + Math.round(v).toLocaleString("en-IN"),
    inrCompact: function (v) {
      const abs = Math.abs(v), sign = v < 0 ? "−" : "";
      if (abs >= 1e7) return sign + "₹" + (abs / 1e7).toFixed(2) + " Cr";
      if (abs >= 1e5) return sign + "₹" + (abs / 1e5).toFixed(1) + " L";
      return sign + "₹" + Math.round(abs).toLocaleString("en-IN");
    },
    date: function (iso) {
      const d = new Date(iso + "T00:00:00Z");
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    },
  };

  /* Shared allocation bar and legend, drawn in HTML. */
  api.renderAllocation = function (barEl, legendEl, client) {
    const weights = api.sleeveWeights(client), ids = api.sleeveIds(), names = api.sleeveNames();
    barEl.innerHTML = weights.map((w, i) => (w > 0.0005
      ? '<span style="width:' + (w * 100).toFixed(2) + "%;background:" + SERIES_COLORS[ids[i]] + '" title="' + names[i] + " " + api.fmt.pct(w) + '"></span>' : "")).join("");
    legendEl.innerHTML = weights.map((w, i) => '<div><span class="swatch" style="background:' + SERIES_COLORS[ids[i]] + '"></span>' + names[i] + "<b>" + api.fmt.pct(w) + "</b></div>").join("");
  };

  /* Chart.js defaults and helpers */
  api.setupCharts = function () {
    Chart.defaults.color = INK.secondary;
    Chart.defaults.font.family = '-apple-system, "Segoe UI", system-ui, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.animation = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.position = "bottom";
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxHeight = 7;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = "#131826";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(0,240,255,0.25)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = INK.primary;
    Chart.defaults.plugins.tooltip.bodyColor = INK.secondary;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.scale.grid.color = INK.grid;
    Chart.defaults.scale.border.color = INK.axis;
    Chart.register({
      id: "directLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((dataset, index) => {
          if (!dataset.directLabel || !chart.isDatasetVisible(index)) return;
          const meta = chart.getDatasetMeta(index);
          const element = meta.data[dataset.directLabelIndex === undefined ? 0 : dataset.directLabelIndex];
          if (!element) return;
          ctx.save();
          ctx.font = "600 11px " + Chart.defaults.font.family;
          ctx.fillStyle = INK.primary;
          ctx.textAlign = dataset.directLabelAlign || "left";
          ctx.textBaseline = "middle";
          ctx.fillText(dataset.directLabel, element.x + (dataset.directLabelDx === undefined ? 10 : dataset.directLabelDx), element.y + (dataset.directLabelDy || 0));
          ctx.restore();
        });
      },
    });
  };

  api.chart = function (id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
    return charts[id];
  };

  return api;
})();
