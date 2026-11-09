/* Module 2: strategic asset allocation. Plots the precomputed frontier; solves nothing in the browser. */
(function () {
  "use strict";
  const { fmt, INK } = WCC;
  let panel;

  function init(root) {
    panel = root;
    root.innerHTML = `
      <div class="panel-grid">
        <div>
          <div class="card">
            <h2 class="card-title">Risk Aversion</h2>
            <p class="card-desc" id="alloc-source"></p>
            <div class="control-group">
              <div class="control-label"><span>Coefficient A</span><span class="value" id="alloc-a-val"></span></div>
              <input type="range" id="alloc-a" min="1" max="20" step="0.1" aria-label="Risk aversion coefficient" />
              <div class="range-scale"><span>1 bold</span><span>20 cautious</span></div>
            </div>
            <div class="stat-row" style="grid-template-columns:1fr 1fr">
              <div class="stat-box"><div class="stat-label">y*</div><div class="stat-value" id="alloc-ystar"></div><div class="stat-sub">formula value</div></div>
              <div class="stat-box"><div class="stat-label">1 − y</div><div class="stat-value" id="alloc-cash"></div><div class="stat-sub">in risk-free</div></div>
            </div>
          </div>
          <div class="card">
            <h2 class="card-title">How This Portfolio Was Chosen</h2>
            <p class="card-desc" id="alloc-explain"></p>
          </div>
          <div class="card">
            <h2 class="card-title">Asset Mix</h2>
            <div class="alloc-bar" id="alloc-bar"></div>
            <div class="alloc-legend" id="alloc-legend"></div>
          </div>
        </div>
        <div>
          <div class="stat-row">
            <div class="stat-box"><div class="stat-label">Minimum Variance</div><div class="stat-value" id="alloc-mvp"></div><div class="stat-sub" id="alloc-mvp-sub"></div></div>
            <div class="stat-box"><div class="stat-label">Tangency (Optimal Risky)</div><div class="stat-value" id="alloc-orp"></div><div class="stat-sub" id="alloc-orp-sub"></div></div>
            <div class="stat-box"><div class="stat-label">Your Complete Portfolio</div><div class="stat-value" id="alloc-you"></div><div class="stat-sub" id="alloc-you-sub"></div></div>
            <div class="stat-box"><div class="stat-label">Utility U</div><div class="stat-value" id="alloc-u"></div><div class="stat-sub">E(r) − ½Aσ²</div></div>
          </div>
          <div class="card">
            <h2 class="card-title">Efficient Frontier &amp; Capital Allocation Line</h2>
            <p class="card-desc">Annual expected return against volatility, in rupees, across all sixteen instruments. Long only, with position limits.</p>
            <div class="chart-box tall"><canvas id="chart-frontier" role="img" aria-label="Efficient frontier with capital allocation line"></canvas></div>
          </div>
          <div class="card">
            <h2 class="card-title">Holdings</h2>
            <div class="table-wrap"><table class="data" id="alloc-table"></table></div>
          </div>
          <div class="card">
            <h2 class="card-title">Universe &amp; Substitutions</h2>
            <p class="card-desc" id="alloc-universe"></p>
            <div class="table-wrap"><table class="data" id="alloc-subs"></table></div>
          </div>
        </div>
      </div>`;
    root.querySelector("#alloc-a").addEventListener("input", (event) => WCC.setA(event.target.value, "slider"));
    const { universe, market } = WCC.data;
    root.querySelector("#alloc-universe").textContent = universe.instruments.length + " instruments, " + universe.window.sessions.toLocaleString("en-IN") +
      " sessions from " + fmt.date(universe.window.start) + ". Expected returns use Bayes-Stein shrinkage of " + fmt.pct(market.shrinkage_intensity, 0) + " toward the minimum-variance mean, because raw historical means are too noisy to optimise on.";
    root.querySelector("#alloc-subs").innerHTML = "<thead><tr><th>Role</th><th>Requested</th><th>Used</th></tr></thead><tbody>" +
      universe.substitutions.map((s) => `<tr title="${s.reason}"><td>${s.role}</td><td>${s.requested}</td><td>${s.replaced_by}</td></tr>`).join("") + "</tbody></table>" +
      '<caption style="caption-side:bottom;text-align:left;font-size:11.5px;color:var(--text-muted);padding-top:8px;line-height:1.5">' + universe.substitutions.map((s) => s.requested + ": " + s.reason).join(" ") + "</caption>";
  }

  function frontierDatasets(client) {
    const frontier = WCC.data.frontier;
    const toPoint = (p) => ({ x: p.volatility * 100, y: p.expected_return * 100 });
    const rf = frontier.risk_free_rate * 100;
    const maxVol = Math.max(frontier.efficient[frontier.efficient.length - 1].volatility * 100, ...WCC.data.universe.instruments.map((i) => i.volatility * 100)) * 1.02;
    const slope = frontier.cal_slope;
    const calEnd = Math.min(maxVol, (25 - rf) / slope);
    const assets = WCC.data.universe.instruments.map((inst) => ({ x: inst.volatility * 100, y: inst.expected_return * 100, name: inst.name }));
    const lower = frontier.inefficient.map(toPoint).reverse();
    const indifference = [];
    for (let vol = 0; vol <= Math.min(maxVol, 26); vol += 0.5) {
      const y = client.utility * 100 + 0.5 * client.A * Math.pow(vol / 100, 2) * 100;
      if (y <= 25) indifference.push({ x: vol, y });
    }
    const you = { x: client.volatility * 100, y: client.expected * 100 };
    const levered = !client.onCal ? [{ x: client.yStar * frontier.orp.volatility * 100, y: rf + client.yStar * (frontier.orp.expected_return * 100 - rf) }].filter((p) => p.x <= maxVol && p.y <= 25) : [];
    const point = { type: "scatter", showLine: false, borderWidth: 2, borderColor: "#0f131c" };
    return [
      { ...point, label: "Your portfolio", data: [you], backgroundColor: "#00f0ff", pointRadius: 9, pointHoverRadius: 11, pointStyle: "circle", directLabel: "You", directLabelAlign: "right", directLabelDx: -12, directLabelDy: -12, order: 0 },
      { ...point, label: "Tangency", data: [toPoint(frontier.orp)], backgroundColor: "#9085e9", pointRadius: 8, pointHoverRadius: 10, pointStyle: "rectRot", directLabel: "Tangency", directLabelDy: 15, directLabelDx: -8, order: 1 },
      { ...point, label: "Minimum variance", data: [toPoint(frontier.mvp)], backgroundColor: "#199e70", pointRadius: 8, pointHoverRadius: 10, pointStyle: "triangle", directLabel: "MVP", directLabelAlign: "right", directLabelDx: -10, directLabelDy: 0, order: 1 },
      { ...point, label: "Risk-free", data: [{ x: 0, y: rf }], backgroundColor: INK.secondary, pointRadius: 7, pointHoverRadius: 9, pointStyle: "rect", directLabel: "Risk-free", directLabelDy: 14, directLabelDx: 2, order: 1 },
      { ...point, label: "Levered y* (not held)", data: levered, backgroundColor: "transparent", borderColor: "#00f0ff", pointRadius: 7, pointHoverRadius: 9, order: 1 },
      { ...point, label: "Instruments", data: assets, backgroundColor: "#7f8ea3", borderColor: "#0f131c", borderWidth: 1, pointRadius: 4.5, pointHoverRadius: 7, order: 3 },
      { type: "line", label: "Efficient frontier", data: frontier.efficient.map(toPoint), borderColor: "#3987e5", borderWidth: 2.5, pointRadius: 0, pointHitRadius: 6, order: 2 },
      { type: "line", label: "Below the minimum-variance point", data: lower, borderColor: "#3987e5", borderDash: [2, 4], borderWidth: 1.25, pointRadius: 0, order: 4 },
      { type: "line", label: "Capital allocation line", data: [{ x: 0, y: rf }, { x: calEnd, y: rf + slope * calEnd }], borderColor: "#d95926", borderWidth: 2, borderDash: [7, 5], pointRadius: 0, order: 2 },
      { type: "line", label: "Your indifference curve", data: indifference, borderColor: "#c98500", borderWidth: 1.25, pointRadius: 0, order: 4 },
    ];
  }

  function drawFrontier(client) {
    WCC.chart("chart-frontier", {
      type: "scatter",
      data: { datasets: frontierDatasets(client) },
      options: {
        layout: { padding: { right: 14, top: 6 } },
        scales: {
          x: { type: "linear", min: 0, title: { display: true, text: "Volatility (annual %)" }, ticks: { callback: (v) => v + "%" } },
          y: { type: "linear", min: 5, max: 25, title: { display: true, text: "Expected return (annual %)" }, ticks: { callback: (v) => v + "%" } },
        },
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          tooltip: { filter: (item) => item.dataset.label !== "Below the minimum-variance point",
            callbacks: { label: (ctx) => (ctx.raw.name || ctx.dataset.label) + ": return " + ctx.parsed.y.toFixed(2) + "%, volatility " + ctx.parsed.x.toFixed(2) + "%" } },
          legend: { labels: { filter: (item, data) => (data.datasets[item.datasetIndex].data || []).length > 0 } },
        },
      },
    });
  }

  function render() {
    const get = (id) => panel.querySelector("#" + id);
    const client = WCC.client();
    const { frontier, universe } = WCC.data;
    get("alloc-a").value = client.A;
    get("alloc-a-val").textContent = fmt.num(client.A, 1);
    get("alloc-source").textContent = WCC.state.source === "questionnaire" ? "Set by the client questionnaire. Move the slider to override it."
      : WCC.state.source === "slider" ? "Manual override of the questionnaire." : "An illustrative value. Complete the Client Profile or move the slider.";
    get("alloc-ystar").textContent = fmt.pct(client.yStar, 0);
    get("alloc-cash").textContent = fmt.pct(client.cash, 1);
    const pair = (p) => fmt.pct(p.expected_return) + " / " + fmt.pct(p.volatility);
    get("alloc-mvp").textContent = fmt.pct(frontier.mvp.volatility); get("alloc-mvp-sub").textContent = "vol; return " + fmt.pct(frontier.mvp.expected_return);
    get("alloc-orp").textContent = fmt.num(frontier.orp.sharpe, 2); get("alloc-orp-sub").textContent = "Sharpe; " + pair(frontier.orp);
    get("alloc-you").textContent = fmt.pct(client.expected); get("alloc-you-sub").textContent = "return; vol " + fmt.pct(client.volatility);
    get("alloc-u").textContent = fmt.pct(client.utility, 2);
    get("alloc-explain").innerHTML = client.onCal
      ? `The <strong>separation theorem</strong> at work: every investor holds the same tangency portfolio and differs only in how much. y* = (E[r] − r<sub>f</sub>) ÷ (Aσ²) = <strong>${fmt.pct(client.yStar, 1)}</strong>, so ${fmt.pct(client.y, 1)} goes to the tangency portfolio and ${fmt.pct(client.cash, 1)} stays in the risk-free asset.`
      : `y* = (E[r] − r<sub>f</sub>) ÷ (Aσ²) = <strong>${fmt.pct(client.yStar, 0)}</strong>, which would need borrowing. This plan does not borrow, so the capital allocation line stops at the tangency point. Above it, the best choice is the point on the frontier with the highest utility, shown as “You”, fully invested with no cash.`;
    WCC.renderAllocation(get("alloc-bar"), get("alloc-legend"), client);
    const orderIdx = client.weights.map((w, i) => i).sort((a, b) => client.weights[b] - client.weights[a]);
    const rows = orderIdx.filter((i) => client.weights[i] > 0.00005).map((i) => {
      const inst = universe.instruments[i];
      return `<tr><td><span class="swatch" style="background:${WCC.SERIES_COLORS[inst.sleeve]}"></span>${inst.name}</td><td>${inst.ticker}</td><td>${fmt.pct(client.weights[i])}</td><td>${fmt.pct(inst.cap, 0)}</td><td>${fmt.pct(inst.expected_return)}</td><td>${fmt.pct(inst.volatility)}</td></tr>`;
    });
    if (client.cash > 0.00005) rows.push(`<tr><td><span class="swatch" style="background:${WCC.SERIES_COLORS.cash}"></span>Risk-free (liquid fund)</td><td>${universe.support.find((s) => s.key === "RF").ticker}</td><td>${fmt.pct(client.cash)}</td><td>—</td><td>${fmt.pct(frontier.risk_free_rate)}</td><td>0.0%</td></tr>`);
    const total = WCC.math.sum(client.weights) + client.cash;
    get("alloc-table").innerHTML = `<thead><tr><th>Instrument</th><th>Ticker</th><th>Weight</th><th>Limit</th><th>Exp. return</th><th>Volatility</th></tr></thead><tbody>${rows.join("")}<tr class="total"><td>Total</td><td></td><td>${fmt.pct(total)}</td><td></td><td>${fmt.pct(client.expected)}</td><td>${fmt.pct(client.volatility)}</td></tr></tbody>`;
    drawFrontier(client);
  }

  WCC.register({ id: "allocation", label: "Allocation", order: 2, init, render });
})();
