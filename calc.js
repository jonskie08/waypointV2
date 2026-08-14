/* ------------------------------------------------------------------ *
 *  Waypoint — financial calculation utilities
 *  No DOM access here. Every function takes plain data in, plain
 *  data out, so these are easy to reason about and reuse.
 * ------------------------------------------------------------------ */
const WaypointCalc = (() => {

  function toDate(d) {
    const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }
  function diffDays(a, b) {
    return Math.round((toDate(b) - toDate(a)) / 86400000);
  }
  function isoDate(d) { return toDate(d).toISOString().slice(0, 10); }
  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

  /* ---------------- running balance ---------------- */
  function currentBalance(transactions, startingBalance) {
    const start = Number(startingBalance) || 0;
    return transactions.reduce((bal, t) => {
      if (t.type === "income" || t.type === "interest") return bal + t.amount;
      return bal - t.amount;
    }, start);
  }

  /* ---------------- tuition (debt model) ---------------- *
   * Remaining Tuition = Tuition Charges − Tuition Payments
   */
  function tuitionSummary(charges, payments) {
    const totalCharges = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const remaining = Math.max(totalCharges - totalPaid, 0);
    const percentPaid = totalCharges > 0 ? Math.min((totalPaid / totalCharges) * 100, 100) : 0;
    return { totalCharges, totalPaid, remaining, percentPaid };
  }

  /* ---------------- recurring bill / payday occurrence math ---------------- */
  function nextOccurrence(anchorStr, frequency, from = new Date()) {
    if (!anchorStr) return null;
    let d = toDate(anchorStr);
    const f = toDate(from);
    if (frequency === "One-time") return d >= f ? d : null;
    const stepDays = { Weekly: 7, Fortnightly: 14 }[frequency];
    if (stepDays) {
      if (d >= f) return d;
      const n = Math.ceil(diffDays(d, f) / stepDays);
      d.setDate(d.getDate() + n * stepDays);
      return d;
    }
    const monthsStep = { Monthly: 1, Quarterly: 3, Yearly: 12 }[frequency] || 1;
    while (d < f) d.setMonth(d.getMonth() + monthsStep);
    return d;
  }

  function occurrencesBetween(anchorStr, frequency, start, end) {
    const out = [];
    let d = nextOccurrence(anchorStr, frequency, start);
    if (!d) return out;
    const stop = toDate(end);
    let guard = 0;
    while (d && d <= stop && guard < 500) {
      out.push(new Date(d));
      guard++;
      if (frequency === "One-time") break;
      const stepDays = { Weekly: 7, Fortnightly: 14 }[frequency];
      if (stepDays) { d = new Date(d); d.setDate(d.getDate() + stepDays); }
      else {
        const monthsStep = { Monthly: 1, Quarterly: 3, Yearly: 12 }[frequency] || 1;
        d = new Date(d); d.setMonth(d.getMonth() + monthsStep);
      }
    }
    return out;
  }

  /* ---------------- Safe to Spend ---------------- *
   * available now, minus obligations due before the next payday:
   * bills, planned savings contribution for the period, tuition
   * charges already due. This is an estimate, not a guarantee.
   */
  function safeToSpend({ balance, bills, payAnchor, payFrequency, plannedSavingsPerPeriod, tuitionDueBeforePayday }) {
    const today = toDate(new Date());
    const payday = nextOccurrence(payAnchor, payFrequency, today) || today;
    const dueBills = bills
      .filter(b => !b.paid)
      .map(b => ({ ...b, next: nextOccurrence(b.dueDate, b.frequency, today) }))
      .filter(b => b.next && b.next <= payday)
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);

    const obligations = dueBills + (Number(plannedSavingsPerPeriod) || 0) + (Number(tuitionDueBeforePayday) || 0);
    const amount = Math.max(balance - obligations, 0);
    return {
      amount,
      untilDate: payday,
      breakdown: { balance, dueBills, plannedSavingsPerPeriod: plannedSavingsPerPeriod || 0, tuitionDueBeforePayday: tuitionDueBeforePayday || 0 },
    };
  }

  /* ---------------- Cash-flow forecast ---------------- *
   * Projects balance forward using recurring bills + recurring payday
   * income, over a fixed horizon. Does not invent one-off events.
   */
  function forecast({ balance, bills, payAnchor, payFrequency, payAmount, days }) {
    const today = toDate(new Date());
    const end = new Date(today); end.setDate(end.getDate() + days);

    const events = [];
    bills.filter(b => !b.paid).forEach(b => {
      occurrencesBetween(b.dueDate, b.frequency, today, end).forEach(d => {
        events.push({ date: d, label: b.name, amount: -(Number(b.amount) || 0) });
      });
    });
    if (payAnchor && payAmount) {
      occurrencesBetween(payAnchor, payFrequency, today, end).forEach(d => {
        events.push({ date: d, label: "Payday", amount: Number(payAmount) || 0 });
      });
    }
    events.sort((a, b) => a.date - b.date);

    let running = balance;
    const timeline = [{ date: today, label: "Today", amount: 0, balance: running }];
    for (const ev of events) {
      running += ev.amount;
      timeline.push({ ...ev, balance: running });
    }
    return { timeline, projectedBalance: running };
  }

  /* ---------------- Savings interest (daily-balance method) ---------------- *
   * Walks each day of the current month, applying that day's balance
   * (from balanceHistory) to estimate interest, rather than assuming
   * the current balance applied for the whole month.
   */
  function balanceOnDate(balanceHistory, dateStr) {
    const target = toDate(dateStr);
    let best = null;
    for (const snap of balanceHistory || []) {
      const d = toDate(snap.date);
      if (d <= target && (!best || d > toDate(best.date))) best = snap;
    }
    return best ? best.balance : (balanceHistory && balanceHistory[0] ? balanceHistory[0].balance : 0);
  }

  function monthlyInterestEstimate(account, asOf = new Date()) {
    const rate = Number(account.interestRate) || 0;
    const today = toDate(asOf);
    const year = today.getFullYear(), month = today.getMonth();
    const totalDaysInMonth = daysInMonth(year, month);
    const monthStart = new Date(year, month, 1);

    if (rate <= 0) {
      return { accruedThisMonth: 0, projectedMonthEnd: 0, nextPostingDate: null, dailyRate: 0 };
    }
    const dailyRate = rate / 100 / 365;

    let accrued = 0;
    for (let day = 1; day <= today.getDate(); day++) {
      const d = new Date(year, month, day);
      const bal = balanceOnDate(account.balanceHistory, isoDate(d));
      accrued += bal * dailyRate;
    }

    let projected = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const d = new Date(year, month, day);
      // For future days we don't know the balance yet, so hold the
      // latest known balance flat — a reasonable, clearly-labelled estimate.
      const bal = day <= today.getDate()
        ? balanceOnDate(account.balanceHistory, isoDate(d))
        : balanceOnDate(account.balanceHistory, isoDate(today));
      projected += bal * dailyRate;
    }

    const nextPosting = new Date(year, month + 1, 0); // last day of this month
    return {
      accruedThisMonth: round2(accrued),
      projectedMonthEnd: round2(projected),
      nextPostingDate: nextPosting,
      dailyRate,
    };
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ---------------- Insights (rule-based, no data invention) ---------------- */
  function categoryBreakdown(transactions, start, end) {
    const rows = transactions.filter(t => {
      if (t.type !== "expense") return false;
      const d = toDate(t.date);
      return d >= toDate(start) && d <= toDate(end);
    });
    const total = rows.reduce((s, t) => s + t.amount, 0);
    const byCat = {};
    rows.forEach(t => {
      const cat = t.category || "Other";
      byCat[cat] = (byCat[cat] || 0) + t.amount;
    });
    const breakdown = Object.entries(byCat)
      .map(([category, amount]) => ({ category, amount, percent: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
    return { total, breakdown };
  }

  function buildInsights({ thisMonth, lastMonth, incomeThisMonth, savedThisMonth }) {
    const insights = [];
    if (thisMonth.breakdown.length > 0) {
      const top = thisMonth.breakdown[0];
      insights.push(`${top.category} is your largest spending category this month, at ${Math.round(top.percent)}% of spending.`);
    }
    if (lastMonth.total > 0 && thisMonth.breakdown.length > 0) {
      thisMonth.breakdown.slice(0, 3).forEach(cat => {
        const prior = lastMonth.breakdown.find(c => c.category === cat.category);
        if (prior) {
          const delta = cat.amount - prior.amount;
          if (Math.abs(delta) >= 1) {
            insights.push(`You ${delta < 0 ? "spent" : "spent"} ${fmtAbs(Math.abs(delta))} ${delta < 0 ? "less" : "more"} on ${cat.category} than last month.`);
          }
        }
      });
    }
    if (incomeThisMonth > 0) {
      const pct = Math.round((savedThisMonth / incomeThisMonth) * 100);
      if (pct > 0) insights.push(`You've saved ${pct}% of your recorded income this month.`);
    }
    return insights.slice(0, 4);
  }
  function fmtAbs(n) { return "$" + Math.round(n).toLocaleString(); }

  return {
    toDate, diffDays, isoDate, daysInMonth,
    currentBalance, tuitionSummary, nextOccurrence, occurrencesBetween,
    safeToSpend, forecast, balanceOnDate, monthlyInterestEstimate, round2,
    categoryBreakdown, buildInsights,
  };
})();
