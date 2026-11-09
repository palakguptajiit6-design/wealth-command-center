/* Module 4: risk-adjusted performance and Brinson attribution. */
(function () {
  "use strict";
  const { fmt, math } = WCC;
  const TRADING_DAYS = 252;
  let panel;

  function performance(returns, riskFree, benchmark) {
    const excess = returns.map((r, i) => r - riskFree[i]);
    const marketExcess = benchmark.map((r, i) => r - riskFree[i]);
    const years = returns.length / TRADING_DAYS;
    const growth = (series) => series.reduce((value, r) => value * (1 + r), 1);
    const annReturn = Math.pow(growth(returns), 1 / years) - 1;
    const annBenchmark = Math.pow(growth(benchmark), 1 / years) - 1;
    const annRf = Math.pow(growth(riskFree), 1 / years) - 1;
    const annVol = math.stdev(returns) * Math.sqrt(TRADING_DAYS);
    const annExcessMean = math.mean(excess) * TRADING_DAYS;
    const downside = Math.sqrt(math.mean(excess.map((r) => Math.pow(Math.min(r, 0), 2)))) * Math.sqrt(TRADING_DAYS);
    const beta = math.covariance(excess, marketExcess) / math.covariance(marketExcess, marketExcess);
    const active = returns.map((r, i) => r - benchmark[i]);
    const trackingError = math.stdev(active) * Math.sqrt(TRADING_DAYS);
    return {
      ann_return: annReturn, ann_volatility: annVol, ann_risk_free: annRf, ann_benchmark: annBenchmark,
      sharpe: annExcessMean / annVol, sortino: annExcessMean / downside, downside_deviation: downside, beta,
      treynor: (annReturn - annRf) / beta, jensen_alpha: annReturn - (annRf + beta * (annBenchmark - annRf)),
      tracking_error: trackingError, information_ratio: trackingError > 1e-12 ? (math.mean(active) * TRADING_DAYS) / trackingError : 0,
    };
  }

  /* Monthly sleeve returns for this client's within-sleeve mix. */
  function monthlySleeveReturns(client) {
    const perf = WCC.data.performance, { dates, returns, risk_free: rf } = WCC.data.series, { instruments, sleeves } = WCC.data.universe;
    const position = new Map(perf.months.map((month, i) => [month, i]));
    const members = sleeves.map((s) => instruments.map((inst, i) => (inst.sleeve === s.id ? i : -1)).filter((i) => i >= 0));
    const held = members.map((list) => math.sum(list.map((i) => client.weights[i])));
    const growth = perf.months.map(() => new Array(sleeves.length + 1).fill(1));
    dates.forEach((date, day) => {
      const month = position.get(date.slice(0, 7));
      if (month === undefined) return;
      members.forEach((list, s) => {
        if (held[s] > 1e-9) growth[month][s] *= 1 + math.sum(list.map((i) => (client.weights[i] / held[s]) * returns[day][i]));
      });
      growth[month][sleeves.length] *= 1 + rf[day];
    });
    return growth.map((row, m) => row.map((value, s) => (s < sleeves.length && held[s] <= 1e-9 ? perf.bench_returns[m][s] : value - 1)));
  }

  /* Brinson-Fachler with interaction inside selection, linked over months with Carino smoothing. */
  function brinson(portWeights, benchWeights, portReturns, benchReturns) {
    const sleeves = portWeights.length;
    const totalPort = portReturns.map((row) => math.sum(row.map((r, s) => r * portWeights[s])));
    const totalBench = benchReturns.map((row) => math.sum(row.map((r, s) => r * benchWeights[s])));
    const cumulative = (series) => series.reduce((value, r) => value * (1 + r), 1) - 1;
    const cumPort = cumulative(totalPort), cumBench = cumulative(totalBench);
    const carino = (p, b) => (Math.abs(p - b) < 1e-12 * Math.max(1, Math.abs(p)) ? 1 / (1 + p) : (Math.log1p(p) - Math.log1p(b)) / (p - b));
    const overall = carino(cumPort, cumBench);
    const allocation = new Array(sleeves).fill(0), selection = new Array(sleeves).fill(0);
    totalPort.forEach((p, m) => {
      const scale = carino(p, totalBench[m]) / overall;
      for (let s = 0; s < sleeves; s++) {
        allocation[s] += (portWeights[s] - benchWeights[s]) * (benchReturns[m][s] - totalBench[m]) * scale;
        selection[s] += portWeights[s] * (portReturns[m][s] - benchReturns[m][s]) * scale;
      }
    });
    return { portfolio_return: cumPort, benchmark_return: cumBench, active_return: cumPort - cumBench, allocation_by_sleeve: allocation, selection_by_sleeve: selection,
      allocation_total: math.sum(allocation), selection_total: math.sum(selection) };
  }

  function clientBrinson(client) {
    const perf = WCC.data.performance;
    return brinson(WCC.sleeveWeights(client), perf.bench_sleeve_weights, monthlySleeveReturns(client), perf.bench_returns);
  }
  WCC.performance = { performance, clientBrinson };

  function init(root) {
    panel = root;
    root.innerHTML = `
      <p class="notice"><strong>Read this as an illustration, not a track record.</strong> The weights were chosen using the same history they are measured on, so these results benefit from hindsight, and a real investor could not have earned them.</p>
      <div class="stat-row" id="perf-stats"></div>
      <div class="two-col">
        <div class="card"><h2 class="card-title">Growth of ₹100</h2><p class="card-desc">Daily-rebalanced to today's weights, against the Nifty 50 BeES ETF.</p><div class="chart-box"><canvas id="chart-growth" role="img" aria-label="Growth of 100 rupees, portfolio against Nifty 50"></canvas></div></div>
        <div class="card"><h2 class="card-title">Portfolio Against the Nifty 50</h2><div class="table-wrap"><table class="data" id="perf-table"></table></div></div>
      </div>
      <div class="card">
        <h2 class="card-title">Brinson Attribution</h2>
        <p class="card-desc" id="perf-brinson-desc"></p>
        <div class="two-col">
          <div class="chart-box"><canvas id="chart-brinson" role="img" aria-label="Allocation and selection effect by sleeve"></canvas></div>
          <div class="table-wrap"><table class="data" id="perf-brinson"></table></div>
        </div>
        <p class="card-desc" id="perf-bench-note" style="margin-top:12px"></p>
      </div>`;
  }

  function render() {
    const get = (id) => panel.querySelector("#" + id);
    const client = WCC.client();
    const series = WCC.data.series;
    const daily = WCC.dailySeries(client);
    const p = performance(daily, series.risk_free, series.benchmark);
    const n = performance(series.benchmark, series.risk_free, series.benchmark);
    const tile = (label, value, sub) => `<div class="stat-box"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
    get("perf-stats").innerHTML = tile("Sharpe", fmt.num(p.sharpe), "excess return ÷ volatility") + tile("Sortino", fmt.num(p.sortino), "excess return ÷ downside dev.") +
      tile("Treynor", fmt.pct(p.treynor), "excess return ÷ beta") + tile("Jensen's Alpha", fmt.signedPct(p.jensen_alpha), "above CAPM return") + tile("Tracking Error", fmt.pct(p.tracking_error), "against the Nifty 50");
    const rows = [
      ["Annual return", fmt.pct(p.ann_return), fmt.pct(n.ann_return)], ["Annual volatility", fmt.pct(p.ann_volatility), fmt.pct(n.ann_volatility)],
      ["Downside deviation", fmt.pct(p.downside_deviation), fmt.pct(n.downside_deviation)], ["Sharpe ratio", fmt.num(p.sharpe), fmt.num(n.sharpe)], ["Sortino ratio", fmt.num(p.sortino), fmt.num(n.sortino)],
      ["Beta to Nifty 50", fmt.num(p.beta), fmt.num(n.beta)], ["Treynor ratio", fmt.pct(p.treynor), fmt.pct(n.treynor)], ["Jensen's alpha", fmt.signedPct(p.jensen_alpha), "—"],
      ["Tracking error", fmt.pct(p.tracking_error), "—"], ["Information ratio", fmt.num(p.information_ratio), "—"], ["Risk-free return (period)", fmt.pct(p.ann_risk_free), fmt.pct(n.ann_risk_free)],
    ];
    get("perf-table").innerHTML = "<thead><tr><th>Measure</th><th>Portfolio</th><th>Nifty 50</th></tr></thead><tbody>" + rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("") + "</tbody>";

    const labels = [], a = [], b = [];
    let va = 100, vb = 100;
    series.dates.forEach((date, i) => { va *= 1 + daily[i]; vb *= 1 + series.benchmark[i]; if (i % 5 === 0 || i === series.dates.length - 1) { labels.push(date); a.push(va); b.push(vb); } });
    WCC.chart("chart-growth", { type: "line", data: { labels, datasets: [
      { label: "Portfolio", data: a, borderColor: "#3987e5", borderWidth: 2, pointRadius: 0 }, { label: "Nifty 50", data: b, borderColor: "#d95926", borderWidth: 2, pointRadius: 0 } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback(v) { return this.getLabelForValue(v).slice(0, 7); } } }, y: { ticks: { callback: (v) => "₹" + v } } },
        plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": ₹" + ctx.parsed.y.toFixed(1) } } } } });

    const result = clientBrinson(client);
    const perf = WCC.data.performance, names = WCC.sleeveNames(), weights = WCC.sleeveWeights(client), ids = WCC.sleeveIds();
    const driver = Math.abs(result.allocation_total) >= Math.abs(result.selection_total) ? "the choice of asset classes (allocation)" : "the instruments picked within them (selection)";
    get("perf-brinson-desc").innerHTML = `Over ${perf.months.length} months the portfolio returned <strong>${fmt.pct(result.portfolio_return)}</strong> against <strong>${fmt.pct(result.benchmark_return)}</strong> for the policy benchmark, an active return of <strong>${fmt.signedPct(result.active_return)}</strong>. Most of the difference came from ${driver}.`;
    const cls = (v) => (v > 0.00005 ? "pos" : v < -0.00005 ? "neg" : "");
    get("perf-brinson").innerHTML = "<thead><tr><th>Sleeve</th><th>Port.</th><th>Bench.</th><th>Allocation</th><th>Selection</th><th>Total</th></tr></thead><tbody>" +
      names.map((name, s) => { const x = result.allocation_by_sleeve[s], y = result.selection_by_sleeve[s]; return `<tr><td><span class="swatch" style="background:${WCC.SERIES_COLORS[ids[s]]}"></span>${name}</td><td>${fmt.pct(weights[s])}</td><td>${fmt.pct(perf.bench_sleeve_weights[s], 0)}</td><td class="${cls(x)}">${fmt.signedPct(x)}</td><td class="${cls(y)}">${fmt.signedPct(y)}</td><td class="${cls(x + y)}">${fmt.signedPct(x + y)}</td></tr>`; }).join("") +
      `<tr class="total"><td>Total</td><td>100%</td><td>100%</td><td class="${cls(result.allocation_total)}">${fmt.signedPct(result.allocation_total)}</td><td class="${cls(result.selection_total)}">${fmt.signedPct(result.selection_total)}</td><td class="${cls(result.active_return)}">${fmt.signedPct(result.active_return)}</td></tr></tbody>`;
    WCC.chart("chart-brinson", { type: "bar", data: { labels: names, datasets: [
      { label: "Allocation effect", data: result.allocation_by_sleeve.map((v) => v * 100), backgroundColor: "#3987e5", borderRadius: 3, barPercentage: 0.7, categoryPercentage: 0.7 },
      { label: "Selection effect", data: result.selection_by_sleeve.map((v) => v * 100), backgroundColor: "#d95926", borderRadius: 3, barPercentage: 0.7, categoryPercentage: 0.7 } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => v + "%" }, title: { display: true, text: "Contribution to active return" } } },
        plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y.toFixed(1) + "%" } } } } });
    const b2 = perf.sleeve_benchmarks;
    get("perf-bench-note").textContent = "Selection is measured against: " + b2.india_equity + " for Indian equity, " + b2.global_equity + " for global equity and " + b2.global_bonds + " for global bonds. Gold and Indian debt are single instruments that are their own benchmark, so their selection effect is zero by construction. Interaction is included in selection.";
  }

  WCC.register({ id: "performance", label: "Performance", order: 4, init, render });
})();
