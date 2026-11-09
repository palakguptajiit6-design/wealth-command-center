/* Module 6: goals-based Monte Carlo. Runs in the browser from the model's expected return and volatility. */
(function () {
  "use strict";
  const { fmt, math } = WCC;
  let panel, scheduled = null;
  const settings = { lump: 2500000, monthly: 50000, years: 15, target: 30000000, paths: 5000 };

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Lognormal monthly returns whose annual arithmetic mean and volatility match the inputs. */
  function simulate({ lump, monthly, years, target, paths }, expected, volatility, seed) {
    const random = seededRandom(seed === undefined ? 20240117 : seed);
    const months = Math.round(years * 12);
    const logVar = Math.log(1 + (volatility * volatility) / ((1 + expected) * (1 + expected)));
    const logMean = Math.log(1 + expected) - logVar / 2;
    const muMonth = logMean / 12, sigmaMonth = Math.sqrt(logVar / 12);
    const finals = new Float64Array(paths);
    const yearly = Array.from({ length: years + 1 }, () => new Float64Array(paths));
    let spare = null;
    const gaussian = () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0;
      while (u === 0) u = random();
      v = random();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    for (let p = 0; p < paths; p++) {
      let wealth = lump;
      yearly[0][p] = lump;
      for (let m = 1; m <= months; m++) {
        wealth = wealth * Math.exp(muMonth + sigmaMonth * gaussian()) + monthly;
        if (m % 12 === 0) yearly[m / 12][p] = wealth;
      }
      finals[p] = wealth;
    }
    const percentile = (values, q) => { const sorted = Float64Array.from(values).sort(); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
    const bands = {};
    [0.05, 0.25, 0.5, 0.75, 0.95].forEach((q) => { bands[q] = yearly.map((row) => percentile(row, q)); });
    let hits = 0;
    finals.forEach((v) => { if (v >= target) hits++; });
    const invested = lump + monthly * months;
    return { probability: hits / paths, bands, median: percentile(finals, 0.5), p5: percentile(finals, 0.05), p95: percentile(finals, 0.95), mean: math.mean(Array.from(finals)), invested, logMean, logVar };
  }
  WCC.goals = { simulate };

  const FIELDS = [
    ["lump", "Initial lump sum (₹)", 0, 100000000, 100000],
    ["monthly", "Monthly contribution (₹)", 0, 5000000, 1000],
    ["target", "Target corpus (₹)", 100000, 10000000000, 500000],
  ];

  function init(root) {
    panel = root;
    root.innerHTML = `
      <div class="panel-grid">
        <div>
          <div class="card">
            <h2 class="card-title">Your Goal</h2>
            ${FIELDS.map(([key, label, min, max, step]) => `<div class="control-group"><div class="control-label"><span>${label}</span><span class="value" id="goal-${key}-val"></span></div><input type="number" id="goal-${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" aria-label="${label}" /></div>`).join("")}
            <div class="control-group">
              <div class="control-label"><span>Time horizon</span><span class="value" id="goal-years-val"></span></div>
              <input type="range" id="goal-years" min="1" max="40" step="1" value="${settings.years}" aria-label="Time horizon in years" />
              <div class="range-scale"><span>1 yr</span><span>40 yrs</span></div>
            </div>
            <div class="control-group">
              <div class="control-label"><span>Simulated paths</span></div>
              <select id="goal-paths" aria-label="Number of simulated paths"><option value="1000">1,000</option><option value="5000" selected>5,000</option><option value="10000">10,000</option><option value="25000">25,000</option></select>
            </div>
          </div>
          <div class="card">
            <h2 class="card-title">Inputs From Your Portfolio</h2>
            <p class="card-desc" id="goal-inputs"></p>
          </div>
        </div>
        <div>
          <div class="stat-row">
            <div class="stat-box"><div class="stat-label">Probability of Reaching Goal</div><div class="stat-value" id="goal-prob"></div><div class="stat-sub" id="goal-prob-sub"></div></div>
            <div class="stat-box"><div class="stat-label">Median Outcome</div><div class="stat-value" id="goal-median"></div><div class="stat-sub" id="goal-median-sub"></div></div>
            <div class="stat-box"><div class="stat-label">Weak Markets (5th pct)</div><div class="stat-value" id="goal-p5"></div><div class="stat-sub">1 in 20 ends lower</div></div>
            <div class="stat-box"><div class="stat-label">Strong Markets (95th pct)</div><div class="stat-value" id="goal-p95"></div><div class="stat-sub">1 in 20 ends higher</div></div>
          </div>
          <div class="card">
            <h2 class="card-title">Range of Simulated Outcomes</h2>
            <p class="card-desc" id="goal-desc"></p>
            <div class="chart-box tall"><canvas id="chart-fan" role="img" aria-label="Fan chart of simulated portfolio values by year"></canvas></div>
          </div>
          <div class="card"><h2 class="card-title">Year by Year</h2><div class="table-wrap"><table class="data" id="goal-table"></table></div></div>
        </div>
      </div>`;
    FIELDS.forEach(([key]) => root.querySelector("#goal-" + key).addEventListener("input", (e) => { const v = Number(e.target.value); if (e.target.value !== "" && v >= 0) { settings[key] = v; schedule(); } }));
    root.querySelector("#goal-years").addEventListener("input", (e) => { settings.years = Number(e.target.value); schedule(); });
    root.querySelector("#goal-paths").addEventListener("change", (e) => { settings.paths = Number(e.target.value); schedule(); });
  }

  function schedule() {
    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => { scheduled = null; render(); });
  }

  function render() {
    const get = (id) => panel.querySelector("#" + id);
    const client = WCC.client();
    const result = simulate(settings, client.expected, client.volatility);
    FIELDS.forEach(([key]) => { get("goal-" + key + "-val").textContent = fmt.inrCompact(settings[key]); });
    get("goal-years-val").textContent = settings.years + (settings.years === 1 ? " year" : " years");
    get("goal-prob").textContent = fmt.pct(result.probability, 0);
    get("goal-prob-sub").textContent = Math.round(result.probability * settings.paths).toLocaleString("en-IN") + " of " + settings.paths.toLocaleString("en-IN") + " paths";
    get("goal-median").textContent = fmt.inrCompact(result.median);
    get("goal-median-sub").textContent = fmt.inrCompact(result.invested) + " invested";
    get("goal-p5").textContent = fmt.inrCompact(result.p5);
    get("goal-p95").textContent = fmt.inrCompact(result.p95);
    get("goal-inputs").innerHTML = `Expected return <strong>${fmt.pct(client.expected)}</strong> and volatility <strong>${fmt.pct(client.volatility)}</strong> from the Allocation tab at A = ${fmt.num(client.A, 1)}. Returns are drawn from a lognormal distribution matched to those two numbers, independent month to month. Amounts are nominal, before tax and inflation.`;
    get("goal-desc").textContent = "The dark band holds the middle half of simulated outcomes and the light band holds nine in ten. The expected-return estimate rests on under seven years of data, so treat the probability as a guide.";
    const labels = Array.from({ length: settings.years + 1 }, (_, i) => "Year " + i);
    const crore = (values) => values.map((v) => v / 1e7);
    const band = (q) => crore(result.bands[q]);
    WCC.chart("chart-fan", {
      type: "line",
      data: { labels, datasets: [
        { label: "5th percentile", data: band(0.05), borderColor: "rgba(57,135,229,0.45)", borderWidth: 1, pointRadius: 0, fill: false },
        { label: "5th to 95th percentile", data: band(0.95), borderColor: "rgba(57,135,229,0.45)", borderWidth: 1, pointRadius: 0, backgroundColor: "rgba(57,135,229,0.16)", fill: 0 },
        { label: "25th percentile", data: band(0.25), borderColor: "rgba(57,135,229,0.7)", borderWidth: 1, pointRadius: 0, fill: false },
        { label: "25th to 75th percentile", data: band(0.75), borderColor: "rgba(57,135,229,0.7)", borderWidth: 1, pointRadius: 0, backgroundColor: "rgba(57,135,229,0.34)", fill: 2 },
        { label: "Median", data: band(0.5), borderColor: "#e6edf7", borderWidth: 2.25, pointRadius: 0, fill: false },
        { label: "Target", data: labels.map(() => settings.target / 1e7), borderColor: "#d95926", borderDash: [7, 5], borderWidth: 2, pointRadius: 0, fill: false },
      ] },
      options: { interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { min: 0, title: { display: true, text: "Portfolio value (₹ crore)" }, ticks: { callback: (v) => "₹" + v + " Cr" } } },
        plugins: { legend: { labels: { filter: (item) => !["5th percentile", "25th percentile"].includes(item.text) } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label.replace("5th to 95th", "95th").replace("25th to 75th", "75th") + ": ₹" + ctx.parsed.y.toFixed(2) + " Cr" } } } },
    });
    const stepYears = settings.years > 20 ? 5 : settings.years > 10 ? 2 : 1;
    const rows = labels.map((_, i) => i).filter((i) => i === settings.years || (i > 0 && i % stepYears === 0));
    get("goal-table").innerHTML = "<thead><tr><th>Year</th><th>5th pct</th><th>25th pct</th><th>Median</th><th>75th pct</th><th>95th pct</th></tr></thead><tbody>" +
      rows.map((i) => `<tr><td>Year ${i}</td>${[0.05, 0.25, 0.5, 0.75, 0.95].map((q) => `<td>${fmt.inrCompact(result.bands[q][i])}</td>`).join("")}</tr>`).join("") + "</tbody>";
  }

  WCC.register({ id: "goals", label: "Goals", order: 6, init, render });
})();
