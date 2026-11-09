/* Module 5: tolerance-band rebalancing against pure buy and hold, on real daily returns. */
(function () {
  "use strict";
  const { fmt, math } = WCC;
  let panel;
  const settings = { band: 0.05, cost: 0.001, relative: false };

  /* band of null is buy and hold. Assets are the instruments followed by cash. */
  function backtest(target, band, cost, relative) {
    const { returns, risk_free: rf } = WCC.data.series;
    const count = target.length;
    let weights = target.slice(), value = 1, rebalances = 0, traded = 0, costs = 0, driftTotal = 0;
    const path = [], weightPath = [], events = [];
    returns.forEach((row, day) => {
      let gross = 0;
      const grown = weights.map((w, i) => { const g = w * (1 + (i < count - 1 ? row[i] : rf[day])); gross += g; return g; });
      value *= gross;
      weights = grown.map((g) => g / gross);
      if (band !== null) {
        const breach = weights.some((w, i) => (relative ? target[i] > 0 && Math.abs(w - target[i]) > band * target[i] : Math.abs(w - target[i]) > band));
        if (breach) {
          const turnover = math.sum(weights.map((w, i) => Math.abs(target[i] - w)));
          const fee = turnover * cost;
          value *= 1 - fee;
          traded += turnover; costs += fee; rebalances++;
          weights = target.slice();
          events.push(day);
        }
      }
      driftTotal += math.sum(weights.map((w, i) => Math.abs(w - target[i]))) / 2;
      path.push(value);
      weightPath.push(weights);
    });
    return { final_value: value, rebalances, turnover: traded, cost_drag: costs, average_drift: driftTotal / returns.length, path, weightPath, events };
  }

  function pathStats(path) {
    const dailyReturns = path.map((v, i) => v / (i ? path[i - 1] : 1) - 1);
    const years = path.length / 252;
    return { cagr: Math.pow(path[path.length - 1], 1 / years) - 1, vol: math.stdev(dailyReturns) * Math.sqrt(252), mdd: WCC.risk.drawdown(dailyReturns).worst };
  }
  WCC.rebalancing = { backtest, pathStats };

  function init(root) {
    panel = root;
    root.innerHTML = `
      <div class="panel-grid">
        <div>
          <div class="card">
            <h2 class="card-title">Rebalancing Rule</h2>
            <div class="control-group">
              <div class="control-label"><span>Tolerance band</span><span class="value" id="reb-band-val"></span></div>
              <input type="range" id="reb-band" min="1" max="15" step="0.5" value="5" aria-label="Tolerance band" />
              <div class="range-scale"><span>1%</span><span>15%</span></div>
            </div>
            <div class="control-group">
              <div class="control-label"><span>Band measured as</span></div>
              <div class="seg" id="reb-mode"><button type="button" data-v="abs">Points of portfolio</button><button type="button" data-v="rel">% of target</button></div>
            </div>
            <div class="control-group">
              <div class="control-label"><span>Trading cost</span><span class="value" id="reb-cost-val"></span></div>
              <input type="range" id="reb-cost" min="0" max="50" step="1" value="10" aria-label="One-way trading cost in basis points" />
              <div class="range-scale"><span>0 bps</span><span>50 bps</span></div>
            </div>
          </div>
          <div class="card"><h2 class="card-title">The Rule</h2><p class="card-desc" id="reb-rule"></p></div>
        </div>
        <div>
          <div class="stat-row" id="reb-stats"></div>
          <div class="card"><h2 class="card-title">Value of ₹100</h2><p class="card-desc" id="reb-desc"></p><div class="chart-box"><canvas id="chart-reb-value" role="img" aria-label="Portfolio value with banded rebalancing and with buy and hold"></canvas></div></div>
          <div class="card"><h2 class="card-title">Drift From Target Under Buy &amp; Hold</h2><p class="card-desc">Each asset class's weight minus its target, in percentage points, if the portfolio were left alone.</p><div class="chart-box"><canvas id="chart-reb-drift" role="img" aria-label="Sleeve weight drift from target over time"></canvas></div></div>
          <div class="card"><h2 class="card-title">Comparison</h2><div class="table-wrap"><table class="data" id="reb-table"></table></div></div>
        </div>
      </div>`;
    root.querySelector("#reb-band").addEventListener("input", (e) => { settings.band = Number(e.target.value) / 100; render(); });
    root.querySelector("#reb-cost").addEventListener("input", (e) => { settings.cost = Number(e.target.value) / 10000; render(); });
    root.querySelector("#reb-mode").addEventListener("click", (e) => { if (e.target.dataset.v) { settings.relative = e.target.dataset.v === "rel"; render(); } });
  }

  function render() {
    const get = (id) => panel.querySelector("#" + id);
    const client = WCC.client();
    const target = client.weights.concat(client.cash);
    const hold = backtest(target, null, settings.cost, settings.relative);
    const banded = backtest(target, settings.band, settings.cost, settings.relative);
    const a = pathStats(hold.path), b = pathStats(banded.path);
    const { dates } = WCC.data.series;
    panel.querySelectorAll("#reb-mode button").forEach((x) => x.classList.toggle("active", (x.dataset.v === "rel") === settings.relative));
    get("reb-band-val").textContent = (settings.band * 100).toFixed(1) + (settings.relative ? "% of target" : " pts");
    get("reb-cost-val").textContent = (settings.cost * 10000).toFixed(0) + " bps";
    get("reb-rule").innerHTML = settings.relative
      ? `When any holding moves more than <strong>${fmt.pct(settings.band)}</strong> away from its own target, as a share of that target, the whole portfolio returns to target. Tighter for small positions.`
      : `When any holding moves more than <strong>${(settings.band * 100).toFixed(1)} percentage points</strong> from its target weight, the whole portfolio returns to target. Costs of ${(settings.cost * 10000).toFixed(0)} bps apply to every rupee bought or sold.`;
    const gain = banded.final_value - hold.final_value;
    const tile = (label, value, sub) => `<div class="stat-box"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
    get("reb-stats").innerHTML = tile("Rebalancing Effect", (gain >= 0 ? "+₹" : "−₹") + Math.abs(gain * 100).toFixed(1), "per ₹100, net of costs") + tile("Annual Effect", fmt.signedPct(b.cagr - a.cagr, 2), "return difference") +
      tile("Rebalances", String(banded.rebalances), "over " + WCC.data.universe.window.years.toFixed(1) + " years") + tile("Volatility Change", fmt.signedPct(b.vol - a.vol, 2), "banded less buy & hold");
    get("reb-desc").textContent = (gain >= 0 ? "Disciplined rebalancing earned " : "Disciplined rebalancing cost ") + "₹" + Math.abs(gain * 100).toFixed(1) + " per ₹100 over the period, after ₹" + (banded.cost_drag * 100).toFixed(2) + " of cumulative trading cost.";
    const metric = (name, x, y) => `<tr><td>${name}</td><td>${x}</td><td>${y}</td></tr>`;
    get("reb-table").innerHTML = "<thead><tr><th>Measure</th><th>Buy &amp; hold</th><th>Banded</th></tr></thead><tbody>" +
      metric("Final value of ₹100", "₹" + (hold.final_value * 100).toFixed(1), "₹" + (banded.final_value * 100).toFixed(1)) + metric("Annual return", fmt.pct(a.cagr, 2), fmt.pct(b.cagr, 2)) + metric("Annual volatility", fmt.pct(a.vol, 2), fmt.pct(b.vol, 2)) +
      metric("Maximum drawdown", fmt.pct(a.mdd), fmt.pct(b.mdd)) + metric("Average drift from target", fmt.pct(hold.average_drift), fmt.pct(banded.average_drift)) + metric("Rebalances", "0", banded.rebalances) +
      metric("Total turnover", "0%", fmt.pct(banded.turnover, 0)) + metric("Trading cost", "0.00%", fmt.pct(banded.cost_drag, 2)) + "</tbody>";

    const labels = [], x1 = [], x2 = [];
    dates.forEach((d, i) => { if (i % 5 === 0 || i === dates.length - 1) { labels.push(d); x1.push(banded.path[i] * 100); x2.push(hold.path[i] * 100); } });
    const timeScale = { grid: { display: false }, ticks: { maxTicksLimit: 8, callback(v) { return this.getLabelForValue(v).slice(0, 7); } } };
    WCC.chart("chart-reb-value", { type: "line", data: { labels, datasets: [
      { label: "Banded rebalancing", data: x1, borderColor: "#3987e5", borderWidth: 2, pointRadius: 0 }, { label: "Buy & hold", data: x2, borderColor: "#d95926", borderWidth: 2, pointRadius: 0 } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: timeScale, y: { ticks: { callback: (v) => "₹" + v } } }, plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": ₹" + ctx.parsed.y.toFixed(1) } } } } });

    const ids = WCC.sleeveIds(), names = WCC.sleeveNames(), { instruments } = WCC.data.universe;
    const members = ids.map((id) => (id === "cash" ? [target.length - 1] : instruments.map((inst, i) => (inst.sleeve === id ? i : -1)).filter((i) => i >= 0)));
    const totalTarget = members.map((list) => math.sum(list.map((i) => target[i])));
    const datasets = ids.map((id, s) => ({ label: names[s], borderColor: WCC.SERIES_COLORS[id], borderWidth: 2, pointRadius: 0,
      data: dates.reduce((out, _, day) => { if (day % 5 === 0 || day === dates.length - 1) out.push((math.sum(members[s].map((i) => hold.weightPath[day][i])) - totalTarget[s]) * 100); return out; }, []) })).filter((_, s) => totalTarget[s] > 0.0005);
    WCC.chart("chart-reb-drift", { type: "line", data: { labels, datasets },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: timeScale, y: { ticks: { callback: (v) => (v > 0 ? "+" : "") + v + " pts" } } }, plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + (ctx.parsed.y >= 0 ? "+" : "") + ctx.parsed.y.toFixed(1) + " pts" } } } } });
  }

  WCC.register({ id: "rebalancing", label: "Rebalancing", order: 5, init, render });
})();
