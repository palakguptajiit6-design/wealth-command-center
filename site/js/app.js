/* Builds the tabs from registered modules and keeps the summary strip current. */
(function () {
  "use strict";
  const { fmt } = WCC;
  const el = (id) => document.getElementById(id);
  const initialised = new Set();

  function renderKpis() {
    const client = WCC.client();
    const var95 = WCC.valueAtRisk(WCC.dailySeries(client), 0.95);
    el("kpi-a").textContent = fmt.num(client.A, 1);
    el("kpi-y").textContent = fmt.pct(client.y, 0);
    el("kpi-return").textContent = fmt.pct(client.expected);
    el("kpi-vol").textContent = fmt.pct(client.volatility);
    el("kpi-var").textContent = fmt.pct(var95.var_historical, 2);
  }

  function renderActive() {
    const module = WCC.modules.find((m) => m.id === WCC.state.activeTab);
    if (module && initialised.has(module.id)) module.render();
  }

  function activate(id) {
    WCC.state.activeTab = id;
    WCC.modules.forEach((module) => {
      const selected = module.id === id;
      el("tab-" + module.id).classList.toggle("active", selected);
      el("tab-" + module.id).setAttribute("aria-selected", String(selected));
      el("panel-" + module.id).classList.toggle("active", selected);
    });
    const module = WCC.modules.find((m) => m.id === id);
    if (!initialised.has(id)) { module.init(el("panel-" + id)); initialised.add(id); }
    module.render();
    try { history.replaceState(null, "", "#" + id); } catch (error) { /* some embedded previews block this */ }
  }
  WCC.activate = activate;

  function buildTabs() {
    const nav = el("tab-nav"), panels = el("panels");
    WCC.modules.forEach((module, index) => {
      const button = document.createElement("button");
      button.className = "tab-btn";
      button.id = "tab-" + module.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "panel-" + module.id);
      button.textContent = String(index + 1).padStart(2, "0") + " · " + module.label;
      button.addEventListener("click", () => activate(module.id));
      nav.appendChild(button);
      const panel = document.createElement("section");
      panel.className = "tab-panel";
      panel.id = "panel-" + module.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", "tab-" + module.id);
      panels.appendChild(panel);
    });
  }

  function startClock() {
    const tick = () => { el("clock").textContent = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) + " IST"; };
    tick();
    setInterval(tick, 1000);
  }

  async function start() {
    startClock();
    try {
      await WCC.loadData();
    } catch (error) {
      el("load-error").hidden = false;
      el("data-badge").textContent = "NO DATA";
      return;
    }
    WCC.setupCharts();
    const { manifest, frontier, universe } = WCC.data;
    el("data-badge").textContent = "DATA TO " + fmt.date(manifest.data_through).toUpperCase();
    el("kpi-rf").textContent = fmt.pct(frontier.risk_free_rate, 2);
    el("footer-data").textContent = "Daily data " + fmt.date(universe.window.start) + " to " + fmt.date(universe.window.end) + ", refreshed weekly.";
    buildTabs();
    renderKpis();
    WCC.onChange(() => { renderKpis(); renderActive(); });
    const requested = location.hash.slice(1);
    activate(WCC.modules.some((m) => m.id === requested) ? requested : WCC.modules[0].id);
    window.WCC_READY = true;
  }
  start();
})();
