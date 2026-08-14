/* ------------------------------------------------------------------ *
 *  Waypoint V2 — app logic (vanilla JS, IndexedDB, offline)
 * ------------------------------------------------------------------ */
const I = WaypointIcons, C = WaypointCalc;

const EXPENSE_CATEGORIES = [
  { name: "Food", icon: "food" }, { name: "Groceries", icon: "groceries" },
  { name: "Transport", icon: "transport" }, { name: "Rent", icon: "rent" },
  { name: "Bills", icon: "bills" }, { name: "Phone", icon: "phone" },
  { name: "Shopping", icon: "shopping" }, { name: "Entertainment", icon: "entertainment" },
  { name: "Remittance", icon: "remittance" }, { name: "Visa / Education", icon: "visa" },
  { name: "Other", icon: "other" },
];
const CAT_ICON = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.name, c.icon]));
const INCOME_SOURCES = ["Main job", "Second job", "Casual shift", "Other income"];
const CURRENCIES = ["AUD", "USD", "CAD", "NZD", "GBP", "EUR", "PHP", "INR", "CNY", "JPY"];

const state = {
  screen: "home",
  period: "week", periodOffset: 0,
  txFilter: "All", txSearch: "",
  forecastDays: 30,
  settings: null, bills: [], transactions: [],
  tuitionCharges: [], savingsAccounts: [], savingsGoals: [],
};

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth()}`;

function fmtMoney(amount) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: state.settings?.currency || "AUD",
      maximumFractionDigits: (state.settings?.currency === "JPY") ? 0 : 2,
    }).format(n);
  } catch { return `$${n.toFixed(2)}`; }
}
function fmtDateShort(d) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function toast(msg) {
  const el = $("#toast");
  el.innerHTML = I.get("check", { size: 16 }) + `<span>${escapeHtml(msg)}</span>`;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2000);
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }
function currencySymbol() {
  const map = { AUD: "A$", USD: "$", CAD: "C$", NZD: "NZ$", GBP: "£", EUR: "€", PHP: "₱", INR: "₹", CNY: "¥", JPY: "¥" };
  return map[state.settings?.currency] || "$";
}

/* ---------------- init ---------------- */
async function init() {
  await WaypointDB.migrateToV2IfNeeded();
  await ensureSeed();
  await loadAll();
  applyTheme();
  bindNav();
  bindAddSheet();
  bindOverlayClosers();
  runInterestPostingIfDue();
  render();
  registerServiceWorker();
}

async function ensureSeed() {
  const settings = await WaypointDB.get("settings", "profile");
  if (!settings) {
    await WaypointDB.put("settings", {
      id: "profile", name: "", currency: "AUD", payFrequency: "Weekly",
      payAnchor: todayISO(), startingBalance: 0, recentCategories: [],
      tuitionDueDate: "", theme: "system", schemaVersion: 2,
      expectedPayAmount: 0, plan: { expectedIncome: 0, allocations: [] },
    });
  }
  const accounts = await WaypointDB.getAll("savingsAccounts");
  if (accounts.length === 0) {
    await WaypointDB.put("savingsAccounts", {
      id: WaypointDB.uid(), name: "General Savings", balance: 0, interestRate: 0,
      monthlyGrowthTarget: null, balanceHistory: [{ date: todayISO(), balance: 0 }], createdAt: Date.now(),
    });
  }
}

async function loadAll() {
  state.settings = await WaypointDB.get("settings", "profile");
  state.bills = await WaypointDB.getAll("bills");
  state.transactions = await WaypointDB.getAll("transactions");
  state.tuitionCharges = await WaypointDB.getAll("tuitionCharges");
  state.savingsAccounts = await WaypointDB.getAll("savingsAccounts");
  state.savingsGoals = await WaypointDB.getAll("savingsGoals");
}

function tuitionPayments() { return state.transactions.filter(t => t.type === "tuitionPayment"); }

/* ---------------- theme ---------------- */
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.settings?.theme || "system");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#0b1224");
}
async function setTheme(theme) {
  state.settings.theme = theme;
  await WaypointDB.put("settings", state.settings);
  applyTheme();
  render();
}

/* ---------------- monthly interest posting ---------------- */
async function runInterestPostingIfDue() {
  const now = new Date();
  const currentKey = monthKey(now);
  let posted = false;
  for (const acct of state.savingsAccounts) {
    if ((acct.interestRate || 0) <= 0) continue;
    if (acct.lastInterestPostMonth === currentKey) continue;
    // Post interest for the most recently completed month we haven't posted yet.
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
    if (!acct.lastInterestPostMonth || acct.lastInterestPostMonth !== monthKey(lastMonthDate)) {
      // avoid posting for months we have no history for (e.g. brand-new account)
      if (!acct.balanceHistory || acct.balanceHistory.length === 0) { acct.lastInterestPostMonth = currentKey; await WaypointDB.put("savingsAccounts", acct); continue; }
    }
    const est = C.monthlyInterestEstimate(acct, lastMonthDate);
    if (est.projectedMonthEnd > 0) {
      const amount = est.projectedMonthEnd;
      acct.balance = C.round2((acct.balance || 0) + amount);
      acct.balanceHistory = [...(acct.balanceHistory || []), { date: todayISO(), balance: acct.balance }];
      await WaypointDB.put("transactions", {
        id: WaypointDB.uid(), type: "interest", amount, accountId: acct.id,
        description: `Interest earned — ${acct.name}`, date: todayISO(), createdAt: Date.now(),
      });
      posted = true;
    }
    acct.lastInterestPostMonth = currentKey;
    await WaypointDB.put("savingsAccounts", acct);
  }
  if (posted) await loadAll();
}

/* ---------------- nav ---------------- */
const NAV_TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "goals", label: "Goals", icon: "goals" },
  { id: "more", label: "More", icon: "more" },
];

function bindNav() {
  $all(".nav-btn[data-screen]").forEach(btn => {
    btn.addEventListener("click", () => goto(btn.dataset.screen));
  });
  $all(".js-open-add").forEach(btn => btn.addEventListener("click", () => openOverlay("addSheetOverlay")));
}

function bindOverlayClosers() {
  $all("[data-close]").forEach(btn => btn.addEventListener("click", () => closeOverlay(btn.dataset.close)));
  $all(".overlay").forEach(ov => ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlay(ov.id); }));
}
function openOverlay(id) { $("#" + id).classList.add("open"); }
function closeOverlay(id) { $("#" + id).classList.remove("open"); }

function bindAddSheet() {
  $("#opt-income").addEventListener("click", () => { closeOverlay("addSheetOverlay"); openIncomeForm(); });
  $("#opt-expense").addEventListener("click", () => { closeOverlay("addSheetOverlay"); openExpenseForm(); });
  $("#opt-savings").addEventListener("click", () => { closeOverlay("addSheetOverlay"); openSavingsContributionForm(); });
  $("#opt-tuition").addEventListener("click", () => { closeOverlay("addSheetOverlay"); openTuitionPaymentForm(); });
}

function goto(screen) { state.screen = screen; render(); window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" }); }

/* ---------------- render dispatcher ---------------- */
const SCREEN_RENDERERS = {
  home: renderHome, activity: renderActivity, goals: renderGoals, more: renderMore,
  tuition: renderTuition, insights: renderInsights, plan: renderPlan, forecast: renderForecast,
  bills: renderBillsScreen, settings: renderSettings,
};

function render() {
  $all(".screen").forEach(s => s.classList.remove("active"));
  $all(".nav-btn[data-screen]").forEach(b => {
    const active = b.dataset.screen === state.screen || (b.dataset.screen === "more" && ["insights","plan","forecast","bills","settings"].includes(state.screen)) || (b.dataset.screen === "goals" && state.screen === "tuition");
    b.classList.toggle("active", active);
  });
  const screenId = "#screen-" + state.screen;
  ($(screenId) || $("#screen-home")).classList.add("active");
  (SCREEN_RENDERERS[state.screen] || renderHome)();
}

/* ---------------- period math (reused for Home stats) ---------------- */
function getPeriodRange(period, offset) {
  const now = new Date();
  if (period === "week") {
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(now); monday.setDate(now.getDate() + diffToMonday + offset * 7); monday.setHours(0,0,0,0);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23,59,59,999);
    const label = offset === 0 ? "This Week" : `${fmtDateShort(monday)} – ${fmtDateShort(sunday)}`;
    return { start: monday, end: sunday, label };
  }
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
  const label = offset === 0 ? "This Month" : first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { start: first, end: last, label };
}
function txInRange(start, end) {
  return state.transactions.filter(t => { const d = new Date(t.date); return d >= start && d <= end; });
}
function periodTotals(start, end) {
  const rows = txInRange(start, end);
  const income = rows.filter(t => t.type === "income" || t.type === "interest").reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter(t => t.type === "expense" || t.type === "tuitionPayment").reduce((s, t) => s + t.amount, 0);
  const savings = rows.filter(t => t.type === "savings").reduce((s, t) => s + t.amount, 0) - rows.filter(t => t.type === "savingsWithdrawal").reduce((s, t) => s + t.amount, 0);
  return { income, expense, savings, available: income - expense - savings };
}
function currentBalance() { return C.currentBalance(state.transactions, state.settings.startingBalance); }
function upcomingBills(limit = 5) {
  return state.bills.filter(b => !b.paid).map(b => ({ ...b, next: C.nextOccurrence(b.dueDate, b.frequency) }))
    .filter(b => b.next).sort((a, b) => a.next - b.next).slice(0, limit);
}
function nextPayday() { return C.nextOccurrence(state.settings.payAnchor, state.settings.payFrequency); }

/* ==================================================================== *
 *  HOME
 * ==================================================================== */
function renderHome() {
  const el = $("#screen-home");
  const { start, end, label } = getPeriodRange(state.period, state.periodOffset);
  const totals = periodTotals(start, end);
  const bills = upcomingBills(4);
  const balance = currentBalance();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const weekStart = getPeriodRange("week", 0).start;
  const weekBalanceDelta = periodTotals(weekStart, new Date()).available;

  const tuition = C.tuitionSummary(state.tuitionCharges, tuitionPayments());
  const sts = computeSafeToSpend(balance);
  const billsTotal = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
  const activeGoal = state.savingsGoals.find(g => (g.monthlyContribution || 0) > 0);
  const goalRemainingThisMonth = activeGoal ? goalRemainingForMonth(activeGoal) : null;

  el.innerHTML = `
    <div class="dashboard-grid">
    <div>
    <div class="hero">
      <div class="greeting">${greeting}</div>
      <div class="label">${dateLabel}</div>
      <div class="label" style="margin-top:10px">Available balance</div>
      <div class="amount num">${fmtMoney(balance)}</div>
      ${weekBalanceDelta !== 0 ? `<div class="delta ${weekBalanceDelta >= 0 ? "pos" : "neg"}">${weekBalanceDelta >= 0 ? "+" : ""}${fmtMoney(weekBalanceDelta)} this week</div>` : ""}
    </div>

    <div class="period-switch">
      <button data-p="week" class="${state.period === "week" ? "active" : ""}">Week</button>
      <button data-p="month" class="${state.period === "month" ? "active" : ""}">Month</button>
    </div>
    <div class="period-nav">
      <button id="periodPrev">${I.get("chevronLeft", { size: 18 })}</button>
      <span class="period-label">${label}</span>
      <button id="periodNext" ${state.periodOffset >= 0 ? 'style="visibility:hidden"' : ""}>${I.get("chevronRight", { size: 18 })}</button>
    </div>
    <div class="stat-grid">
      <div class="stat income"><div class="stat-label">Income</div><div class="stat-value num">${fmtMoney(totals.income)}</div></div>
      <div class="stat expense"><div class="stat-label">Spent</div><div class="stat-value num">${fmtMoney(totals.expense)}</div></div>
      <div class="stat savings"><div class="stat-label">Saved</div><div class="stat-value num">${fmtMoney(totals.savings)}</div></div>
    </div>
    </div>

    <div>
    <div class="section-title" style="margin-top:var(--space-6)">Safe to spend</div>
    <div class="sts-card">
      <div class="sts-top">
        <div>
          <div class="sts-amount num">${fmtMoney(sts.amount)}</div>
          <div class="faint">until ${fmtDateShort(sts.untilDate)}</div>
        </div>
        <button class="sts-info-btn" id="stsInfoBtn">${I.get("compass", { size: 20 })}</button>
      </div>
      <div class="sts-breakdown" id="stsBreakdown">
        <div><span>Available balance</span><b class="num">${fmtMoney(sts.breakdown.balance)}</b></div>
        <div><span>Bills before payday</span><b class="num">−${fmtMoney(sts.breakdown.dueBills)}</b></div>
        ${sts.breakdown.tuitionDueBeforePayday ? `<div><span>Tuition reserve</span><b class="num">−${fmtMoney(sts.breakdown.tuitionDueBeforePayday)}</b></div>` : ""}
        <div class="faint" style="margin-top:6px">This is an estimate based on known bills and payments — not a guarantee.</div>
      </div>
    </div>

    <div class="section-title">Your money today</div>
    <div class="priority-list">
      <div class="priority-item"><div class="p-icon">${I.get("wallet", { size: 18 })}</div><div class="p-text"><b class="num">${fmtMoney(sts.amount)}</b> safe to spend until ${fmtDateShort(sts.untilDate)}</div></div>
      ${billsTotal > 0 ? `<div class="priority-item"><div class="p-icon">${I.get("bills", { size: 18 })}</div><div class="p-text"><b class="num">${fmtMoney(billsTotal)}</b> in bills coming up</div></div>` : ""}
      ${goalRemainingThisMonth !== null ? `<div class="priority-item"><div class="p-icon">${I.get("goals", { size: 18 })}</div><div class="p-text"><b class="num">${fmtMoney(Math.max(goalRemainingThisMonth,0))}</b> remaining toward ${escapeHtml(activeGoal.name)} this month</div></div>` : ""}
      ${tuition.remaining > 0 ? `<div class="priority-item"><div class="p-icon">${I.get("graduation", { size: 18 })}</div><div class="p-text"><b class="num">${fmtMoney(tuition.remaining)}</b> tuition remaining</div></div>` : ""}
    </div>

    <div class="section-title">Upcoming bills</div>
    <div class="card flat">
      ${bills.length === 0 ? `<div class="empty-note">No upcoming bills. Add one from More → Bills.</div>` :
        bills.map(b => `
          <div class="bill-item">
            <div class="bill-icon">${I.forCategory(b.category)}</div>
            <div class="bill-info"><div class="name">${escapeHtml(b.name)}</div><div class="meta">${fmtMoney(b.amount)} · due ${fmtDateShort(b.next)}</div></div>
            <button class="pay-btn" data-payid="${b.id}">Mark paid</button>
          </div>`).join("")}
    </div>
    </div>
    </div>
  `;

  $all(".period-switch button").forEach(btn => btn.addEventListener("click", () => { state.period = btn.dataset.p; state.periodOffset = 0; renderHome(); }));
  $("#periodPrev").addEventListener("click", () => { state.periodOffset -= 1; renderHome(); });
  $("#periodNext").addEventListener("click", () => { state.periodOffset = Math.min(0, state.periodOffset + 1); renderHome(); });
  $all("[data-payid]").forEach(btn => btn.addEventListener("click", () => markBillPaid(btn.dataset.payid)));
  $("#stsInfoBtn").addEventListener("click", () => $("#stsBreakdown").classList.toggle("open"));
}

function computeSafeToSpend(balance) {
  const tuition = C.tuitionSummary(state.tuitionCharges, tuitionPayments());
  let tuitionReserve = 0;
  if (tuition.remaining > 0 && state.settings.tuitionDueDate) {
    const payday = C.nextOccurrence(state.settings.payAnchor, state.settings.payFrequency) || new Date();
    if (C.toDate(state.settings.tuitionDueDate) <= payday) tuitionReserve = tuition.remaining;
  }
  const plannedSavings = (state.settings.plan?.allocations || [])
    .filter(a => a.name !== "Tuition")
    .reduce((s, a) => s + (Number(a.amount) || 0), 0) / 4.33; // rough per-week share of monthly plan
  return C.safeToSpend({
    balance, bills: state.bills, payAnchor: state.settings.payAnchor, payFrequency: state.settings.payFrequency,
    plannedSavingsPerPeriod: state.settings.payFrequency === "Monthly" ? plannedSavings * 4.33 : plannedSavings,
    tuitionDueBeforePayday: tuitionReserve,
  });
}

function goalRemainingForMonth(goal) {
  const { start, end } = getPeriodRange("month", 0);
  const contributedThisMonth = state.transactions
    .filter(t => t.type === "savings" && t.accountId === goal.linkedAccountId && new Date(t.date) >= start && new Date(t.date) <= end)
    .reduce((s, t) => s + t.amount, 0);
  return (goal.monthlyContribution || 0) - contributedThisMonth;
}

async function markBillPaid(id) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill) return;
  const next = C.nextOccurrence(bill.dueDate, bill.frequency) || new Date(bill.dueDate);
  await WaypointDB.put("transactions", { id: WaypointDB.uid(), type: "expense", amount: Number(bill.amount), category: bill.category, description: bill.name + " (bill)", date: todayISO(), createdAt: Date.now() });
  if (bill.frequency === "One-time") { bill.paid = true; }
  else {
    const d = new Date(next);
    const step = { Weekly: 7, Fortnightly: 14 }[bill.frequency];
    if (step) d.setDate(d.getDate() + step); else d.setMonth(d.getMonth() + ({ Monthly: 1, Quarterly: 3, Yearly: 12 }[bill.frequency] || 1));
    bill.dueDate = d.toISOString().slice(0, 10);
  }
  await WaypointDB.put("bills", bill);
  await loadAll(); toast("Bill marked as paid"); render();
}

/* ==================================================================== *
 *  ACTIVITY (transaction history)
 * ==================================================================== */
function renderActivity() {
  const el = $("#screen-activity");
  const filters = ["All", "Income", "Expense", "Savings", "Tuition"];
  let rows = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);
  if (state.txFilter !== "All") {
    const map = { Income: ["income", "interest"], Expense: ["expense"], Savings: ["savings", "savingsWithdrawal"], Tuition: ["tuitionPayment"] };
    rows = rows.filter(t => (map[state.txFilter] || []).includes(t.type));
  }
  if (state.txSearch.trim()) {
    const q = state.txSearch.toLowerCase();
    rows = rows.filter(t => (t.description || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q) || (t.source || "").toLowerCase().includes(q));
  }
  const groups = {};
  rows.forEach(t => { (groups[t.date] = groups[t.date] || []).push(t); });

  el.innerHTML = `
    <h1 class="page-title">Activity</h1>
    <div class="search-box">${I.get("search", { size: 17 })}<input id="txSearchInput" placeholder="Search transactions" value="${escapeAttr(state.txSearch)}" /></div>
    <div class="chip-row">${filters.map(f => `<button class="chip ${state.txFilter === f ? "active" : ""}" data-f="${f}">${f}</button>`).join("")}</div>
    ${rows.length === 0 ? `<div class="empty-note">No transactions match.</div>` :
      Object.keys(groups).sort((a, b) => new Date(b) - new Date(a)).map(dateKey => `
        <div class="tx-day-label">${dayLabel(dateKey)}</div>
        <div class="card flat">${groups[dateKey].map(txRowHtml).join("")}</div>
      `).join("")}
  `;
  $("#txSearchInput").addEventListener("input", (e) => { state.txSearch = e.target.value; renderActivity(); });
  $all(".chip[data-f]").forEach(c => c.addEventListener("click", () => { state.txFilter = c.dataset.f; renderActivity(); }));
  $all(".tx-item[data-txid]").forEach(row => row.addEventListener("click", () => openTransactionDetail(row.dataset.txid)));
}
function dayLabel(dateStr) {
  const diff = C.diffDays(dateStr, new Date());
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
function txMeta(t) {
  if (t.type === "savings") return accountName(t.accountId) + " · contribution";
  if (t.type === "savingsWithdrawal") return accountName(t.accountId) + " · withdrawal";
  if (t.type === "tuitionPayment") return "Tuition payment";
  if (t.type === "interest") return "Interest earned";
  if (t.type === "income") return t.source || "Income";
  return t.category || "";
}
function txIcon(t) {
  if (t.type === "income") return I.get("income", { size: 18 });
  if (t.type === "interest") return I.get("trendUp", { size: 18 });
  if (t.type === "savings" || t.type === "savingsWithdrawal") return I.get("savings", { size: 18 });
  if (t.type === "tuitionPayment") return I.get("graduation", { size: 18 });
  return I.forCategory(t.category);
}
function accountName(id) { return state.savingsAccounts.find(a => a.id === id)?.name || "Savings"; }
function isPositive(t) { return t.type === "income" || t.type === "interest" || t.type === "savingsWithdrawal"; }
function txRowHtml(t) {
  const desc = t.type === "income" ? (t.source || "Income") : t.description || txMeta(t);
  return `
    <div class="tx-item" data-txid="${t.id}" tabindex="0">
      <div class="tx-icon ${t.type}">${txIcon(t)}</div>
      <div class="tx-info"><div class="desc">${escapeHtml(desc)}</div><div class="meta">${escapeHtml(txMeta(t))}</div></div>
      <div class="tx-amount ${isPositive(t) ? "pos" : "neg"} num">${isPositive(t) ? "+" : "−"}${fmtMoney(Math.abs(t.amount))}</div>
    </div>`;
}

function openTransactionDetail(id) {
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  openFormSheet("Transaction details", `
    <div class="row" style="margin-bottom:var(--space-4)">
      <div>
        <div style="font-weight:700;font-size:16px">${escapeHtml(t.description || txMeta(t))}</div>
        <div class="faint">${txMeta(t)} · ${fmtDateShort(t.date)}</div>
      </div>
      <div class="tx-amount ${isPositive(t) ? "pos" : "neg"} num" style="font-size:19px">${isPositive(t) ? "+" : "−"}${fmtMoney(Math.abs(t.amount))}</div>
    </div>
    <button class="secondary-btn" id="editTxBtn">Edit</button>
    <button class="secondary-btn" id="dupTxBtn">Duplicate</button>
    <button class="secondary-btn danger-text" id="delTxBtn">Delete</button>
  `);
  $("#editTxBtn").addEventListener("click", () => openEditTransactionForm(t));
  $("#dupTxBtn").addEventListener("click", async () => {
    const copy = { ...t, id: WaypointDB.uid(), date: todayISO(), createdAt: Date.now() };
    await WaypointDB.put("transactions", copy);
    if (copy.type === "savings") await applySavingsDelta(copy.accountId, copy.amount);
    if (copy.type === "savingsWithdrawal") await applySavingsDelta(copy.accountId, -copy.amount);
    await loadAll(); closeFormSheet(); toast("Transaction duplicated"); render();
  });
  $("#delTxBtn").addEventListener("click", async () => {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    if (t.type === "savings") await applySavingsDelta(t.accountId, -t.amount);
    if (t.type === "savingsWithdrawal") await applySavingsDelta(t.accountId, t.amount);
    await WaypointDB.remove("transactions", t.id);
    await loadAll(); closeFormSheet(); toast("Transaction deleted"); render();
  });
}

function openEditTransactionForm(t) {
  const isExpense = t.type === "expense";
  openFormSheet("Edit transaction", `
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" value="${t.amount}" /></div></div>
    ${isExpense ? `<div class="form-group"><label class="form-label">Category</label><div class="chip-grid" id="editCatChips">${EXPENSE_CATEGORIES.map(c => `<button type="button" class="chip-opt ${c.name === t.category ? "selected" : ""}" data-cat="${c.name}">${I.get(c.icon, { size: 15 })} ${c.name}</button>`).join("")}</div></div>` : ""}
    <div class="form-group"><label class="form-label">Description</label><input class="field-input" id="f-desc" value="${escapeAttr(t.description || t.source || "")}" /></div>
    <div class="form-group"><label class="form-label">Date</label><input class="field-input" id="f-date" type="date" value="${t.date}" /></div>
    <button class="primary-btn" id="saveEditBtn">Save changes</button>
  `);
  let selectedCat = t.category;
  $all("#editCatChips .chip-opt").forEach(c => c.addEventListener("click", () => { $all("#editCatChips .chip-opt").forEach(x => x.classList.remove("selected")); c.classList.add("selected"); selectedCat = c.dataset.cat; }));
  $("#saveEditBtn").addEventListener("click", async () => {
    const newAmount = Number($("#f-amount").value);
    if (!newAmount || newAmount <= 0) { toast("Enter an amount"); return; }
    const oldAmount = t.amount;
    t.amount = newAmount;
    if (isExpense) t.category = selectedCat;
    if (t.type === "income") t.source = $("#f-desc").value.trim() || "Income"; else t.description = $("#f-desc").value.trim();
    t.date = $("#f-date").value || t.date;
    if (t.type === "savings" && newAmount !== oldAmount) await applySavingsDelta(t.accountId, newAmount - oldAmount);
    if (t.type === "savingsWithdrawal" && newAmount !== oldAmount) await applySavingsDelta(t.accountId, -(newAmount - oldAmount));
    await WaypointDB.put("transactions", t);
    await loadAll(); closeFormSheet(); toast("Transaction updated"); render();
  });
}

async function applySavingsDelta(accountId, delta) {
  const acct = state.savingsAccounts.find(a => a.id === accountId) || (await WaypointDB.get("savingsAccounts", accountId));
  if (!acct) return;
  acct.balance = C.round2((acct.balance || 0) + delta);
  acct.balanceHistory = [...(acct.balanceHistory || []), { date: todayISO(), balance: acct.balance }];
  await WaypointDB.put("savingsAccounts", acct);
}

/* ==================================================================== *
 *  GOALS — Tuition summary + Savings accounts + Savings goals
 * ==================================================================== */
function renderGoals() {
  const el = $("#screen-goals");
  const tuition = C.tuitionSummary(state.tuitionCharges, tuitionPayments());

  el.innerHTML = `
    <h1 class="page-title">Goals</h1>
    <div class="section-title" style="margin-top:0">Tuition</div>
    <div class="hero" style="padding:18px 20px;cursor:pointer" id="tuitionCard">
      <div class="row">
        <div><div class="label">Outstanding balance</div><div class="amount num" style="font-size:28px">${fmtMoney(tuition.remaining)}</div></div>
        ${I.get("chevronRight", { size: 20, className: "" })}
      </div>
      <div class="progress-track"><div class="progress-fill tuition" style="width:${tuition.percentPaid}%"></div></div>
      <div class="delta" style="color:#c7cbde">${Math.round(tuition.percentPaid)}% paid · ${fmtMoney(tuition.totalPaid)} of ${fmtMoney(tuition.totalCharges)}</div>
    </div>

    <div class="section-title">Savings accounts</div>
    ${state.savingsAccounts.map(accountHtml).join("")}
    <button class="secondary-btn" id="newAccountBtn">+ New savings account</button>

    <div class="section-title">Savings goals</div>
    ${state.savingsGoals.length === 0 ? `<div class="empty-note" style="border:1px solid var(--border);border-radius:var(--radius-md)">No goals yet. Goals track progress toward something specific, like an emergency fund.</div>` : state.savingsGoals.map(goalHtml).join("")}
    <button class="secondary-btn" id="newGoalBtn">+ New savings goal</button>
  `;

  $("#tuitionCard").addEventListener("click", () => goto("tuition"));
  $("#newAccountBtn").addEventListener("click", openNewAccountForm);
  $("#newGoalBtn").addEventListener("click", openNewGoalForm);
  $all("[data-acct-add]").forEach(b => b.addEventListener("click", () => openAccountAdjustForm(b.dataset.acctAdd, "savings")));
  $all("[data-acct-withdraw]").forEach(b => b.addEventListener("click", () => openAccountAdjustForm(b.dataset.acctWithdraw, "savingsWithdrawal")));
  $all("[data-acct-edit]").forEach(b => b.addEventListener("click", () => openEditAccountForm(b.dataset.acctEdit)));
  $all("[data-goal-edit]").forEach(b => b.addEventListener("click", () => openEditGoalForm(b.dataset.goalEdit)));
}

function accountHtml(a) {
  const est = C.monthlyInterestEstimate(a);
  const nextPost = est.nextPostingDate ? est.nextPostingDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const growthMet = a.monthlyGrowthTarget ? monthlyGrowth(a) >= a.monthlyGrowthTarget : null;
  return `
    <div class="account-card">
      <div class="account-head">
        <div><div class="account-name">${escapeHtml(a.name)}</div><div class="account-rate">${a.interestRate ? a.interestRate.toFixed(2) + "% p.a." : "No interest"}</div></div>
        <button class="icon-btn" data-acct-edit="${a.id}">${I.get("edit", { size: 16 })}</button>
      </div>
      <div class="account-balance num">${fmtMoney(a.balance)}</div>
      ${a.interestRate > 0 ? `
        <div class="interest-grid">
          <div><div class="k">Estimated accrued this month</div><div class="v num">+${fmtMoney(est.accruedThisMonth)}</div></div>
          <div><div class="k">Estimated month-end interest</div><div class="v num">+${fmtMoney(est.projectedMonthEnd)}</div></div>
        </div>
        <div class="faint" style="margin-top:6px">Estimated only — actual interest may differ. Posts ${nextPost}.</div>
      ` : ""}
      ${a.monthlyGrowthTarget ? `<div class="faint" style="margin-top:8px">Monthly growth requirement: ${fmtMoney(monthlyGrowth(a))} / ${fmtMoney(a.monthlyGrowthTarget)} ${growthMet ? "· " + I.get("check", { size: 12 }) + " Met" : ""}</div>` : ""}
      <div class="account-actions">
        <button data-acct-add="${a.id}">+ Add</button>
        <button data-acct-withdraw="${a.id}">− Withdraw</button>
      </div>
    </div>`;
}
function monthlyGrowth(a) {
  const { start, end } = getPeriodRange("month", 0);
  return state.transactions.filter(t => t.accountId === a.id && ["savings","interest"].includes(t.type) && new Date(t.date) >= start && new Date(t.date) <= end).reduce((s, t) => s + t.amount, 0)
    - state.transactions.filter(t => t.accountId === a.id && t.type === "savingsWithdrawal" && new Date(t.date) >= start && new Date(t.date) <= end).reduce((s, t) => s + t.amount, 0);
}

function goalHtml(g) {
  const current = g.linkedAccountId ? (state.savingsAccounts.find(a => a.id === g.linkedAccountId)?.balance || 0) : (g.current || 0);
  const pct = g.target ? Math.min((current / g.target) * 100, 100) : 0;
  let completion = "—";
  if (g.monthlyContribution > 0 && g.target > current) {
    const months = Math.ceil((g.target - current) / g.monthlyContribution);
    const d = new Date(); d.setMonth(d.getMonth() + months);
    completion = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } else if (current >= g.target && g.target > 0) completion = "Complete";
  return `
    <div class="goal-card">
      <div class="goal-head">
        <div><div class="goal-name">${escapeHtml(g.name)}</div><div class="faint">${fmtMoney(current)} of ${fmtMoney(g.target)}</div></div>
        <button class="icon-btn" data-goal-edit="${g.id}">${I.get("edit", { size: 16 })}</button>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="row"><span class="faint">${Math.round(pct)}% complete · ${fmtMoney(Math.max(g.target - current, 0))} remaining</span></div>
      ${g.monthlyContribution ? `<div class="faint" style="margin-top:4px">Current contribution: ${fmtMoney(g.monthlyContribution)}/month · est. completion ${completion}</div>` : ""}
    </div>`;
}

function openNewAccountForm() {
  openFormSheet("New savings account", `
    <div class="form-group"><label class="form-label">Account name</label><input class="field-input" id="f-name" placeholder="e.g. Growth Saver" /></div>
    <div class="form-group"><label class="form-label">Starting balance</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-balance" type="number" inputmode="decimal" placeholder="0.00" /></div></div>
    <div class="form-group"><label class="form-label">Annual interest rate (%) — leave blank for no interest</label><input class="field-input" id="f-rate" type="number" inputmode="decimal" step="0.01" placeholder="0.00" /></div>
    <div class="form-group"><label class="form-label">Monthly growth requirement (optional)</label><input class="field-input" id="f-growth" type="number" inputmode="decimal" placeholder="0" /></div>
    <button class="primary-btn" id="saveAcctBtn">Create account</button>
  `);
  $("#saveAcctBtn").addEventListener("click", async () => {
    const name = $("#f-name").value.trim();
    if (!name) { toast("Enter an account name"); return; }
    const balance = Number($("#f-balance").value) || 0;
    await WaypointDB.put("savingsAccounts", {
      id: WaypointDB.uid(), name, balance, interestRate: Number($("#f-rate").value) || 0,
      monthlyGrowthTarget: Number($("#f-growth").value) || null,
      balanceHistory: [{ date: todayISO(), balance }], createdAt: Date.now(),
    });
    await loadAll(); closeFormSheet(); toast("Account created"); render();
  });
}
function openEditAccountForm(id) {
  const a = state.savingsAccounts.find(x => x.id === id);
  if (!a) return;
  openFormSheet("Edit account", `
    <div class="form-group"><label class="form-label">Account name</label><input class="field-input" id="f-name" value="${escapeAttr(a.name)}" /></div>
    <div class="form-group"><label class="form-label">Annual interest rate (%) — 0 for no interest</label><input class="field-input" id="f-rate" type="number" inputmode="decimal" step="0.01" value="${a.interestRate || 0}" /></div>
    <div class="form-group"><label class="form-label">Monthly growth requirement (optional)</label><input class="field-input" id="f-growth" type="number" inputmode="decimal" value="${a.monthlyGrowthTarget || ""}" /></div>
    <button class="primary-btn" id="saveAcctBtn">Save changes</button>
    <button class="secondary-btn danger-text" id="delAcctBtn">Delete account</button>
  `);
  $("#saveAcctBtn").addEventListener("click", async () => {
    a.name = $("#f-name").value.trim() || a.name;
    a.interestRate = Number($("#f-rate").value) || 0;
    a.monthlyGrowthTarget = Number($("#f-growth").value) || null;
    await WaypointDB.put("savingsAccounts", a);
    await loadAll(); closeFormSheet(); toast("Account updated"); render();
  });
  $("#delAcctBtn").addEventListener("click", async () => {
    if (a.balance !== 0) { toast("Withdraw the balance before deleting"); return; }
    if (!confirm(`Delete "${a.name}"? Its transaction history will remain in Activity.`)) return;
    await WaypointDB.remove("savingsAccounts", a.id);
    await loadAll(); closeFormSheet(); toast("Account deleted"); render();
  });
}
function openAccountAdjustForm(accountId, type) {
  const a = state.savingsAccounts.find(x => x.id === accountId);
  const isWithdraw = type === "savingsWithdrawal";
  openFormSheet(isWithdraw ? "Withdraw from " + a.name : "Add to " + a.name, `
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" placeholder="0.00" autofocus /></div></div>
    <div class="form-group"><label class="form-label">Date</label><input class="field-input" id="f-date" type="date" value="${todayISO()}" /></div>
    <button class="primary-btn" id="saveAdjBtn">${isWithdraw ? "Withdraw" : "Add contribution"}</button>
  `);
  $("#saveAdjBtn").addEventListener("click", async () => {
    const amount = Number($("#f-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    if (isWithdraw && amount > a.balance) { toast("Amount exceeds account balance"); return; }
    await WaypointDB.put("transactions", { id: WaypointDB.uid(), type, amount, accountId: a.id, description: a.name, date: $("#f-date").value || todayISO(), createdAt: Date.now() });
    await applySavingsDelta(a.id, isWithdraw ? -amount : amount);
    await loadAll(); closeFormSheet(); toast(isWithdraw ? "Withdrawal recorded" : "Contribution recorded"); render();
  });
}

function openNewGoalForm() {
  openFormSheet("New savings goal", `
    <div class="form-group"><label class="form-label">Goal name</label><input class="field-input" id="f-name" placeholder="e.g. Emergency Fund" /></div>
    <div class="form-group"><label class="form-label">Target amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-target" type="number" inputmode="decimal" placeholder="0.00" /></div></div>
    <div class="form-group"><label class="form-label">Link to a savings account (optional)</label>
      <select class="field-input" id="f-link"><option value="">Not linked — track manually</option>${state.savingsAccounts.map(a => `<option value="${a.id}">${escapeAttr(a.name)}</option>`).join("")}</select>
    </div>
    <div class="form-group"><label class="form-label">Planned monthly contribution (optional)</label><input class="field-input" id="f-monthly" type="number" inputmode="decimal" placeholder="0" /></div>
    <button class="primary-btn" id="saveGoalBtn">Create goal</button>
  `);
  $("#saveGoalBtn").addEventListener("click", async () => {
    const name = $("#f-name").value.trim();
    const target = Number($("#f-target").value);
    if (!name || !target) { toast("Enter a name and target"); return; }
    await WaypointDB.put("savingsGoals", { id: WaypointDB.uid(), name, target, current: 0, linkedAccountId: $("#f-link").value || null, monthlyContribution: Number($("#f-monthly").value) || 0, createdAt: Date.now() });
    await loadAll(); closeFormSheet(); toast("Goal created"); render();
  });
}
function openEditGoalForm(id) {
  const g = state.savingsGoals.find(x => x.id === id);
  if (!g) return;
  openFormSheet("Edit goal", `
    <div class="form-group"><label class="form-label">Goal name</label><input class="field-input" id="f-name" value="${escapeAttr(g.name)}" /></div>
    <div class="form-group"><label class="form-label">Target amount</label><input class="field-input" id="f-target" type="number" inputmode="decimal" value="${g.target}" /></div>
    ${!g.linkedAccountId ? `<div class="form-group"><label class="form-label">Current progress</label><input class="field-input" id="f-current" type="number" inputmode="decimal" value="${g.current || 0}" /></div>` : `<p class="faint">Linked to ${escapeHtml(accountName(g.linkedAccountId))} — progress follows that account's balance.</p>`}
    <div class="form-group"><label class="form-label">Planned monthly contribution</label><input class="field-input" id="f-monthly" type="number" inputmode="decimal" value="${g.monthlyContribution || 0}" /></div>
    <button class="primary-btn" id="saveGoalBtn">Save changes</button>
    <button class="secondary-btn danger-text" id="delGoalBtn">Delete goal</button>
  `);
  $("#saveGoalBtn").addEventListener("click", async () => {
    g.name = $("#f-name").value.trim() || g.name;
    g.target = Number($("#f-target").value) || g.target;
    if ($("#f-current")) g.current = Number($("#f-current").value) || 0;
    g.monthlyContribution = Number($("#f-monthly").value) || 0;
    await WaypointDB.put("savingsGoals", g);
    await loadAll(); closeFormSheet(); toast("Goal updated"); render();
  });
  $("#delGoalBtn").addEventListener("click", async () => {
    if (!confirm(`Delete goal "${g.name}"? This does not affect linked account funds.`)) return;
    await WaypointDB.remove("savingsGoals", g.id);
    await loadAll(); closeFormSheet(); toast("Goal deleted"); render();
  });
}

/* ==================================================================== *
 *  TUITION (debt tracker)
 * ==================================================================== */
function renderTuition() {
  const el = $("#screen-tuition");
  const payments = tuitionPayments();
  const t = C.tuitionSummary(state.tuitionCharges, payments);
  const history = [
    ...state.tuitionCharges.map(c => ({ ...c, kind: "charge" })),
    ...payments.map(p => ({ ...p, kind: "payment" })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  el.innerHTML = `
    <button class="icon-btn" id="backBtn" style="margin-bottom:8px">${I.get("chevronLeft", { size: 20 })} <span style="font-size:14px;font-weight:600;margin-left:2px">Goals</span></button>
    <h1 class="page-title">Tuition</h1>
    <div class="hero">
      <div class="label">Outstanding balance</div>
      <div class="amount num">${fmtMoney(t.remaining)}</div>
      <div class="delta" style="color:#c7cbde">${t.remaining === 0 && t.totalCharges > 0 ? "Fully paid" : `${Math.round(t.percentPaid)}% paid`}</div>
      <div class="progress-track"><div class="progress-fill tuition" style="width:${t.percentPaid}%"></div></div>
      <div class="formula" style="border:none;padding:0;margin-top:8px;color:#c7cbde">Charges ${fmtMoney(t.totalCharges)} · Paid ${fmtMoney(t.totalPaid)}</div>
    </div>
    <button class="primary-btn" id="payTuitionBtn">Pay tuition</button>
    <button class="secondary-btn" id="addChargeBtn">Add tuition charge</button>

    <div class="section-title">History</div>
    <div class="card flat">
      ${history.length === 0 ? `<div class="empty-note">No tuition activity yet.</div>` : history.map(h => `
        <div class="tx-item">
          <div class="tx-icon ${h.kind === "charge" ? "" : "tuitionPayment"}">${I.get(h.kind === "charge" ? "flag" : "graduation", { size: 18 })}</div>
          <div class="tx-info"><div class="desc">${h.kind === "charge" ? (h.note || "Tuition charge added") : "Tuition payment"}</div><div class="meta">${fmtDateShort(h.date)}</div></div>
          <div class="tx-amount ${h.kind === "charge" ? "" : "pos"} num">${h.kind === "charge" ? "+" : "−"}${fmtMoney(h.amount)}</div>
        </div>`).join("")}
    </div>
  `;
  $("#backBtn").addEventListener("click", () => goto("goals"));
  $("#payTuitionBtn").addEventListener("click", () => openTuitionPaymentForm());
  $("#addChargeBtn").addEventListener("click", () => openTuitionChargeForm());
}

function openTuitionPaymentForm() {
  const t = C.tuitionSummary(state.tuitionCharges, tuitionPayments());
  openFormSheet("Pay tuition", `
    <p class="muted" style="margin-bottom:12px">Remaining before this payment: <b class="num">${fmtMoney(t.remaining)}</b></p>
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" placeholder="0.00" autofocus /></div></div>
    <div class="form-group"><label class="form-label">Date</label><input class="field-input" id="f-date" type="date" value="${todayISO()}" /></div>
    <div id="tuitionWarn"></div>
    <button class="primary-btn" id="saveTuitionPayBtn">Save payment</button>
  `);
  let confirmed = false;
  $("#saveTuitionPayBtn").addEventListener("click", async () => {
    const amount = Number($("#f-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    if (amount > t.remaining && !confirmed) {
      $("#tuitionWarn").innerHTML = `<div class="warn-banner">This is ${fmtMoney(amount - t.remaining)} more than the remaining balance. Tap Save again to record it anyway.</div>`;
      confirmed = true;
      return;
    }
    await WaypointDB.put("transactions", { id: WaypointDB.uid(), type: "tuitionPayment", amount, description: "Tuition payment", date: $("#f-date").value || todayISO(), createdAt: Date.now() });
    await loadAll(); closeFormSheet(); toast("Tuition payment recorded"); render();
  });
}
function openTuitionChargeForm() {
  openFormSheet("Add tuition charge", `
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" placeholder="0.00" autofocus /></div></div>
    <div class="form-group"><label class="form-label">Note (optional)</label><input class="field-input" id="f-note" placeholder="e.g. Semester 2 fees" /></div>
    <div class="form-group"><label class="form-label">Date</label><input class="field-input" id="f-date" type="date" value="${todayISO()}" /></div>
    <button class="primary-btn" id="saveChargeBtn">Add charge</button>
  `);
  $("#saveChargeBtn").addEventListener("click", async () => {
    const amount = Number($("#f-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    await WaypointDB.put("tuitionCharges", { id: WaypointDB.uid(), amount, note: $("#f-note").value.trim(), date: $("#f-date").value || todayISO(), createdAt: Date.now() });
    await loadAll(); closeFormSheet(); toast("Tuition charge added"); render();
  });
}

/* ==================================================================== *
 *  MORE (menu)
 * ==================================================================== */
function renderMore() {
  const el = $("#screen-more");
  const rows = [
    { id: "insights", label: "Insights", icon: "trendUp" },
    { id: "plan", label: "Monthly plan", icon: "compass" },
    { id: "forecast", label: "Cash-flow forecast", icon: "flag" },
    { id: "bills", label: "Bills", icon: "bills" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];
  el.innerHTML = `
    <h1 class="page-title">More</h1>
    <div class="settings-list">
      ${rows.map(r => `<div class="settings-row" data-go="${r.id}" style="cursor:pointer"><span class="label" style="display:flex;align-items:center;gap:10px">${I.get(r.icon, { size: 18 })} ${r.label}</span>${I.get("chevronRight", { size: 16 })}</div>`).join("")}
    </div>
  `;
  $all("[data-go]").forEach(r => r.addEventListener("click", () => goto(r.dataset.go)));
}
function backToMore(title) {
  return `<button class="icon-btn" id="backBtn" style="margin-bottom:8px">${I.get("chevronLeft", { size: 20 })} <span style="font-size:14px;font-weight:600;margin-left:2px">More</span></button><h1 class="page-title">${title}</h1>`;
}

/* ==================================================================== *
 *  INSIGHTS
 * ==================================================================== */
function renderInsights() {
  const el = $("#screen-insights");
  const { start, end } = getPeriodRange("month", 0);
  const prev = getPeriodRange("month", -1);
  const thisMonth = C.categoryBreakdown(state.transactions, start, end);
  const lastMonth = C.categoryBreakdown(state.transactions, prev.start, prev.end);
  const incomeThisMonth = periodTotals(start, end).income;
  const savedThisMonth = periodTotals(start, end).savings;
  const deltaVsLast = thisMonth.total - lastMonth.total;
  const insights = C.buildInsights({ thisMonth, lastMonth, incomeThisMonth, savedThisMonth });

  el.innerHTML = `
    ${backToMore("Insights")}
    <div class="hero" style="padding:18px 20px">
      <div class="label">${new Date().toLocaleDateString(undefined,{month:"long"})} spending</div>
      <div class="amount num" style="font-size:28px">${fmtMoney(thisMonth.total)}</div>
      ${lastMonth.total > 0 ? `<div class="delta ${deltaVsLast <= 0 ? "pos" : "neg"}">${deltaVsLast <= 0 ? "↓" : "↑"} ${fmtMoney(Math.abs(deltaVsLast))} compared with last month</div>` : ""}
    </div>

    ${insights.length ? `<div class="section-title">What stands out</div>${insights.map(i => `<div class="insight-card">${escapeHtml(i)}</div>`).join("")}` : `<div class="section-title">What stands out</div><div class="empty-note" style="border:1px solid var(--border);border-radius:var(--radius-md)">Add a few more transactions to unlock insights.</div>`}

    <div class="section-title">Category breakdown</div>
    <div class="chart-wrap">
      ${thisMonth.breakdown.length === 0 ? `<div class="empty-note">No spending recorded this month yet.</div>` : thisMonth.breakdown.map(c => `
        <div style="margin-bottom:12px">
          <div class="row" style="margin-bottom:5px"><span style="font-size:13.5px;font-weight:600">${escapeHtml(c.category)}</span><span class="faint num">${fmtMoney(c.amount)} · ${Math.round(c.percent)}%</span></div>
          <div class="progress-track" style="margin:0"><div class="progress-fill" style="width:${c.percent}%"></div></div>
        </div>`).join("")}
    </div>
  `;
  $("#backBtn").addEventListener("click", () => goto("more"));
}

/* ==================================================================== *
 *  MONTHLY PLAN
 * ==================================================================== */
function renderPlan() {
  const el = $("#screen-plan");
  const plan = state.settings.plan || { expectedIncome: 0, allocations: [] };
  const { start, end } = getPeriodRange("month", 0);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long" });

  const actualFor = (name) => {
    if (name === "Tuition") return tuitionPayments().filter(t => new Date(t.date) >= start && new Date(t.date) <= end).reduce((s, t) => s + t.amount, 0);
    const acct = state.savingsAccounts.find(a => a.name === name);
    if (acct) return state.transactions.filter(t => t.accountId === acct.id && t.type === "savings" && new Date(t.date) >= start && new Date(t.date) <= end).reduce((s, t) => s + t.amount, 0);
    return state.transactions.filter(t => t.type === "expense" && t.category === name && new Date(t.date) >= start && new Date(t.date) <= end).reduce((s, t) => s + t.amount, 0);
  };
  const allocatedTotal = plan.allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
  const remaining = (plan.expectedIncome || 0) - allocatedTotal;

  el.innerHTML = `
    ${backToMore(monthLabel + " Plan")}
    <div class="stat-grid" style="grid-template-columns:1fr 1fr">
      <div class="stat"><div class="stat-label">Expected income</div><div class="stat-value num">${fmtMoney(plan.expectedIncome || 0)}</div></div>
      <div class="stat"><div class="stat-label">Remaining unallocated</div><div class="stat-value num">${fmtMoney(remaining)}</div></div>
    </div>
    <div class="card flat">
      ${plan.allocations.length === 0 ? `<div class="empty-note">No allocations yet. Tap Edit plan to add some.</div>` : plan.allocations.map(a => {
        const actual = actualFor(a.name);
        const diff = Number(a.amount) - actual;
        return `<div class="plan-row"><div class="plan-name">${escapeHtml(a.name)}</div><div class="plan-nums">Planned <b class="num">${fmtMoney(a.amount)}</b><br/>Actual <b class="num">${fmtMoney(actual)}</b> · ${diff >= 0 ? "under" : "over"} by ${fmtMoney(Math.abs(diff))}</div></div>`;
      }).join("")}
    </div>
    <button class="secondary-btn" id="editPlanBtn">Edit plan</button>
  `;
  $("#backBtn").addEventListener("click", () => goto("more"));
  $("#editPlanBtn").addEventListener("click", () => openEditPlanForm());
}
function openEditPlanForm() {
  const plan = state.settings.plan || { expectedIncome: 0, allocations: [] };
  const rowsHtml = () => plan.allocations.map((a, i) => `
    <div class="form-group" style="display:flex;gap:8px;align-items:center">
      <input class="field-input" data-plan-name="${i}" value="${escapeAttr(a.name)}" placeholder="Category or account name" style="flex:2" />
      <input class="field-input" data-plan-amt="${i}" type="number" inputmode="decimal" value="${a.amount}" style="flex:1" />
      <button class="icon-btn" data-plan-del="${i}">${I.get("trash", { size: 16 })}</button>
    </div>`).join("");
  openFormSheet("Edit monthly plan", `
    <div class="form-group"><label class="form-label">Expected income</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-income" type="number" inputmode="decimal" value="${plan.expectedIncome || 0}" /></div></div>
    <label class="form-label">Allocations</label>
    <div id="planRows">${rowsHtml()}</div>
    <button class="secondary-btn" id="addPlanRowBtn">+ Add allocation</button>
    <button class="primary-btn" id="savePlanBtn">Save plan</button>
  `);
  const bindDeletes = () => $all("[data-plan-del]").forEach(b => b.addEventListener("click", () => { plan.allocations.splice(Number(b.dataset.planDel), 1); $("#planRows").innerHTML = rowsHtml(); bindDeletes(); }));
  bindDeletes();
  $("#addPlanRowBtn").addEventListener("click", () => { plan.allocations.push({ name: "", amount: 0 }); $("#planRows").innerHTML = rowsHtml(); bindDeletes(); });
  $("#savePlanBtn").addEventListener("click", async () => {
    $all("[data-plan-name]").forEach(inp => plan.allocations[Number(inp.dataset.planName)].name = inp.value.trim());
    $all("[data-plan-amt]").forEach(inp => plan.allocations[Number(inp.dataset.planAmt)].amount = Number(inp.value) || 0);
    plan.expectedIncome = Number($("#f-income").value) || 0;
    state.settings.plan = { expectedIncome: plan.expectedIncome, allocations: plan.allocations.filter(a => a.name) };
    await WaypointDB.put("settings", state.settings);
    await loadAll(); closeFormSheet(); toast("Plan updated"); render();
  });
}

/* ==================================================================== *
 *  CASH-FLOW FORECAST
 * ==================================================================== */
function renderForecast() {
  const el = $("#screen-forecast");
  const balance = currentBalance();
  const result = C.forecast({
    balance, bills: state.bills, payAnchor: state.settings.payAnchor, payFrequency: state.settings.payFrequency,
    payAmount: state.settings.expectedPayAmount, days: state.forecastDays,
  });
  el.innerHTML = `
    ${backToMore("Cash-flow forecast")}
    <div class="forecast-tabs">
      ${[7, 30, 90].map(d => `<button class="chip ${state.forecastDays === d ? "active" : ""}" data-days="${d}">${d} days</button>`).join("")}
    </div>
    <div class="hero" style="padding:16px 20px;margin-bottom:var(--space-5)">
      <div class="label">Projected balance in ${state.forecastDays} days</div>
      <div class="amount num" style="font-size:26px">${fmtMoney(result.projectedBalance)}</div>
      <div class="faint" style="color:#aeb3c6">Based on known bills and your regular payday only — not a guarantee.</div>
    </div>
    <div class="timeline">
      ${result.timeline.map(ev => `
        <div class="timeline-item">
          <div class="t-label">${escapeHtml(ev.label)}</div>
          <div class="t-sub">${ev.label === "Today" ? "Now" : fmtDateShort(ev.date)}</div>
          ${ev.amount !== 0 ? `<div class="t-amount ${ev.amount > 0 ? "" : ""}" style="color:${ev.amount > 0 ? "var(--positive)" : "var(--negative)"}">${ev.amount > 0 ? "+" : "−"}${fmtMoney(Math.abs(ev.amount))} → ${fmtMoney(ev.balance)}</div>` : `<div class="t-amount num">${fmtMoney(ev.balance)}</div>`}
        </div>`).join("")}
    </div>
    ${!state.settings.expectedPayAmount ? `<div class="faint">Set an expected pay amount in Settings for a more accurate forecast.</div>` : ""}
  `;
  $("#backBtn").addEventListener("click", () => goto("more"));
  $all("[data-days]").forEach(b => b.addEventListener("click", () => { state.forecastDays = Number(b.dataset.days); renderForecast(); }));
}

/* ==================================================================== *
 *  BILLS
 * ==================================================================== */
function renderBillsScreen() {
  const el = $("#screen-bills");
  const rows = [...state.bills].sort((a, b) => (a.paid === b.paid ? 0 : a.paid ? 1 : -1));
  el.innerHTML = `
    ${backToMore("Bills")}
    <div class="card flat">
      ${rows.length === 0 ? `<div class="empty-note">No bills yet.</div>` : rows.map(b => `
        <div class="bill-item" data-bill="${b.id}" style="cursor:pointer">
          <div class="bill-icon">${I.forCategory(b.category)}</div>
          <div class="bill-info"><div class="name">${escapeHtml(b.name)}</div><div class="meta">${fmtMoney(b.amount)} · ${b.frequency}${b.paid ? " · paid" : ""}</div></div>
          ${I.get("chevronRight", { size: 16 })}
        </div>`).join("")}
    </div>
    <button class="secondary-btn" id="newBillBtn">+ Add bill</button>
  `;
  $("#backBtn").addEventListener("click", () => goto("more"));
  $("#newBillBtn").addEventListener("click", () => openBillForm());
  $all("[data-bill]").forEach(r => r.addEventListener("click", () => openBillForm(r.dataset.bill)));
}
function openBillForm(id) {
  const bill = id ? state.bills.find(b => b.id === id) : null;
  openFormSheet(bill ? "Edit bill" : "Add bill", `
    <div class="form-group"><label class="form-label">Name</label><input class="field-input" id="f-name" value="${escapeAttr(bill?.name || "")}" placeholder="e.g. Phone plan" /></div>
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" value="${bill?.amount || ""}" /></div></div>
    <div class="form-group"><label class="form-label">Category</label><div class="chip-grid" id="billCatChips">${EXPENSE_CATEGORIES.map(c => `<button type="button" class="chip-opt ${bill?.category === c.name ? "selected" : ""}" data-cat="${c.name}">${I.get(c.icon,{size:15})} ${c.name}</button>`).join("")}</div></div>
    <div class="form-group"><label class="form-label">Due date</label><input class="field-input" id="f-due" type="date" value="${bill?.dueDate || todayISO()}" /></div>
    <div class="form-group"><label class="form-label">Frequency</label><select class="field-input" id="f-freq">${["One-time","Weekly","Fortnightly","Monthly","Quarterly","Yearly"].map(f => `<option ${bill?.frequency === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
    <button class="primary-btn" id="saveBillBtn">${bill ? "Save changes" : "Add bill"}</button>
    ${bill ? `<button class="secondary-btn danger-text" id="delBillBtn">Delete bill</button>` : ""}
  `);
  let selectedCat = bill?.category;
  $all("#billCatChips .chip-opt").forEach(c => c.addEventListener("click", () => { $all("#billCatChips .chip-opt").forEach(x => x.classList.remove("selected")); c.classList.add("selected"); selectedCat = c.dataset.cat; }));
  $("#saveBillBtn").addEventListener("click", async () => {
    const name = $("#f-name").value.trim();
    const amount = Number($("#f-amount").value);
    if (!name || !amount) { toast("Enter a name and amount"); return; }
    const record = bill || { id: WaypointDB.uid(), paid: false };
    record.name = name; record.amount = amount; record.category = selectedCat || "Bills";
    record.dueDate = $("#f-due").value; record.frequency = $("#f-freq").value;
    await WaypointDB.put("bills", record);
    await loadAll(); closeFormSheet(); toast(bill ? "Bill updated" : "Bill added"); render();
  });
  if (bill) $("#delBillBtn").addEventListener("click", async () => {
    if (!confirm("Delete this bill?")) return;
    await WaypointDB.remove("bills", bill.id);
    await loadAll(); closeFormSheet(); toast("Bill deleted"); render();
  });
}

/* ==================================================================== *
 *  SETTINGS
 * ==================================================================== */
function renderSettings() {
  const el = $("#screen-settings");
  const s = state.settings;
  el.innerHTML = `
    ${backToMore("Settings")}
    <div class="section-title" style="margin-top:0">Appearance</div>
    <div class="settings-list">
      <div class="settings-row"><span class="label">Theme</span>
        <div class="segmented" id="themeSeg">
          ${[["system","system"],["light","sun"],["dark","moon"]].map(([id,icon]) => `<button data-theme="${id}" class="${s.theme === id ? "active" : ""}">${I.get(icon,{size:15})}</button>`).join("")}
        </div>
      </div>
    </div>

    <div class="section-title">Profile</div>
    <div class="form-group"><label class="form-label">Name</label><input class="field-input" id="f-settingsName" value="${escapeAttr(s.name || "")}" /></div>
    <div class="form-group"><label class="form-label">Currency</label><select class="field-input" id="f-currency">${CURRENCIES.map(c => `<option ${s.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="form-group"><label class="form-label">Pay frequency</label><select class="field-input" id="f-payFreq">${["Weekly","Fortnightly","Monthly"].map(f => `<option ${s.payFrequency === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
    <div class="form-group"><label class="form-label">Next / last payday</label><input class="field-input" id="f-payAnchor" type="date" value="${s.payAnchor || todayISO()}" /></div>
    <div class="form-group"><label class="form-label">Expected pay amount (for forecast)</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-payAmount" type="number" inputmode="decimal" value="${s.expectedPayAmount || 0}" /></div></div>
    <div class="form-group"><label class="form-label">Starting balance</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-startBal" type="number" inputmode="decimal" value="${s.startingBalance || 0}" /></div></div>
    <div class="form-group"><label class="form-label">Tuition due date (optional, used for Safe to Spend)</label><input class="field-input" id="f-tuitionDate" type="date" value="${s.tuitionDueDate || ""}" /></div>
    <button class="primary-btn" id="saveSettingsBtn">Save settings</button>

    <div class="section-title">Backup</div>
    <button class="secondary-btn" id="exportBtn">Export backup</button>
    <button class="secondary-btn" id="importBtn">Import backup</button>
    <input type="file" id="importFile" accept="application/json" style="display:none" />
  `;
  $("#backBtn").addEventListener("click", () => goto("more"));
  $all("#themeSeg button").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.theme)));
  $("#saveSettingsBtn").addEventListener("click", async () => {
    s.name = $("#f-settingsName").value.trim();
    s.currency = $("#f-currency").value;
    s.payFrequency = $("#f-payFreq").value;
    s.payAnchor = $("#f-payAnchor").value;
    s.expectedPayAmount = Number($("#f-payAmount").value) || 0;
    s.startingBalance = Number($("#f-startBal").value) || 0;
    s.tuitionDueDate = $("#f-tuitionDate").value;
    await WaypointDB.put("settings", s);
    await loadAll(); toast("Settings saved"); render();
  });
  $("#exportBtn").addEventListener("click", async () => {
    const data = await WaypointDB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `waypoint-backup-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
  });
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm("Importing will replace all current Waypoint data on this device. Continue?")) { e.target.value = ""; return; }
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await WaypointDB.importAll(data);
      await loadAll(); applyTheme(); toast("Backup imported"); render();
    } catch { toast("Could not read that file"); }
    e.target.value = "";
  });
}

/* ==================================================================== *
 *  QUICK ADD forms (Income / Expense / Savings / Tuition)
 * ==================================================================== */
function openFormSheet(title, bodyHtml) {
  $("#formSheetContent").innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head"><div class="sheet-title">${escapeHtml(title)}</div><button class="icon-btn" data-close="formSheetOverlay">${I.get("close", { size: 18 })}</button></div>
    ${bodyHtml}
  `;
  openOverlay("formSheetOverlay");
}
function closeFormSheet() { closeOverlay("formSheetOverlay"); }

function openIncomeForm() {
  openFormSheet("Add income", `
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" placeholder="0.00" autofocus /></div></div>
    <div class="form-group"><label class="form-label">Job / source</label><div class="chip-grid" id="incomeSourceChips">${INCOME_SOURCES.map(s => `<button type="button" class="chip-opt" data-src="${s}">${s}</button>`).join("")}</div><input class="field-input" id="f-source" placeholder="Or type a custom source" style="margin-top:8px" /></div>
    <div class="form-group"><label class="form-label">Date received</label><input class="field-input" id="f-date" type="date" value="${todayISO()}" /></div>
    <button class="primary-btn" id="saveIncomeBtn">Save income</button>
  `);
  $all("#incomeSourceChips .chip-opt").forEach(c => c.addEventListener("click", () => { $all("#incomeSourceChips .chip-opt").forEach(x => x.classList.remove("selected")); c.classList.add("selected"); $("#f-source").value = c.dataset.src; }));
  $("#saveIncomeBtn").addEventListener("click", async () => {
    const amount = Number($("#f-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    await WaypointDB.put("transactions", { id: WaypointDB.uid(), type: "income", amount, source: $("#f-source").value.trim() || "Income", date: $("#f-date").value || todayISO(), createdAt: Date.now() });
    await loadAll(); closeFormSheet(); toast("Income added"); render();
  });
}
function openExpenseForm() {
  const recent = state.settings.recentCategories || [];
  const ordered = [...recent, ...EXPENSE_CATEGORIES.map(c => c.name).filter(n => !recent.includes(n))];
  openFormSheet("Add expense", `
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" placeholder="0.00" autofocus /></div></div>
    <div class="form-group"><label class="form-label">Category</label><div class="chip-grid" id="expenseCatChips">${ordered.map(name => `<button type="button" class="chip-opt" data-cat="${name}">${I.get(CAT_ICON[name] || "other", { size: 15 })} ${name}</button>`).join("")}</div></div>
    <div class="form-group"><label class="form-label">Description (optional)</label><input class="field-input" id="f-desc" placeholder="e.g. Woolworths" /></div>
    <div class="form-group"><label class="form-label">Date</label><input class="field-input" id="f-date" type="date" value="${todayISO()}" /></div>
    <button class="primary-btn" id="saveExpenseBtn">Save expense</button>
  `);
  let selectedCat = null;
  $all("#expenseCatChips .chip-opt").forEach(c => c.addEventListener("click", () => { $all("#expenseCatChips .chip-opt").forEach(x => x.classList.remove("selected")); c.classList.add("selected"); selectedCat = c.dataset.cat; }));
  $("#saveExpenseBtn").addEventListener("click", async () => {
    const amount = Number($("#f-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    if (!selectedCat) { toast("Pick a category"); return; }
    await WaypointDB.put("transactions", { id: WaypointDB.uid(), type: "expense", amount, category: selectedCat, description: $("#f-desc").value.trim(), date: $("#f-date").value || todayISO(), createdAt: Date.now() });
    state.settings.recentCategories = [selectedCat, ...(state.settings.recentCategories || []).filter(c => c !== selectedCat)].slice(0, 6);
    await WaypointDB.put("settings", state.settings);
    await loadAll(); closeFormSheet(); toast("Expense added"); render();
  });
}
function openSavingsContributionForm() {
  if (state.savingsAccounts.length === 0) { openFormSheet("Add savings contribution", `<div class="empty-note">Create a savings account first from the Goals tab.</div>`); return; }
  openFormSheet("Add savings contribution", `
    <div class="form-group"><label class="form-label">Account</label><div class="chip-grid" id="acctChips">${state.savingsAccounts.map(a => `<button type="button" class="chip-opt" data-acct="${a.id}">${escapeHtml(a.name)}</button>`).join("")}</div></div>
    <div class="form-group"><label class="form-label">Amount</label><div class="amount-input-wrap"><span class="cur">${currencySymbol()}</span><input id="f-amount" type="number" inputmode="decimal" placeholder="0.00" /></div></div>
    <div class="form-group"><label class="form-label">Date</label><input class="field-input" id="f-date" type="date" value="${todayISO()}" /></div>
    <button class="primary-btn" id="saveSavingsBtn">Save contribution</button>
  `);
  let selectedAcct = state.savingsAccounts[0]?.id;
  $all("#acctChips .chip-opt")[0]?.classList.add("selected");
  $all("#acctChips .chip-opt").forEach(c => c.addEventListener("click", () => { $all("#acctChips .chip-opt").forEach(x => x.classList.remove("selected")); c.classList.add("selected"); selectedAcct = c.dataset.acct; }));
  $("#saveSavingsBtn").addEventListener("click", async () => {
    const amount = Number($("#f-amount").value);
    if (!amount || amount <= 0) { toast("Enter an amount"); return; }
    await WaypointDB.put("transactions", { id: WaypointDB.uid(), type: "savings", amount, accountId: selectedAcct, description: accountName(selectedAcct), date: $("#f-date").value || todayISO(), createdAt: Date.now() });
    await applySavingsDelta(selectedAcct, amount);
    await loadAll(); closeFormSheet(); toast("Savings contribution recorded"); render();
  });
}

/* ---------------- utils ---------------- */
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
