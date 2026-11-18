// A strategy is plain JSON the human can read and audit (rendered as strategy.md + risk.md).
//
// {
//   name, symbols: ["NVDA"],
//   entry: { all: [ { type: "drop", pct: 5, days: 5 } | { type: "rise", pct, days } | { type: "rsi_below", value, period }
//                   | { type: "rsi_above", value, period } | { type: "above_sma", days } | { type: "below_sma", days }
//                   | { type: "sma_cross_up", fast, slow } ] },
//   exit:  { takeProfitPct, stopLossPct, maxHoldDays, rsiAbove, smaCrossDown: { fast, slow } },
//   risk:  { positionPct: 10, maxPositions: 3, maxDrawdownPct: 20 },
// }
//
// parse(text) turns everyday English or Indonesian into that JSON (best effort). Anything it could not read
// is listed in `unparsed`, so the agent or the human can fix it before trusting a backtest.

export const ENTRY_TYPES = ["drop", "rise", "rsi_below", "rsi_above", "above_sma", "below_sma", "sma_cross_up", "macd_cross_up", "volume_spike"];
export const DEFAULT_RISK = { positionPct: 10, maxPositions: 3, maxDrawdownPct: 20 };

const STOP = new Set(["RSI", "SMA", "MA", "EMA", "MACD", "AVG", "VOL", "AND", "OR", "THE", "IF", "WHEN", "BUY", "SELL", "USD", "ETF", "DAY", "DAYS", "TP", "SL", "I", "A", "OF", "MY", "IN", "AT", "TO", "ON", "UP", "IT", "X", "N", "KALAU", "JIKA", "BELI", "JUAL", "NAIK", "TURUN", "RUGI", "HARI", "MINGGU", "BULAN", "DAN", "ATAU", "YANG"]);
const num = (s) => Number(String(s).replace(",", "."));
const toDays = (n, unit) => (/week|minggu|pekan/i.test(unit || "") ? n * 5 : /month|bulan/i.test(unit || "") ? n * 21 : n);

const EXIT_WORDS = /\b(sell|exit|close|take\s*profit|tp|target|stop|sl|cut|hold|keep|jual|tahan|rugi|untung|profit|loss)\b|\b(?:max(?:imum)?|maks(?:imal)?)\s*\d+\s*(?:trading\s*)?(?:days?|d|weeks?|hari|minggu)\b/i;
const N = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = "(day|days|d|week|weeks|month|months|hari|minggu|pekan|bulan)";

export function parse(text) {
  const raw = String(text || "");
  const out = { name: "", symbols: [], entry: { all: [] }, exit: {}, risk: { ...DEFAULT_RISK } };
  const unparsed = [];

  // tickers anywhere: $NVDA or bare upper-case words of 1-5 letters
  for (const m of raw.matchAll(/\$?\b([A-Z]{1,5})\b/g)) if (!STOP.has(m[1]) && !out.symbols.includes(m[1])) out.symbols.push(m[1]);

  // split into clauses; a clause with a sell/stop/hold word holds exit rules, the rest hold entry rules
  const clauses = raw.split(/[.;\n,]+|\s+(?:then|lalu|kemudian)\s+/i).map((c) => c.trim()).filter(Boolean);
  for (const c of clauses) {
    let hit = false, m;
    const any = (re, f) => { const r = new RegExp(re, "i").exec(c); if (r) { hit = true; f(r); } };
    // risk (can sit in either kind of clause)
    any(String.raw`${N}\s*%\s*(?:of\s*(?:the\s*)?(?:account|equity|portfolio|capital)|per\s*(?:trade|position)|dari\s*(?:modal|akun|portofolio)|per\s*(?:posisi|trade))`, (r) => (out.risk.positionPct = num(r[1])));
    any(String.raw`(?:max(?:imum)?|at most|maks(?:imal)?|paling banyak)\s*(\d+)\s*(?:open\s*)?(?:positions?|posisi)`, (r) => (out.risk.maxPositions = num(r[1])));

    // shorthand "8% / 4%" = take profit / stop loss
    const tpsl = new RegExp(String.raw`^\+?${N}\s*%\s*/\s*-?${N}\s*%$`).exec(c);
    if (tpsl) { out.exit.takeProfitPct = num(tpsl[1]); out.exit.stopLossPct = num(tpsl[2]); continue; }
    if (EXIT_WORDS.test(c)) {
      any(String.raw`(?:take\s*profit|tp|profit|target|untung|up|naik|gains?|rises?|sell\s*at|jual\s*di)\s*(?:at|of|di|sebesar|by)?\s*\+${N}\s*%|(?:take\s*profit|tp|profit|target|untung|up|naik|gains?|rises?)\s*(?:at|of|di|sebesar|by)?\s*\+?${N}\s*%|\+?${N}\s*%\s*(?:take\s*profit|tp|profit|target|gain|untung)`, (r) => (out.exit.takeProfitPct = num(r[1] ?? r[2] ?? r[3])));
      any(String.raw`(?:stop\s*(?:loss|out)?|sl|cut(?:\s*loss)?|loss(?:\s*of)?|loses?|down|falls?|drops?|rugi|turun)\s*(?:at|of|di|sebesar|by)?\s*-?${N}\s*%|-?${N}\s*%\s*(?:stop(?:\s*loss)?|sl|loss|rugi)`, (r) => (out.exit.stopLossPct = num(r[1] ?? r[2])));
      any(String.raw`(?:(?:hold|keep|tahan)\s*(?:for\s*)?(?:at\s*most|max(?:imum)?|up\s*to|paling\s*lama|maks(?:imal)?)?|max(?:imum)?|maks(?:imal)?)\s*(\d+)\s*(?:trading\s*)?${UNIT}`, (r) => (out.exit.maxHoldDays = toDays(num(r[1]), r[2])));
      any(String.raw`rsi\s*(?:\(?(\d+)\)?)?\s*(?:is\s*)?(?:above|over|>|diatas|di atas)\s*(\d+)`, (r) => (out.exit.rsiAbove = num(r[2])));
    } else {
      any(String.raw`(?:drops?|falls?|down|dips?|turun|jatuh|anjlok)\s*(?:by\s*)?${N}\s*%\s*(?:in|within|over|dalam|selama)?\s*(a|one|satu|\d+)?\s*${UNIT}?`,
        (r) => out.entry.all.push({ type: "drop", pct: num(r[1]), days: toDays(/^\d/.test(r[2] || "") ? num(r[2]) : 1, r[3] || "day") }));
      any(String.raw`(?:rises?|up|gains?|jumps?|naik|melonjak)\s*(?:by\s*)?${N}\s*%\s*(?:in|within|over|dalam|selama)?\s*(a|one|satu|\d+)?\s*${UNIT}?`,
        (r) => out.entry.all.push({ type: "rise", pct: num(r[1]), days: toDays(/^\d/.test(r[2] || "") ? num(r[2]) : 1, r[3] || "day") }));
      any(String.raw`rsi\s*(?:\(?(\d+)\)?)?\s*(?:is\s*)?(?:below|under|<|dibawah|di bawah)\s*(\d+)`, (r) => out.entry.all.push({ type: "rsi_below", value: num(r[2]), period: num(r[1] || 14) }));
      any(String.raw`rsi\s*(?:\(?(\d+)\)?)?\s*(?:is\s*)?(?:above|over|>|diatas|di atas)\s*(\d+)`, (r) => out.entry.all.push({ type: "rsi_above", value: num(r[2]), period: num(r[1] || 14) }));
      any(String.raw`macd\s*(?:line\s*)?(?:crosses?|memotong|cross)\s*(?:above|over|up|ke atas|di atas)|macd\s*(?:bullish|golden)\s*cross`, () => out.entry.all.push({ type: "macd_cross_up" }));
      any(String.raw`volume\s*(?:is\s*)?(?:at\s*least\s*)?(\d+(?:[.,]\d+)?)\s*(?:x|×|times|kali)\s*(?:the\s*)?(?:(\d+)\s*-?\s*(?:day|hari)\s*)?(?:average|avg|rata-rata)?|(\d+(?:[.,]\d+)?)\s*(?:x|×|times|kali)\s*(?:the\s*)?(?:average\s*)?volume`, (r) => out.entry.all.push({ type: "volume_spike", mult: num(r[1] ?? r[3]), days: num(r[2] || 20) }));
      const cross = new RegExp(String.raw`(\d+)\s*-?\s*(?:day|hari)?\s*(?:sma|ma|moving average|average|avg|rata-rata)?\s*(?:crosses?|memotong|naik)\s*(?:above|over|ke atas|di atas)\s*(?:the\s*)?(\d+)`, "i").exec(c);
      if (cross) { hit = true; out.entry.all.push({ type: "sma_cross_up", fast: num(cross[1]), slow: num(cross[2]) }); }
      else {
        any(String.raw`(?:above|over|diatas|di atas)\s*(?:the\s*|its\s*)?(\d+)\s*-?\s*(?:day|hari)?\s*(?:sma|ma|moving average|average|avg|rata-rata)`, (r) => out.entry.all.push({ type: "above_sma", days: num(r[1]) }));
        any(String.raw`(?:below|under|dibawah|di bawah)\s*(?:the\s*|its\s*)?(\d+)\s*-?\s*(?:day|hari)?\s*(?:sma|ma|moving average|average|avg|rata-rata)`, (r) => out.entry.all.push({ type: "below_sma", days: num(r[1]) }));
      }
    }
    // a clause that only names tickers ("Beli AAPL", "MSFT and GOOGL") is fine
    const rest = c.replace(/\$?\b[A-Z]{1,5}\b/g, "").replace(/\b(buy|beli|and|dan|or|atau|the|saham|stocks?|shares?)\b/gi, "").replace(/[^a-z0-9%]/gi, "");
    if (!hit && rest) unparsed.push(c);
  }
  if (!out.symbols.length) unparsed.unshift("no ticker found (write it in capitals, e.g. NVDA)");
  if (!out.entry.all.length) unparsed.unshift("no entry rule found (e.g. 'buy when it drops 5% in a week')");
  if (out.exit.takeProfitPct == null && out.exit.stopLossPct == null && out.exit.maxHoldDays == null && out.exit.rsiAbove == null) unparsed.push("no exit rule found: positions would never be closed (add a take profit, stop loss or max hold)");
  out.name = out.symbols.length ? `${out.symbols.join("+")} ${out.entry.all.map((e) => e.type.replace("_", " ")).join(" + ") || "strategy"}` : "untitled";
  return { strategy: out, unparsed };
}

export function validate(s) {
  const e = [];
  if (!Array.isArray(s?.symbols) || !s.symbols.length) e.push("symbols: at least one ticker");
  if (s?.symbols?.length > 10) e.push("symbols: at most 10");
  if (!s?.entry?.all?.length) e.push("entry.all: at least one entry rule");
  for (const r of s?.entry?.all || []) if (!ENTRY_TYPES.includes(r.type)) e.push(`entry: unknown rule type ${r.type}`);
  const x = s?.exit || {};
  if (x.takeProfitPct == null && x.stopLossPct == null && x.maxHoldDays == null && x.rsiAbove == null && !x.smaCrossDown) e.push("exit: at least one exit rule");
  const r = s?.risk || {};
  if (r.positionPct != null && !(r.positionPct > 0 && r.positionPct <= 100)) e.push("risk.positionPct: 0-100");
  return e;
}

export function normalize(s) {
  return { name: s.name || "untitled", symbols: [...new Set((s.symbols || []).map((x) => String(x).toUpperCase().replace(/[^A-Z0-9.-]/g, "")).filter(Boolean))],
    entry: { all: s.entry?.all || [] }, exit: { ...s.exit }, risk: { ...DEFAULT_RISK, ...s.risk } };
}

const ruleText = (r) => ({
  drop: () => `price fell ${r.pct}% or more over the last ${r.days} trading day${r.days > 1 ? "s" : ""}`,
  rise: () => `price rose ${r.pct}% or more over the last ${r.days} trading day${r.days > 1 ? "s" : ""}`,
  rsi_below: () => `RSI(${r.period || 14}) below ${r.value}`,
  rsi_above: () => `RSI(${r.period || 14}) above ${r.value}`,
  above_sma: () => `close above its ${r.days}-day moving average`,
  below_sma: () => `close below its ${r.days}-day moving average`,
  sma_cross_up: () => `${r.fast}-day average crosses above the ${r.slow}-day average`,
  macd_cross_up: () => `MACD (12/26/9) crosses above its signal line`,
  volume_spike: () => `volume at least ${r.mult}× its ${r.days || 20}-day average`,
}[r.type]?.() ?? r.type);

export function toMarkdown(s) {
  const x = s.exit, k = s.risk;
  const strategy = `# ${s.name}

**Universe:** ${s.symbols.join(", ")}

## Entry (all must be true at the close; the order fills at the next open)
${s.entry.all.map((r) => `- ${ruleText(r)}`).join("\n")}

## Exit (whichever comes first)
${[x.takeProfitPct != null && `- take profit at +${x.takeProfitPct}%`, x.stopLossPct != null && `- stop loss at -${x.stopLossPct}%`, x.maxHoldDays != null && `- close after ${x.maxHoldDays} trading days`, x.rsiAbove != null && `- RSI(14) above ${x.rsiAbove}`, x.smaCrossDown && `- ${x.smaCrossDown.fast}-day average crosses below the ${x.smaCrossDown.slow}-day`].filter(Boolean).join("\n")}
`;
  const risk = `# Risk: ${s.name}

- Position size: ${k.positionPct}% of equity per trade
- Max open positions: ${k.maxPositions}
- Promotion gate: backtest max drawdown must stay under ${k.maxDrawdownPct}%
- Live orders go through Brakeline (daily loss limit, position cap, kill switch) and need the human's approval.
`;
  return { strategy, risk };
}
