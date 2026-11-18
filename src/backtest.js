// Daily-bar backtester. Honest by construction:
//  - signals use data up to the close of day t; entries fill at the OPEN of day t+1 (no look-ahead)
//  - stop loss / take profit are checked against the day's low/high; if both are touched the same day,
//    the stop is assumed to hit first; a gap through the level fills at the open
//  - slippage on every fill (default 5 bps), shared cash, position size as % of current equity
//  - benchmark: buy & hold SPY and an equal-weight buy & hold of the strategy's own symbols
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;

export function sma(c, n, i) { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += c[k]; return s / n; }
export function rsiSeries(c, n = 14) {
  const out = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}

export function emaSeries(c, n) { const k = 2 / (n + 1), out = new Array(c.length).fill(null); let e = null; for (let i = 0; i < c.length; i++) { e = e == null ? c[i] : c[i] * k + e * (1 - k); if (i >= n - 1) out[i] = e; } return out; }
// MACD line minus signal line (12/26/9); a cross up is the histogram turning positive
export function macdHist(c) { const f = emaSeries(c, 12), s = emaSeries(c, 26), line = c.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const start = line.findIndex((x) => x != null), sig = new Array(c.length).fill(null); const k = 2 / 10; let e = null;
  for (let i = start; i < c.length; i++) { e = e == null ? line[i] : line[i] * k + e * (1 - k); if (i >= start + 8) sig[i] = e; }
  return line.map((x, i) => (x != null && sig[i] != null ? x - sig[i] : null)); }

export function entrySignal(rule, c, i, rsi, ctx = {}) {
  switch (rule.type) {
    case "drop": return i >= rule.days && c[i] <= c[i - rule.days] * (1 - rule.pct / 100);
    case "rise": return i >= rule.days && c[i] >= c[i - rule.days] * (1 + rule.pct / 100);
    case "rsi_below": return rsi[rule.period || 14]?.[i] != null && rsi[rule.period || 14][i] < rule.value;
    case "rsi_above": return rsi[rule.period || 14]?.[i] != null && rsi[rule.period || 14][i] > rule.value;
    case "above_sma": { const m = sma(c, rule.days, i); return m != null && c[i] > m; }
    case "below_sma": { const m = sma(c, rule.days, i); return m != null && c[i] < m; }
    case "sma_cross_up": { const f0 = sma(c, rule.fast, i - 1), s0 = sma(c, rule.slow, i - 1), f1 = sma(c, rule.fast, i), s1 = sma(c, rule.slow, i); return [f0, s0, f1, s1].every((v) => v != null) && f0 <= s0 && f1 > s1; }
    case "macd_cross_up": { const h = ctx.macd; return h && h[i - 1] != null && h[i] != null && h[i - 1] <= 0 && h[i] > 0; }
    case "volume_spike": { const v = ctx.vol, n = rule.days || 20; if (!v || i < n) return false; let s = 0; for (let k = i - n; k < i; k++) s += v[k]; return s > 0 && v[i] >= (s / n) * (rule.mult || 2); }
    default: return false;
  }
}

/**
 * @param s strategy (normalized)
 * @param bars { SYM: [{d,o,h,l,c}] } — must include SPY for the benchmark
 */
export function backtest(s, bars, { startCash = 100_000, slipBps = 5, from, to } = {}) {
  const syms = s.symbols.filter((x) => bars[x]);
  if (!syms.length) throw new Error("no price data for the strategy's symbols");
  // calendar: dates where every strategy symbol has a bar (stocks skip weekends; crypto doesn't)
  const sets = syms.map((x) => new Set(bars[x].map((b) => b.d)));
  let days = bars[syms[0]].map((b) => b.d).filter((d) => sets.every((st) => st.has(d)));
  if (from) days = days.filter((d) => d >= from); if (to) days = days.filter((d) => d <= to);
  if (days.length < 60) throw new Error("not enough overlapping history");
  const idx = Object.fromEntries(syms.map((x) => [x, new Map(bars[x].map((b, i) => [b.d, i]))]));
  const closes = Object.fromEntries(syms.map((x) => [x, bars[x].map((b) => b.c)]));
  const periods = [...new Set([14, ...s.entry.all.filter((r) => r.type.startsWith("rsi")).map((r) => r.period || 14)])];
  const rsi = Object.fromEntries(syms.map((x) => [x, Object.fromEntries(periods.map((p) => [p, rsiSeries(closes[x], p)]))]));
  const ctx = Object.fromEntries(syms.map((x) => [x, { macd: s.entry.all.some((r) => r.type === "macd_cross_up") ? macdHist(closes[x]) : null, vol: bars[x].map((b) => b.v || 0) }]));
  const slip = slipBps / 1e4, X = s.exit, R = s.risk;

  let cash = startCash; const open = {}, trades = [], curve = [], pending = [];
  const equity = (d) => cash + Object.entries(open).reduce((a, [x, p]) => a + p.qty * bars[x][idx[x].get(d)].c, 0);
  const closePos = (x, d, px, why) => {
    const p = open[x], fill = px * (1 - slip);
    cash += p.qty * fill;
    trades.push({ symbol: x, entryDate: p.d, entry: r4(p.px), exitDate: d, exit: r4(fill), qty: p.qty, pnl: r2(p.qty * (fill - p.px)), ret: r4(fill / p.px - 1), days: p.held, why });
    delete open[x];
  };

  for (let k = 0; k < days.length; k++) {
    const d = days[k];
    // 1. fill yesterday's entry signals at today's open
    for (const x of pending.splice(0)) {
      if (open[x] || Object.keys(open).length >= R.maxPositions) continue;
      const b = bars[x][idx[x].get(d)], px = b.o * (1 + slip);
      const budget = Math.min(cash, equity(d) * (R.positionPct / 100));
      const qty = Math.floor((budget / px) * 1e4) / 1e4; // fractional shares, like Robinhood
      if (qty * px < 1) continue;
      cash -= qty * px; open[x] = { d, px, qty, held: 0 };
    }
    // 2. exits during today's bar
    for (const x of Object.keys(open)) {
      const p = open[x], b = bars[x][idx[x].get(d)], i = idx[x].get(d); p.held++;
      const sl = X.stopLossPct != null ? p.px * (1 - X.stopLossPct / 100) : null, tp = X.takeProfitPct != null ? p.px * (1 + X.takeProfitPct / 100) : null;
      if (sl != null && b.l <= sl) { closePos(x, d, Math.min(sl, b.o), "stop loss"); continue; }
      if (tp != null && b.h >= tp) { closePos(x, d, Math.max(tp, b.o), "take profit"); continue; }
      if (X.rsiAbove != null && rsi[x][14][i] != null && rsi[x][14][i] > X.rsiAbove) { closePos(x, d, b.c, "RSI exit"); continue; }
      if (X.smaCrossDown) { const c = closes[x], f0 = sma(c, X.smaCrossDown.fast, i - 1), s0 = sma(c, X.smaCrossDown.slow, i - 1), f1 = sma(c, X.smaCrossDown.fast, i), s1 = sma(c, X.smaCrossDown.slow, i);
        if ([f0, s0, f1, s1].every((v) => v != null) && f0 >= s0 && f1 < s1) { closePos(x, d, b.c, "average cross down"); continue; } }
      if (X.maxHoldDays != null && p.held >= X.maxHoldDays) closePos(x, d, b.c, "max hold");
    }
    // 3. today's close: entry signals for tomorrow
    if (k < days.length - 1) for (const x of syms) {
      const i = idx[x].get(d);
      if (!open[x] && s.entry.all.every((r) => entrySignal(r, closes[x], i, rsi[x], ctx[x]))) pending.push(x);
    }
    curve.push({ d, v: r2(equity(d)) });
  }
  const last = days.at(-1), stillOpen = Object.keys(open).map((x) => ({ symbol: x, since: open[x].d, entry: r4(open[x].px), last: bars[x][idx[x].get(last)].c }));
  for (const x of Object.keys(open)) closePos(x, last, bars[x][idx[x].get(last)].c, "end of test");

  // metrics
  const end = curve.at(-1).v, years = (Date.parse(last) - Date.parse(days[0])) / (365.25 * 864e5);
  const dd = (vals) => { let pk = vals[0], m = 0; for (const v of vals) { pk = Math.max(pk, v); m = Math.max(m, 1 - v / pk); } return m; };
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const gross = (a) => a.reduce((s, t) => s + t.pnl, 0);
  const inMarket = curve.length ? days.filter((d, i) => i > 0).length : 0;
  const bh = (list) => { // equal-weight buy & hold from the first open
    const legs = list.filter((x) => bars[x]).map((x) => { const m = new Map(bars[x].map((b) => [b.d, b])); const b0 = m.get(days[0]); return b0 ? { m, q: startCash / list.length / b0.o } : null; }).filter(Boolean);
    if (!legs.length) return null;
    const vals = days.map((d) => legs.reduce((a, l) => a + l.q * (l.m.get(d)?.c ?? 0), 0)).filter((v) => v > 0);
    return { ret: r4(vals.at(-1) / startCash - 1), maxDrawdown: r4(dd(vals)), curve: days.map((d, i) => ({ d, v: r2(vals[i] ?? vals.at(-1)) })) };
  };
  const spy = bh(["SPY"]), hold = bh(syms);
  const m = {
    from: days[0], to: last, years: r2(years), startCash, end: r2(end),
    totalReturn: r4(end / startCash - 1), cagr: years > 0 ? r4(Math.pow(end / startCash, 1 / years) - 1) : null,
    maxDrawdown: r4(dd(curve.map((c) => c.v))), trades: trades.length, winRate: trades.length ? r4(wins.length / trades.length) : null,
    avgWin: wins.length ? r4(wins.reduce((a, t) => a + t.ret, 0) / wins.length) : null, avgLoss: losses.length ? r4(losses.reduce((a, t) => a + t.ret, 0) / losses.length) : null,
    profitFactor: losses.length && gross(losses) !== 0 ? r2(gross(wins) / -gross(losses)) : null,
    avgDaysHeld: trades.length ? r2(trades.reduce((a, t) => a + t.days, 0) / trades.length) : null,
    exposure: r4(trades.reduce((a, t) => a + t.days, 0) / Math.max(1, inMarket * Math.max(1, Math.min(R.maxPositions, syms.length)))),
    buyHold: hold && { ret: hold.ret, maxDrawdown: hold.maxDrawdown }, spy: spy && { ret: spy.ret, maxDrawdown: spy.maxDrawdown },
  };
  return { metrics: m, trades, openAtEnd: stillOpen, curve, benchmark: { spy: spy?.curve, hold: hold?.curve }, verdict: verdict(m, R), slipBps };
}

// plain-words verdict + the promotion gate
export function verdict(m, R) {
  const notes = [], fails = [];
  if (m.trades < 10) fails.push(`only ${m.trades} trades: too few to tell skill from luck (need 10+)`);
  if (m.maxDrawdown * 100 > R.maxDrawdownPct) fails.push(`max drawdown ${(m.maxDrawdown * 100).toFixed(1)}% is above the ${R.maxDrawdownPct}% limit`);
  if (m.totalReturn <= 0) fails.push(`lost money over the test (${(m.totalReturn * 100).toFixed(1)}%)`);
  // return per unit of worst drop must beat simply holding the same symbols
  const eff = (ret, dd) => ret / Math.max(dd, 0.01);
  if (m.buyHold && m.totalReturn > 0 && eff(m.totalReturn, m.maxDrawdown) < eff(m.buyHold.ret, m.buyHold.maxDrawdown))
    fails.push(`worse return per unit of risk than simply holding (${eff(m.totalReturn, m.maxDrawdown).toFixed(2)} vs ${eff(m.buyHold.ret, m.buyHold.maxDrawdown).toFixed(2)}: return ÷ worst drop)`);
  const used = Math.min(100, R.positionPct * R.maxPositions);
  if (used < 100) notes.push(`it puts at most ${used}% of the account to work (${R.positionPct}% per trade × ${R.maxPositions}); buy & hold uses 100%, so compare return per unit of risk, not raw return`);
  if (m.buyHold && m.totalReturn < m.buyHold.ret) notes.push(`simply holding ${m.buyHold.ret >= 0 ? "made" : "lost"} ${(m.buyHold.ret * 100).toFixed(1)}%, vs ${(m.totalReturn * 100).toFixed(1)}% for the strategy`);
  if (m.spy && m.totalReturn < m.spy.ret) notes.push(`it trailed the S&P 500 (SPY ${(m.spy.ret * 100).toFixed(1)}%)`);
  if (m.buyHold && m.maxDrawdown < m.buyHold.maxDrawdown) notes.push(`it cut the worst drop from ${(m.buyHold.maxDrawdown * 100).toFixed(1)}% to ${(m.maxDrawdown * 100).toFixed(1)}%`);
  return { canPromote: fails.length === 0, fails, notes, disclaimer: "Past results do not predict future returns. Daily bars, next-open fills, slippage included; no taxes or dividends." };
}
