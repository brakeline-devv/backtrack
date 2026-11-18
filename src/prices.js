// Daily OHLC bars for the last 3 years from Yahoo Finance, cached once per day in data/bars.json.
// No synthetic fallback: a backtest on made-up prices would be misleading, so an unknown ticker is an error.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dataFile } from "./paths.js";

const FILE = dataFile("bars.json");
const CRYPTO = new Set(["BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX", "LINK"]);
const today = () => new Date().toISOString().slice(0, 10);
const load = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}; } catch { return {}; } };
export const yahooSymbol = (s) => (CRYPTO.has(s) ? `${s}-USD` : s);

async function fetchYahoo(sym, range, timeoutMs) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(sym))}?range=${range}&interval=1d`,
    { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0" } });
  const res = (await r.json())?.chart?.result?.[0];
  const ts = res?.timestamp, q = res?.indicators?.quote?.[0];
  if (!ts?.length || !q?.close) throw new Error(`no price data for ${sym}`);
  const bars = [];
  ts.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume?.[i] ?? 0;
    if (c > 0 && o > 0 && h > 0 && l > 0) bars.push({ d: new Date(t * 1000).toISOString().slice(0, 10), o: +o.toFixed(4), h: +h.toFixed(4), l: +l.toFixed(4), c: +c.toFixed(4), v: v || 0 });
  });
  if (bars.length < 60) throw new Error(`not enough history for ${sym} (${bars.length} days)`);
  return bars;
}

/** @returns {Promise<Record<string, {d,o,h,l,c}[]>>} */
export async function bars(symbols, { range = "3y", timeoutMs = 8000 } = {}) {
  const cache = load(), out = {}, day = today(), errors = [];
  await Promise.all(symbols.map(async (s) => {
    const key = `${s}:${range}:v2`;
    if (cache[key]?.fetched === day) { out[s] = cache[key].bars; return; }
    try { out[s] = await fetchYahoo(s, range, timeoutMs); cache[key] = { fetched: day, bars: out[s] }; }
    catch (e) { if (cache[key]) out[s] = cache[key].bars; else errors.push(e.message); }
  }));
  try { writeFileSync(FILE, JSON.stringify(cache)); } catch { /* read-only disk */ }
  if (errors.length) throw new Error(errors.join("; "));
  return out;
}
