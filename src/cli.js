#!/usr/bin/env node
// backtrack            → MCP server on stdio (what Claude / Cursor start)
// backtrack dashboard  → dashboard on http://localhost:6200/app
// backtrack "<text>"   → parse + backtest a strategy in the terminal
const cmd = process.argv[2] ?? "mcp";
if (cmd === "mcp") (await import("./mcp.js")).startMcp();
else if (cmd === "dashboard") (await import("./server.js")).startServer();
else {
  const { parse } = await import("./strategy.js"), { run } = await import("./store.js");
  const p = parse(process.argv.slice(2).join(" "));
  if (p.unparsed.length) console.log("could not read:", p.unparsed.join(" | "));
  const r = await run(p.strategy), m = r.metrics, f = (x) => (x == null ? "–" : (x * 100).toFixed(1) + "%");
  console.log(`${r.strategy.name}: ${m.from} → ${m.to}`);
  console.log(`return ${f(m.totalReturn)} · worst drop ${f(m.maxDrawdown)} · ${m.trades} trades · win ${f(m.winRate)} · hold ${f(m.buyHold?.ret)} · SPY ${f(m.spy?.ret)}`);
  for (const x of [...r.verdict.fails, ...r.verdict.notes]) console.log("  - " + x);
}
