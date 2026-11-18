// Saved strategies and their promotion ladder: draft → backtested → paper → live.
//  - backtested: set automatically by a backtest
//  - paper:      only if the last backtest passed the gate (10+ trades, drawdown under the limit, made money)
//  - live:       only the HUMAN can approve it, in the dashboard. There is no MCP tool for it, by design.
// Each strategy also gets readable strategy.md + risk.md files in data/strategies/<id>/.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataFile, DATA_DIR } from "./paths.js";
import { normalize, validate, toMarkdown } from "./strategy.js";
import { bars } from "./prices.js";
import { backtest } from "./backtest.js";
import { brakelineLimits, FUNDS } from "./brakeline.js";

// the per-position cap Brakeline will apply to this symbol, or null when Brakeline is not installed
const guardCap = (sym) => { if (process.env.BACKTRACK_IGNORE_BRAKELINE) return null; const g = brakelineLimits(); return g.found ? (FUNDS.has(sym) ? g.fund : g.stock) : null; };

const FILE = dataFile("strategies.json");
const load = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []; } catch { return []; } };
const save = (list) => writeFileSync(FILE, JSON.stringify(list, null, 2));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "strategy";

export const list = () => load().map(({ id, name, status, created, updated, lastBacktest }) => ({ id, name, status, created, updated, last: lastBacktest && { totalReturn: lastBacktest.metrics.totalReturn, maxDrawdown: lastBacktest.metrics.maxDrawdown, trades: lastBacktest.metrics.trades, canPromote: lastBacktest.verdict.canPromote } }));
export const get = (id) => { const s = load().find((x) => x.id === id); if (!s) throw new Error(`no strategy ${id}`); return s; };

export async function run(strategy, opts = {}) {
  const s = normalize(strategy), errs = validate(s);
  if (errs.length) throw new Error("invalid strategy: " + errs.join("; "));
  const b = await bars([...new Set([...s.symbols, "SPY"])]);
  const r = backtest(s, b, opts);
  const caps = s.symbols.map((x) => [x, guardCap(x)]).filter(([, c]) => c != null && s.risk.positionPct / 100 > c + 1e-9);
  if (caps.length) r.verdict.notes.unshift(`Brakeline caps a single position at ${caps.map(([x, c]) => `${(c * 100).toFixed(0)}% for ${x}`).join(", ")}, but this strategy sizes ${s.risk.positionPct}% per trade: live and paper orders would be cut down (or blocked), so real results would differ from this backtest. Lower positionPct, or raise the cap in Brakeline (human only).`);
  return { strategy: s, ...r };
}

export async function upsert(strategy, { text = "", id } = {}) {
  const r = await run(strategy), all = load(), now = new Date().toISOString();
  let rec = id && all.find((x) => x.id === id);
  if (!rec) {
    let base = slug(r.strategy.name), n = 1, nid = base;
    while (all.some((x) => x.id === nid)) nid = `${base}-${++n}`;
    rec = { id: nid, created: now, status: "draft" }; all.push(rec);
  }
  Object.assign(rec, { name: r.strategy.name, text: text || rec.text || "", strategy: r.strategy, updated: now,
    status: rec.status === "live" || rec.status === "paper" ? "backtested" : "backtested", // any change sends it back through the gate
    lastBacktest: { at: now, metrics: r.metrics, verdict: r.verdict } });
  const md = toMarkdown(r.strategy), dir = join(DATA_DIR, "strategies", rec.id);
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "strategy.md"), md.strategy); writeFileSync(join(dir, "risk.md"), md.risk);
  save(all);
  return { saved: rec.id, status: rec.status, files: [join(dir, "strategy.md"), join(dir, "risk.md")], ...r };
}

export function promoteToPaper(id) {
  const all = load(), rec = all.find((x) => x.id === id);
  if (!rec) throw new Error(`no strategy ${id}`);
  if (!rec.lastBacktest) throw new Error("run a backtest first");
  if (!rec.lastBacktest.verdict.canPromote) throw new Error("the last backtest did not pass the gate: " + rec.lastBacktest.verdict.fails.join("; "));
  rec.status = "paper"; rec.updated = new Date().toISOString(); save(all);
  return { id, status: "paper" };
}

// dashboard only (the human): approve a paper strategy for live, or send any strategy back to paper/draft
export function setStatusByHuman(id, status) {
  if (!["draft", "backtested", "paper", "live"].includes(status)) throw new Error("bad status");
  const all = load(), rec = all.find((x) => x.id === id);
  if (!rec) throw new Error(`no strategy ${id}`);
  if (status === "live" && rec.status !== "paper") throw new Error("only a paper strategy can be approved for live");
  rec.status = status; rec.updated = new Date().toISOString(); save(all);
  return { id, status };
}
export function remove(id) { save(load().filter((x) => x.id !== id)); return { removed: id }; }

// ── paper / live ledger ─────────────────────────────────────────────────────
// Backtrack never trades. The agent places orders (through Brakeline) and reports each fill with record_fill,
// so Backtrack knows what is open, since when, and at what price, and can tell when to sell.
import { entrySignal, rsiSeries, macdHist, sma } from "./backtest.js";
const ledgerOf = (rec) => (rec.ledger ||= { positions: {}, fills: [] });

export function recordFill(id, { symbol, side, qty, price, date }) {
  const all = load(), rec = all.find((x) => x.id === id);
  if (!rec) throw new Error(`no strategy ${id}`);
  if (!["paper", "live"].includes(rec.status)) throw new Error(`strategy is ${rec.status}: only paper or live strategies keep a ledger`);
  const sym = String(symbol).toUpperCase(), q = Number(qty), px = Number(price), d = date || new Date().toISOString().slice(0, 10);
  if (!(q > 0 && px > 0) || !["buy", "sell"].includes(side)) throw new Error("need side buy|sell, qty > 0, price > 0");
  if (!rec.strategy.symbols.includes(sym)) throw new Error(`${sym} is not in this strategy (${rec.strategy.symbols.join(", ")})`);
  const L = ledgerOf(rec), p = L.positions[sym];
  if (side === "buy") L.positions[sym] = p ? { qty: p.qty + q, entryPrice: (p.entryPrice * p.qty + px * q) / (p.qty + q), entryDate: p.entryDate } : { qty: q, entryPrice: px, entryDate: d };
  else {
    if (!p) throw new Error(`no open ${sym} position in this strategy`);
    const sold = Math.min(q, p.qty), pnl = Math.round(sold * (px - p.entryPrice) * 100) / 100;
    L.fills.push({ symbol: sym, entryDate: p.entryDate, entryPrice: p.entryPrice, exitDate: d, exitPrice: px, qty: sold, pnl, mode: rec.status });
    if (p.qty - sold <= 1e-9) delete L.positions[sym]; else p.qty -= sold;
  }
  rec.updated = new Date().toISOString(); save(all);
  return { id, positions: L.positions, closedTrades: L.fills.length, realizedPnl: Math.round(L.fills.reduce((a, f) => a + f.pnl, 0) * 100) / 100 };
}

export function paperStatus(id) {
  const rec = get(id), L = rec.ledger || { positions: {}, fills: [] };
  const wins = L.fills.filter((f) => f.pnl > 0).length;
  return { id, status: rec.status, open: L.positions, closed: L.fills.slice(-20), realizedPnl: Math.round(L.fills.reduce((a, f) => a + f.pnl, 0) * 100) / 100, trades: L.fills.length, winRate: L.fills.length ? wins / L.fills.length : null };
}

const indicators = (s, b) => {
  const c = b.map((k) => k.c), rsi = { 14: rsiSeries(c, 14) };
  for (const r of s.entry.all) if (r.type.startsWith("rsi") && !rsi[r.period || 14]) rsi[r.period || 14] = rsiSeries(c, r.period || 14);
  return { c, rsi, ctx: { macd: s.entry.all.some((r) => r.type === "macd_cross_up") ? macdHist(c) : null, vol: b.map((k) => k.v || 0) } };
};

// Entry signals at the latest daily close, for symbols the strategy does not already hold.
export async function signals(id, equity = 100_000) {
  const rec = get(id), s = rec.strategy;
  if (!["paper", "live"].includes(rec.status)) throw new Error(`strategy is ${rec.status}: promote it to paper first`);
  const b = await bars(s.symbols), held = (rec.ledger || {}).positions || {}, out = [];
  const openCount = Object.keys(held).length;
  for (const x of s.symbols) {
    const { c, rsi, ctx } = indicators(s, b[x]), i = c.length - 1;
    const ok = s.entry.all.every((r) => entrySignal(r, c, i, rsi, ctx));
    const px = c[i], cap = guardCap(x), pctUsed = cap != null ? Math.min(s.risk.positionPct / 100, cap * 0.995) : s.risk.positionPct / 100;
    const qty = Math.floor((equity * pctUsed / px) * 1e4) / 1e4;
    const row = { symbol: x, date: b[x][i].d, close: px, signal: ok };
    if (ok && cap != null && s.risk.positionPct / 100 > cap) row.sizing = `cut from ${s.risk.positionPct}% to ${(pctUsed * 100).toFixed(1)}% of equity to fit Brakeline's ${(cap * 100).toFixed(0)}% cap`;
    if (held[x]) row.note = "already held: see check_exits";
    else if (ok && openCount >= s.risk.maxPositions) row.note = `signal, but ${openCount} positions are open (max ${s.risk.maxPositions})`;
    else if (ok) row.suggested = { side: "buy", qty, notional: Math.round(qty * px * 100) / 100, takeProfit: s.exit.takeProfitPct != null ? +(px * (1 + s.exit.takeProfitPct / 100)).toFixed(2) : null, stopLoss: s.exit.stopLossPct != null ? +(px * (1 - s.exit.stopLossPct / 100)).toFixed(2) : null };
    out.push(row);
  }
  return { id, status: rec.status, mode: rec.status === "live" ? "live (human-approved): place through Brakeline" : "paper: place on the simulated account only", signals: out, next: "after a fill, call record_fill so the strategy can manage the exit" };
}

// For every open position in the ledger: should it be sold now? Same rules as the backtest, on daily bars
// since the entry date (take profit / stop loss vs the highs and lows, max hold in trading days, RSI / average exits).
export async function checkExits(id) {
  const rec = get(id), s = rec.strategy, X = s.exit, pos = (rec.ledger || {}).positions || {};
  const syms = Object.keys(pos);
  if (!syms.length) return { id, open: 0, exits: [], note: "no open positions recorded for this strategy" };
  const b = await bars(syms), out = [];
  for (const x of syms) {
    const p = pos[x], series = b[x], since = series.filter((k) => k.d > p.entryDate), last = series.at(-1), i = series.length - 1;
    const c = series.map((k) => k.c), why = [];
    const tp = X.takeProfitPct != null ? p.entryPrice * (1 + X.takeProfitPct / 100) : null, sl = X.stopLossPct != null ? p.entryPrice * (1 - X.stopLossPct / 100) : null;
    if (sl != null && since.some((k) => k.l <= sl)) why.push(`stop loss ${sl.toFixed(2)} was touched`);
    else if (tp != null && since.some((k) => k.h >= tp)) why.push(`take profit ${tp.toFixed(2)} was reached`);
    if (X.maxHoldDays != null && since.length >= X.maxHoldDays) why.push(`held ${since.length} trading days (max ${X.maxHoldDays})`);
    if (X.rsiAbove != null) { const r = rsiSeries(c, 14)[i]; if (r > X.rsiAbove) why.push(`RSI ${r.toFixed(0)} above ${X.rsiAbove}`); }
    if (X.smaCrossDown) { const f0 = sma(c, X.smaCrossDown.fast, i - 1), s0 = sma(c, X.smaCrossDown.slow, i - 1), f1 = sma(c, X.smaCrossDown.fast, i), s1 = sma(c, X.smaCrossDown.slow, i); if (f0 >= s0 && f1 < s1) why.push("average crossed down"); }
    out.push({ symbol: x, qty: p.qty, entryDate: p.entryDate, entryPrice: +p.entryPrice.toFixed(4), last: last.c, lastDate: last.d, change: +((last.c / p.entryPrice - 1) * 100).toFixed(2) + "%", heldDays: since.length,
      sell: why.length > 0, reasons: why, ...(why.length ? { suggested: { side: "sell", qty: p.qty } } : { keepUntil: [tp != null && `take profit ${tp.toFixed(2)}`, sl != null && `stop ${sl.toFixed(2)}`, X.maxHoldDays != null && `${X.maxHoldDays - since.length} more trading days`].filter(Boolean).join(" · ") }) });
  }
  return { id, status: rec.status, exits: out, next: "sell through Brakeline (selling is always allowed there), then record_fill with side sell" };
}
