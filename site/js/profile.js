/* Module 1: client onboarding. Maps answers to the risk aversion coefficient A in U = E(r) - 0.5 A variance. */
(function () {
  "use strict";
  const { fmt } = WCC;
  const A_MOST_CAUTIOUS = 14;
  const A_MOST_AGGRESSIVE = 2;

  const QUESTIONS = [
    { id: "horizon", tag: "Capacity", text: "When will you first need a meaningful part of this money?",
      options: ["Within 3 years", "In 3 to 5 years", "In 5 to 10 years", "In 10 to 15 years", "More than 15 years away"] },
    { id: "income", tag: "Capacity", text: "How dependable is your income over the next five years?",
      options: ["Uncertain or irregular", "Somewhat variable", "Mostly stable", "Stable and growing", "Very secure, from several sources"] },
    { id: "reserve", tag: "Capacity", text: "How many months of expenses do you hold in cash outside this portfolio?",
      options: ["Under 3 months", "3 to 6 months", "6 to 9 months", "9 to 12 months", "More than 12 months"] },
    { id: "share", tag: "Capacity", text: "What share of your total wealth would this portfolio represent?",
      options: ["Almost all of it", "About three quarters", "About half", "About a quarter", "Less than a quarter"] },
    { id: "drawdown", tag: "Willingness", text: "Your portfolio falls 20% in three months. What would you do?",
      options: ["Sell everything", "Sell some to limit losses", "Wait and do nothing", "Rebalance back to target", "Invest more while prices are low"] },
    { id: "tradeoff", tag: "Willingness", text: "Which one-year range of outcomes would you be most comfortable holding?",
      options: ["+6% to +7%", "+1% to +11%", "−6% to +18%", "−15% to +27%", "−28% to +42%"] },
    { id: "priority", tag: "Willingness", text: "Which statement is closest to your main objective?",
      options: ["Protect what I have", "Mostly protect, with a little growth", "Balance growth and protection", "Mostly growth", "Maximum long-term growth"] },
    { id: "experience", tag: "Willingness", text: "Which investments have you held through a market fall?",
      options: ["Only deposits", "Debt funds or bonds", "Balanced funds", "Equity funds", "Direct equities and more"] },
  ];

  const answers = {};
  let panel;

  function score(tag) {
    const group = QUESTIONS.filter((q) => q.tag === tag);
    return WCC.math.sum(group.map((q) => answers[q.id])) / (group.length * 4);
  }
  const complete = () => QUESTIONS.every((q) => answers[q.id] !== undefined);

  /* The lower of ability and willingness governs. Geometric, because utility responds to the ratio of A. */
  function aversionFromScore(governing) {
    return A_MOST_CAUTIOUS * Math.pow(A_MOST_AGGRESSIVE / A_MOST_CAUTIOUS, governing);
  }
  function profileName(A) {
    if (A >= 10) return "Capital Preservation";
    if (A >= 6.5) return "Conservative";
    if (A >= 4) return "Balanced";
    if (A >= 2.75) return "Growth";
    return "Aggressive Growth";
  }
  WCC.profile = { QUESTIONS, aversionFromScore, profileName };

  function init(root) {
    panel = root;
    root.innerHTML = `
      <div class="panel-grid wide-left">
        <div class="card">
          <h2 class="card-title">Client Onboarding</h2>
          <p class="card-desc">Before any allocation is proposed, we establish two separate things: how much risk you can <strong>afford</strong> to take, and how much you are <strong>comfortable</strong> taking. The lower of the two sets your plan.</p>
          <form id="risk-form">${QUESTIONS.map((q) => `
            <fieldset class="question"><legend><span class="q-tag">${q.tag}</span>${q.text}</legend>
              <div class="options">${q.options.map((option, value) => `<label class="option"><input type="radio" name="${q.id}" value="${value}" /> <span>${option}</span></label>`).join("")}</div>
            </fieldset>`).join("")}
          </form>
        </div>
        <div class="sticky">
          <div class="card">
            <h2 class="card-title">Your Risk Profile</h2>
            <p class="progress-note" id="profile-progress"></p>
            <div class="big-number" id="profile-a">—</div>
            <div class="stat-label" style="margin-top:6px">Risk aversion coefficient A</div>
            <div class="profile-name" id="profile-name">—</div>
            <div class="meter"><div class="meter-head"><span>Capacity for risk</span><span id="meter-capacity-val">—</span></div><div class="meter-track"><div class="meter-fill" id="meter-capacity" style="width:0"></div></div></div>
            <div class="meter"><div class="meter-head"><span>Willingness for risk</span><span id="meter-willing-val">—</span></div><div class="meter-track"><div class="meter-fill" id="meter-willing" style="width:0"></div></div></div>
            <p class="card-desc" id="profile-reason"></p>
          </div>
          <div class="card">
            <h2 class="card-title">Indicated Allocation</h2>
            <div class="alloc-bar" id="profile-bar"></div>
            <div class="alloc-legend" id="profile-legend"></div>
            <p class="card-desc" id="profile-summary" style="margin-top:12px"></p>
            <button class="btn" id="profile-next" type="button">Review the allocation →</button>
          </div>
        </div>
      </div>`;
    root.querySelector("#risk-form").addEventListener("change", (event) => {
      answers[event.target.name] = Number(event.target.value);
      if (complete()) {
        WCC.setA(Math.round(aversionFromScore(Math.min(score("Capacity"), score("Willingness"))) * 10) / 10, "questionnaire");
      } else {
        render();
      }
    });
    root.querySelector("#profile-next").addEventListener("click", () => {
      if (WCC.modules.some((m) => m.id === "allocation")) WCC.activate("allocation");
    });
  }

  function render() {
    const get = (id) => panel.querySelector("#" + id);
    const answered = Object.keys(answers).length;
    const client = WCC.client();
    get("profile-a").textContent = fmt.num(client.A, 1);
    get("profile-name").textContent = profileName(client.A);
    const done = complete();
    get("profile-progress").textContent = done ? "Questionnaire complete" : answered + " of " + QUESTIONS.length + " answered, showing an illustrative A until complete";
    const capacity = done ? score("Capacity") : null, willing = done ? score("Willingness") : null;
    get("meter-capacity").style.width = done ? capacity * 100 + "%" : "0";
    get("meter-willing").style.width = done ? willing * 100 + "%" : "0";
    get("meter-capacity-val").textContent = done ? fmt.pct(capacity, 0) : "—";
    get("meter-willing-val").textContent = done ? fmt.pct(willing, 0) : "—";
    if (done && WCC.state.source === "questionnaire") {
      get("profile-reason").textContent = capacity === willing ? "Your capacity and willingness match, so both set your plan."
        : capacity < willing ? "You are comfortable with more risk than your circumstances can absorb, so your capacity sets the plan."
        : "Your circumstances could absorb more risk than you are comfortable with, so your comfort sets the plan.";
    } else if (WCC.state.source === "slider") {
      get("profile-reason").textContent = "A has been set by hand on the Allocation tab and overrides the questionnaire.";
    } else {
      get("profile-reason").textContent = "Answer all eight questions to set your own coefficient.";
    }
    WCC.renderAllocation(get("profile-bar"), get("profile-legend"), client);
    get("profile-summary").innerHTML = "Expected return <strong>" + fmt.pct(client.expected) + "</strong> a year, with volatility of <strong>" + fmt.pct(client.volatility) + "</strong>. These are model estimates, not promises.";
  }

  WCC.register({ id: "profile", label: "Client Profile", order: 1, init, render });
})();
