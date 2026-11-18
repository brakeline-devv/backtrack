import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, normalize, validate } from "../src/strategy.js";
import { backtest, rsiSeries } from "../src/backtest.js";

// synthetic bars: a slow uptrend with a sharp 6% dip every 20 days
const mk = (n = 300, dip = true) => {
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    const o = p; p = dip && i % 20 === 10 ? p * 0.94 : p * 1.003;
    out.push({ d, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p });
  }
  return out;
};

test("parses English and Indonesian into the same rules", () => {
  const en = parse("Buy NVDA when it drops 5% in a week. Sell at +8% take profit or a 4% stop loss. 20% of equity per trade.").strategy;
  assert.deepEqual(en.entry.all, [{ type: "drop", pct: 5, days: 5 }]);
  assert.equal(en.exit.takeProfitPct, 8); assert.equal(en.exit.stopLossPct, 4); assert.equal(en.risk.positionPct, 20);
  const id = parse("Beli NVDA kalau turun 5% dalam seminggu, jual kalau naik 8% atau rugi 4%").strategy;
  assert.equal(id.exit.takeProfitPct, 8); assert.equal(id.exit.stopLossPct, 4); assert.equal(id.entry.all[0].type, "drop");
});

test("a sell clause is never read as an entry rule", () => {
  const s = parse("Buy SPY when the 50 day MA crosses above the 200, sell if down 8%").strategy;
  assert.deepEqual(s.entry.all.map((r) => r.type), ["sma_cross_up"]);
  assert.equal(s.exit.stopLossPct, 8);
});

test("vague text is reported, not guessed", () => {
  const p = parse("buy pltr when it looks good");
  assert.ok(p.unparsed.some((u) => /no entry rule/.test(u)));
  assert.ok(validate(normalize(p.strategy)).length > 0);
});

test("entries fill at the NEXT open (no look-ahead)", () => {
  const b = { X: mk(), SPY: mk(300, false) };
  const s = normalize({ name: "t", symbols: ["X"], entry: { all: [{ type: "drop", pct: 5, days: 1 }] }, exit: { maxHoldDays: 3 }, risk: { positionPct: 50 } });
  const r = backtest(s, b, { slipBps: 0 });
  assert.ok(r.trades.length > 5);
  for (const t of r.trades) {
    const i = b.X.findIndex((x) => x.d === t.entryDate);
    assert.ok(b.X[i - 1].c <= b.X[i - 2].c * 0.95, "signal on the previous close");
    assert.equal(t.entry, Math.round(b.X[i].o * 1e4) / 1e4, "filled at the open of the next day");
  }
});

test("stop loss is assumed to hit first when both levels are touched", () => {
  const bars = mk(120, false); const i = 80;
  bars[i - 1] = { ...bars[i - 1], c: bars[i - 2].c * 0.9 };                 // signal
  const e = bars[i].o; bars[i + 1] = { ...bars[i + 1], o: e, h: e * 1.2, l: e * 0.8, c: e };  // both touched next day
  const s = normalize({ name: "t", symbols: ["X"], entry: { all: [{ type: "drop", pct: 5, days: 1 }] }, exit: { takeProfitPct: 10, stopLossPct: 10 }, risk: { positionPct: 50 } });
  const r = backtest(s, { X: bars, SPY: mk(120, false) }, { slipBps: 0 });
  const t = r.trades.find((x) => x.entryDate === bars[i].d);
  assert.equal(t.why, "stop loss");
});

test("the promotion gate refuses too few trades or a deep drawdown", () => {
  const s = normalize({ name: "t", symbols: ["X"], entry: { all: [{ type: "sma_cross_up", fast: 50, slow: 200 }] }, exit: { stopLossPct: 50 }, risk: {} });
  const r = backtest(s, { X: mk(), SPY: mk(300, false) });
  assert.equal(r.verdict.canPromote, false);
  assert.ok(r.verdict.fails.some((f) => /too few/.test(f)));
});

test("RSI stays within 0-100", () => {
  const v = rsiSeries(mk().map((b) => b.c)).filter((x) => x != null);
  assert.ok(v.every((x) => x >= 0 && x <= 100));
});

test("parses MACD and volume rules", () => {
  const s = parse("Buy AMD when MACD crosses above the signal and volume is 2x the 20 day average, take profit 10%, stop loss 5%").strategy;
  assert.deepEqual(s.entry.all.map((r) => r.type).sort(), ["macd_cross_up", "volume_spike"]);
  assert.equal(s.entry.all.find((r) => r.type === "volume_spike").mult, 2);
});

test("volume spike fires only on a real spike", async () => {
  const { entrySignal } = await import("../src/backtest.js");
  const vol = new Array(30).fill(100); vol[29] = 250;
  assert.equal(entrySignal({ type: "volume_spike", mult: 2, days: 20 }, new Array(30).fill(1), 29, {}, { vol }), true);
  assert.equal(entrySignal({ type: "volume_spike", mult: 3, days: 20 }, new Array(30).fill(1), 29, {}, { vol }), false);
});

test("parser reads shorthand exits: N% target, max N days, 8% / 4%, sell at +N%, N-day average", () => {
  const a = parse("Buy XLE when RSI is below 30. 5% target, 5% stop, max 20 days.").strategy.exit;
  assert.deepEqual([a.takeProfitPct, a.stopLossPct, a.maxHoldDays], [5, 5, 20]);
  const b = parse("Buy QQQ when it drops 3% in 2 days and above the 200-day average. 4% / 4%.");
  assert.deepEqual([b.strategy.exit.takeProfitPct, b.strategy.exit.stopLossPct], [4, 4]);
  assert.ok(b.strategy.entry.all.some((e) => e.type === "above_sma" && e.days === 200));
  assert.equal(parse("Buy NVDA when it drops 5% in a week. Sell at +8%.").strategy.exit.takeProfitPct, 8);
  const c = parse("Buy SPY when the 50-day average crosses above the 200-day, stop at 8%.");
  assert.deepEqual(c.strategy.entry.all[0], { type: "sma_cross_up", fast: 50, slow: 200 });
  assert.equal(c.unparsed.length, 0);
});
