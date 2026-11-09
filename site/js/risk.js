/* Module 3: the FRM lens over the current portfolio. Everything is recomputed from the committed daily returns. */
(function () {
  "use strict";
  const { fmt, math, INK } = WCC;
  let panel;
  const settings = { confidence: 0.95, horizon: 1, value: 10000000 };

  /* Peak-to-trough drawdown on a wealth index that starts at 1 before the first return. */
  function drawdown(returns) {
    let wealth = 1, peak = 1, worst = 0, troughIndex = -1, peakIndex = -1, currentPeakIndex = -1;
    const underwater = returns.map((r, i) => {
      wealth *= 1 + r;
      if (wealth > peak) { peak = wealth; currentPeakIndex = i; }
      const dd = wealth / peak - 1;
      if (dd < worst) { worst = dd; troughIndex = i; peakIndex = currentPeakIndex; }
      return dd;
    });
    return { worst, troughIndex, peakIndex, underwater };
  }

  /* Portfolio path through a scenario. Actual-instrument sleeves are rebuilt for this client's mix. */
  function scenarioPath(scenario, client) {
    const ids = WCC.sleeveIds(), weights = WCC.sleeveWeights(client), { dates, returns, risk_free: rf } = WCC.data.series;
    const { instruments } = WCC.data.universe;
    const index = new Map(dates.map((d, i) => [d, i]));
    const live = (sleeve) => scenario.sources[sleeve] === "Actual instruments held";
    const paths = {};
    ids.forEach((sleeve, s) => {
      if (!live(sleeve) || weights[s] <= 0) { paths[sleeve] = scenario.paths[sleeve]; return; }
      const members = instruments.map((inst, i) => (inst.sleeve === sleeve ? i : -1)).filter((i) => i >= 0);
      const total = sleeve === "cash" ? 1 : math.sum(members.map((i) => client.weights[i]));
      let level = 1;
      paths[sleeve] = scenario.dates.map((date, position) => {
        if (position === 0) return 0;
        const day = index.get(date);
        if (day !== undefined) {
          const change = sleeve === "cash" ? rf[day] : math.sum(members.map((i) => (client.weights[i] / total) * returns[day][i]));
          level *= 1 + change;
        }
        return level - 1;
      });
    });
    const portfolio = scenario.dates.map((_, position) => math.sum(ids.map((sleeve, s) => weights[s] * paths[sleeve][position])));
    const shocks = ids.map((sleeve) => paths[sleeve][paths[sleeve].length - 1]);
    return { portfolio, shocks, total: portfolio[portfolio.length - 1], weights };
  }
  WCC.risk = { drawdown, scenarioPath };

  function init(root) {
    panel = root;
    root.innerHTML = `
      <div class="panel-grid">
        <div>
          <div class="card">
            <h2 class="card-title">Parameters</h2>
            <div class="control-group">
              <div class="control-label"><span>Confidence</span></div>
              <div class="seg" id="risk-conf"><button type="button" data-v="0.95">95%</button><button type="button" data-v="0.99">99%</button></div>
            </div>
            <div class="control-group">
              <div class="control-label"><span>Horizon</span><span class="value" id="risk-horizon-val"></span></div>
              <input type="range" id="risk-horizon" min="1" max="20" step="1" value="1" aria-label="Horizon in trading days" />
              <div class="range-scale"><span>1 day</span><span>20 days</span></div>
            </div>
            <div class="control-group">
              <div class="control-label"><span>Portfolio value (₹)</span></div>
              <input type="number" id="risk-value" min="100000" step="100000" value="10000000" aria-label="Portfolio value in rupees" />
            </div>
          </div>
          <div class="card">
            <h2 class="card-title">Reading These Numbers</h2>
            <p class="card-desc"><strong>VaR</strong> is the loss exceeded only on the worst days at the chosen confidence. <strong>CVaR</strong> is the average loss on those days. CVaR is a coherent measure: it satisfies subadditivity, so combining positions can never raise it above their sum, a guarantee VaR does not give.</p>
            <p class="card-desc">Multi-day figures use the square-root-of-time rule on one-day estimates, which assumes independent returns.</p>
          </div>
        </div>
        <div>
          <div class="stat-row">
            <div class="stat-box"><div class="stat-label">Parametric VaR</div><div class="stat-value" id="risk-pv"></div><div class="stat-sub" id="risk-pv-p"></div></div>
            <div class="stat-box"><div class="stat-label">Historical VaR</div><div class="stat-value" id="risk-hv"></div><div class="stat-sub" id="risk-hv-p"></div></div>
            <div class="stat-box"><div class="stat-label">Parametric CVaR</div><div class="stat-value" id="risk-pc"></div><div class="stat-sub" id="risk-pc-p"></div></div>
            <div class="stat-box"><div class="stat-label">Historical CVaR</div><div class="stat-value" id="risk-hc"></div><div class="stat-sub" id="risk-hc-p"></div></div>
            <div class="stat-box"><div class="stat-label">Maximum Drawdown</div><div class="stat-value" id="risk-mdd"></div><div class="stat-sub" id="risk-mdd-p"></div></div>
          </div>
          <div class="two-col">
            <div class="card"><h2 class="card-title">Daily Return Distribution</h2><p class="card-desc" id="risk-hist-desc"></p><div class="chart-box"><canvas id="chart-hist" role="img" aria-label="Histogram of daily portfolio returns with VaR and CVaR markers"></canvas></div></div>
            <div class="card"><h2 class="card-title">Underwater Curve</h2><p class="card-desc">Decline from the previous high, against the Nifty 50.</p><div class="chart-box"><canvas id="chart-dd" role="img" aria-label="Drawdown of the portfolio and the Nifty 50 over time"></canvas></div></div>
          </div>
          <div class="card">
            <h2 class="card-title">Historical Stress Scenarios</h2>
            <p class="card-desc">Each crisis replayed on today's allocation, from the Nifty 50's peak to its trough.</p>
            <div class="two-col">
              <div><div class="chart-box short"><canvas id="chart-stress" role="img" aria-label="Portfolio path through each stress scenario"></canvas></div></div>
              <div class="table-wrap"><table class="data" id="risk-stress-table"></table></div>
            </div>
            <div id="risk-stress-notes" style="margin-top:12px"></div>
          </div>
          <div class="card">
            <h2 class="card-title">Correlation Across the Universe</h2>
            <p class="card-desc">Weekly log returns in rupees. Weekly data limits the understatement that comes from Indian and US markets closing at different times.</p>
            <div class="table-wrap"><div class="heatmap" id="risk-heatmap"></div></div>
            <div class="heat-legend"><span>−1</span><i></i><span>+1</span></div>
          </div>
        </div>
      </div>`;
    root.querySelector("#risk-conf").addEventListener("click", (event) => {
      if (event.target.dataset.v) { settings.confidence = Number(event.target.dataset.v); render(); }
    });
    root.querySelector("#risk-horizon").addEventListener("input", (event) => { settings.horizon = Number(event.target.value); render(); });
    root.querySelector("#risk-value").addEventListener("input", (event) => { const v = Number(event.target.value); if (v > 0) { settings.value = v; render(); } });
    drawHeatmap();
  }

  /* Diverging blue to red through a neutral gray at zero. */
  function correlationColor(value) {
    const low = [24, 79, 149], mid = [56, 56, 53], high = [166, 45, 45];
    const target = value < 0 ? low : high, t = Math.min(1, Math.abs(value));
    return "rgb(" + mid.map((m, i) => Math.round(m + (target[i] - m) * t)).join(",") + ")";
  }

  function drawHeatmap() {
    const { market, universe } = WCC.data;
    const keys = universe.instruments.map((i) => i.key);
    const grid = panel.querySelector("#risk-heatmap");
    grid.style.gridTemplateColumns = "84px repeat(" + keys.length + ", minmax(30px, 1fr))";
    let html = "<div></div>" + keys.map((k) => '<div class="hm-label hm-col">' + k + "</div>").join("");
    market.correlation_weekly.forEach((row, i) => {
      html += '<div class="hm-label">' + keys[i] + "</div>" + row.map((value, j) =>
        `<div class="hm-cell" style="background:${correlationColor(value)};color:#f2f5fa" title="${universe.instruments[i].name} and ${universe.instruments[j].name}: ${value.toFixed(2)}">${value.toFixed(2).replace("0.", ".")}</div>`).join("");
    });
    grid.innerHTML = html;
  }

  function drawHistogram(series, measure, horizonFactor) {
    const low = Math.min(...series), high = Math.max(...series);
    const focusLow = Math.max(low, measure.mean - 5 * measure.stdev), focusHigh = Math.min(high, measure.mean + 5 * measure.stdev);
    const bins = 44, width = (focusHigh - focusLow) / bins;
    const counts = new Array(bins).fill(0);
    series.forEach((r) => { counts[Math.min(bins - 1, Math.max(0, Math.floor((r - focusLow) / width)))]++; });
    const labels = counts.map((_, i) => ((focusLow + (i + 0.5) * width) * 100).toFixed(2));
    const toIndex = (value) => (value - focusLow) / width - 0.5;
    const lines = [
      { value: -measure.var_historical, label: "VaR", color: "#d95926" },
      { value: -measure.cvar_historical, label: "CVaR", color: "#d55181" },
    ];
    WCC.chart("chart-hist", {
      type: "bar",
      data: { labels, datasets: [{ label: "Trading days", data: counts, backgroundColor: counts.map((_, i) => (focusLow + (i + 0.5) * width <= -measure.var_historical ? "#d95926" : "#3987e5")), borderRadius: { topLeft: 2, topRight: 2 }, barPercentage: 1, categoryPercentage: 0.9 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => "Return near " + items[0].label + "%", label: (ctx) => ctx.parsed.y + " days" } } },
        scales: { x: { grid: { display: false }, title: { display: true, text: "One-day return (%)" }, ticks: { maxTicksLimit: 9, autoSkip: true } }, y: { title: { display: true, text: "Days" } } },
      },
      plugins: [{
        id: "markers",
        afterDatasetsDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          lines.forEach((line, n) => {
            const x = scales.x.getPixelForValue(toIndex(line.value));
            ctx.save();
            ctx.strokeStyle = line.color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = INK.primary; ctx.font = "600 11px " + Chart.defaults.font.family; ctx.textAlign = n === 0 ? "left" : "right";
            ctx.fillText(line.label + " " + (line.value * 100).toFixed(2) + "%", n === 0 ? x + 5 : x - 5, chartArea.top + 12);
            ctx.restore();
          });
        },
      }],
    });
  }


  function drawDrawdown(portfolio, benchmark) {
    const dates = WCC.data.series.dates;
    const labels = [], p = [], b = [];
    for (let i = 0; i < dates.length; i += 5) { labels.push(dates[i]); p.push(portfolio.underwater[i] * 100); b.push(benchmark.underwater[i] * 100); }
    WCC.chart("chart-dd", {
      type: "line",
      data: { labels, datasets: [
        { label: "Portfolio", data: p, borderColor: "#3987e5", borderWidth: 2, pointRadius: 0 },
        { label: "Nifty 50", data: b, borderColor: "#d95926", borderWidth: 2, pointRadius: 0 },
      ] },
      options: { interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback(v) { return this.getLabelForValue(v).slice(0, 7); } } }, y: { max: 0, ticks: { callback: (v) => v + "%" } } },
        plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y.toFixed(1) + "%" } } } },
    });
  }

  function drawStress(results) {
    const { stress } = WCC.data.risk;
    const longest = Math.max(...stress.map((s) => s.dates.length));
    const colors = ["#3987e5", "#d95926"];
    WCC.chart("chart-stress", {
      type: "line",
      data: { labels: Array.from({ length: longest }, (_, i) => i), datasets: stress.map((scenario, i) => ({
        label: scenario.name, data: results[i].portfolio.map((v) => v * 100), borderColor: colors[i], borderWidth: 2, pointRadius: 0,
      })) },
      options: { interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, title: { display: true, text: "Trading days from peak" }, ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: (v) => v + "%" } } },
        plugins: { tooltip: { callbacks: { title: (items) => "Day " + items[0].label, label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y.toFixed(1) + "%" } } } },
    });
  }

  function render() {
    const get = (id) => panel.querySelector("#" + id);
    const client = WCC.client();
    const series = WCC.dailySeries(client);
    const measure = WCC.valueAtRisk(series, settings.confidence);
    const scale = Math.sqrt(settings.horizon);
    const set = (id, loss) => { get(id).textContent = fmt.inrCompact(loss * scale * settings.value); get(id + "-p").textContent = fmt.pct(loss * scale, 2) + " of value"; };
    panel.querySelectorAll("#risk-conf button").forEach((b) => b.classList.toggle("active", Number(b.dataset.v) === settings.confidence));
    get("risk-horizon-val").textContent = settings.horizon + (settings.horizon === 1 ? " day" : " days");
    set("risk-pv", measure.var_parametric); set("risk-hv", measure.var_historical);
    set("risk-pc", measure.cvar_parametric); set("risk-hc", measure.cvar_historical);
    const portfolioDd = drawdown(series), benchDd = drawdown(WCC.data.series.benchmark);
    get("risk-mdd").textContent = fmt.pct(portfolioDd.worst);
    const { dates } = WCC.data.series;
    get("risk-mdd-p").textContent = dates[portfolioDd.peakIndex].slice(0, 7) + " to " + dates[portfolioDd.troughIndex].slice(0, 7);
    get("risk-hist-desc").textContent = series.length.toLocaleString("en-IN") + " sessions. One-day VaR and CVaR at " + fmt.pct(settings.confidence, 0) + " confidence, against daily volatility of " + fmt.pct(measure.stdev, 2) + ".";
    drawHistogram(series, measure);
    drawDrawdown(portfolioDd, benchDd);

    const { stress } = WCC.data.risk;
    const results = stress.map((scenario) => scenarioPath(scenario, client));
    drawStress(results);
    const names = WCC.sleeveNames();
    const weights = WCC.sleeveWeights(client);
    const row = (name, w, values) => `<tr><td>${name}</td><td>${w}</td>${values.map((v) => `<td class="${v < 0 ? "neg" : v > 0 ? "pos" : ""}">${fmt.signedPct(v)}</td>`).join("")}</tr>`;
    get("risk-stress-table").innerHTML = "<thead><tr><th>Sleeve</th><th>Weight</th>" + stress.map((s) => "<th>" + s.id.replace("gfc_2008", "2008").replace("covid_2020", "2020") + "</th>").join("") + "</tr></thead><tbody>" +
      names.map((name, s) => row(name, fmt.pct(weights[s]), results.map((r) => r.shocks[s]))).join("") +
      `<tr class="total"><td>Portfolio</td><td>100%</td>${results.map((r) => `<td class="${r.total < 0 ? "neg" : "pos"}">${fmt.signedPct(r.total)}</td>`).join("")}</tr>` +
      `<tr><td>On value</td><td></td>${results.map((r) => `<td>${fmt.inrCompact(r.total * settings.value)}</td>`).join("")}</tr>` +
      `<tr><td>Nifty 50</td><td></td>${stress.map((s) => `<td class="neg">${fmt.signedPct(s.nifty_change)}</td>`).join("")}</tr></tbody>`;
    get("risk-stress-notes").innerHTML = stress.map((s) => `<p class="card-desc" style="margin-bottom:6px"><strong>${s.name}</strong> (${fmt.date(s.start)} to ${fmt.date(s.end)}). ${s.note}</p>`).join("");
  }

  WCC.register({ id: "risk", label: "Risk & Stress", order: 3, init, render });
})();
