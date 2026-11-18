// Rehearse MCP server (stdio): turn a strategy written in plain words into rules, backtest it on real prices,
// and walk it up draft → backtested → paper. Going live needs the human's click in the dashboard.
// Rehearse never sends an order: signals are placed by the agent through Brakeline.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { parse, ENTRY_TYPES } from "./strategy.js";
import * as store from "./store.js";

const obj = (properties = {}, required = []) => ({ type: "object", properties, required });
const STRATEGY = { type: "object", description: `Strategy JSON: { name, symbols: ["NVDA"], entry: { all: [rules] }, exit: { takeProfitPct, stopLossPct, maxHoldDays, rsiAbove }, risk: { positionPct, maxPositions, maxDrawdownPct } }. Entry rule types: ${ENTRY_TYPES.join(", ")} — drop/rise {pct, days}, rsi_below/rsi_above {value, period}, above_sma/below_sma {days}, sma_cross_up {fast, slow}, macd_cross_up {}, volume_spike {mult, days}.` };
const pct = (x) => (x == null ? null : `${(x * 100).toFixed(1)}%`);
const summary = (r) => ({
  strategy: r.strategy,
  result: { period: `${r.metrics.from} → ${r.metrics.to}`, totalReturn: pct(r.metrics.totalReturn), cagr: pct(r.metrics.cagr), maxDrawdown: pct(r.metrics.maxDrawdown), trades: r.metrics.trades, winRate: pct(r.metrics.winRate), profitFactor: r.metrics.profitFactor, avgDaysHeld: r.metrics.avgDaysHeld,
    buyAndHold: r.metrics.buyHold && `${pct(r.metrics.buyHold.ret)} (worst drop ${pct(r.metrics.buyHold.maxDrawdown)})`, spy: r.metrics.spy && `${pct(r.metrics.spy.ret)} (worst drop ${pct(r.metrics.spy.maxDrawdown)})` },
  verdict: r.verdict, lastTrades: r.trades.slice(-5),
  ...(r.saved ? { saved: r.saved, status: r.status, files: r.files } : {}),
});

const TOOLS = [
  { name: "parse_strategy", description: "Turn a strategy written in plain English or Indonesian into strategy JSON. Returns `unparsed` for anything it could not read: fix those (or build the JSON yourself) before backtesting. Show the parsed rules to the human.", inputSchema: obj({ text: { type: "string" } }, ["text"]), run: async (a) => parse(a.text) },
  { name: "backtest_strategy", description: "Backtest a strategy on ~3 years of real daily prices (Yahoo Finance). Signals at the close, fills at the next open, 5 bps slippage. Returns return, drawdown, win rate, trades, comparison with buy & hold and SPY, and a verdict with the promotion gate. Pass `strategy` JSON, or `text` to parse first. Does not save.", inputSchema: obj({ strategy: STRATEGY, text: { type: "string" } }), run: async (a) => {
    let s = a.strategy, warn;
    if (!s && a.text) { const p = parse(a.text); s = p.strategy; warn = p.unparsed; }
    const r = summary(await store.run(s)); return warn?.length ? { ...r, unparsed: warn } : r;
  } },
  { name: "save_strategy", description: "Backtest and save a strategy (status becomes 'backtested'). Writes strategy.md and risk.md the human can read. Pass `id` to update an existing one (it goes back through the gate).", inputSchema: obj({ strategy: STRATEGY, text: { type: "string", description: "the original plain-words description" }, id: { type: "string" } }, ["strategy"]), run: async (a) => summary(await store.upsert(a.strategy, { text: a.text, id: a.id })) },
  { name: "list_strategies", description: "Saved strategies with their status (draft / backtested / paper / live) and last backtest.", inputSchema: obj(), run: async () => store.list() },
  { name: "get_strategy", description: "One saved strategy: rules, original text, status and last backtest.", inputSchema: obj({ id: { type: "string" } }, ["id"]), run: async (a) => store.get(a.id) },
  { name: "promote_to_paper", description: "Move a backtested strategy to paper trading. Refused unless its last backtest passed the gate. Going LIVE is not possible from here: only the human can approve that in the dashboard.", inputSchema: obj({ id: { type: "string" } }, ["id"]), run: async (a) => store.promoteToPaper(a.id) },
  { name: "todays_signals", description: "For a paper or live strategy: which symbols have an entry signal at the latest close (skipping ones already held), with a suggested size, take-profit and stop-loss price. Rehearse does not trade: place orders through Brakeline (paper strategies: simulated account only), then call record_fill.", inputSchema: obj({ id: { type: "string" }, equity: { type: "number", description: "account equity for sizing, default 100000" } }, ["id"]), run: async (a) => store.signals(a.id, a.equity) },
  { name: "record_fill", description: "Tell Rehearse about a filled order for a paper or live strategy, so it can track the position and manage the exit. Use the real fill price from the broker / Brakeline.", inputSchema: obj({ id: { type: "string" }, symbol: { type: "string" }, side: { type: "string", enum: ["buy", "sell"] }, qty: { type: "number" }, price: { type: "number" }, date: { type: "string", description: "YYYY-MM-DD, default today" } }, ["id", "symbol", "side", "qty", "price"]), run: async (a) => store.recordFill(a.id, a) },
  { name: "check_exits", description: "For every open position of a paper or live strategy: should it be sold now? Checks take profit / stop loss against the highs and lows since entry, max hold days and RSI / average exits — the same rules as the backtest. Sell through Brakeline, then record_fill.", inputSchema: obj({ id: { type: "string" } }, ["id"]), run: async (a) => store.checkExits(a.id) },
  { name: "paper_status", description: "Open positions, closed trades, realized P&L and win rate of a paper or live strategy so far — to compare with its backtest before asking the human to approve live.", inputSchema: obj({ id: { type: "string" } }, ["id"]), run: async (a) => store.paperStatus(a.id) },
];

export async function startMcp() {
  const server = new Server({ name: "rehearse", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args = {} } }) => {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}` }] };
    try { return { content: [{ type: "text", text: JSON.stringify(await t.run(args), null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: "text", text: String(e.message ?? e) }] }; }
  });
  await server.connect(new StdioServerTransport());
}
