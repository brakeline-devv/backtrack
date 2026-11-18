// Rehearse dashboard: describe → parse → backtest → save → promote (paper) → approve live (human only).
const $ = (s) => document.querySelector(s);
const pct = (x, d = 1) => (x == null ? "–" : `${(x * 100).toFixed(d)}%`);
const sgn = (x) => (x == null ? "" : x >= 0 ? "pos" : "neg");
const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then((r) => r.json());
let current = null, editingId = null;

const EXAMPLES = [
  "Buy NVDA when it drops 5% in a week. Sell at +8% take profit or a 4% stop loss. 20% of equity per trade.",
  "Beli AAPL, MSFT, GOOGL dan AMZN kalau RSI di bawah 35, jual kalau naik 6% atau rugi 4%, tahan paling lama 15 hari",
  "Buy QQQ when it drops 3% in 2 days and above the 200-day moving average. Take profit 4%, stop loss 4%, hold max 10 days. 30% of equity per trade",
  "Buy TSLA when the 20 day MA crosses above the 50, stop loss 8%, take profit 20%",
];
$("#examples").innerHTML = EXAMPLES.map((e, i) => `<button data-i="${i}">${esc(e.length > 48 ? e.slice(0, 46) + "…" : e)}</button>`).join("");
$("#examples").onclick = (ev) => { const i = ev.target.dataset.i; if (i != null) { $("#text").value = EXAMPLES[i]; editingId = null; run(); } };

const ruleText = (r) => ({
  drop: `fell ${r.pct}% in ${r.days} day${r.days > 1 ? "s" : ""}`, rise: `rose ${r.pct}% in ${r.days} day${r.days > 1 ? "s" : ""}`,
  rsi_below: `RSI(${r.period || 14}) below ${r.value}`, rsi_above: `RSI(${r.period || 14}) above ${r.value}`,
  above_sma: `above ${r.days}-day average`, macd_cross_up: `MACD crosses above signal`, volume_spike: `volume ≥ ${r.mult}× ${r.days || 20}-day avg`, below_sma: `below ${r.days}-day average`, sma_cross_up: `${r.fast}-day average crosses above ${r.slow}-day`,
}[r.type] || r.type);

function showRules(s, unparsed) {
  const x = s.exit, k = s.risk;
  $("#rules").innerHTML = `
    <div><small>Universe</small><ul><li>${s.symbols.map(esc).join(", ") || "<span class='neg'>no ticker</span>"}</li></ul></div>
    <div><small>Entry (all true)</small><ul>${s.entry.all.map((r) => `<li>${esc(ruleText(r))}</li>`).join("") || "<li class='neg'>none</li>"}</ul></div>
    <div><small>Exit & risk</small><ul>${[x.takeProfitPct != null && `take profit +${x.takeProfitPct}%`, x.stopLossPct != null && `stop loss −${x.stopLossPct}%`, x.maxHoldDays != null && `max ${x.maxHoldDays} days`, x.rsiAbove != null && `RSI above ${x.rsiAbove}`, `${k.positionPct}% per trade · max ${k.maxPositions} open`].filter(Boolean).map((t) => `<li>${t}</li>`).join("")}</ul></div>`;
  $("#unparsed").hidden = !unparsed?.length;
  $("#unparsed").innerHTML = unparsed?.length ? `Not understood: ${unparsed.map(esc).join(" · ")}` : "";
  $("#rulesCard").hidden = false;
}

function chart(r) {
  const S = r.curve, H = r.benchmark.hold || [], P = r.benchmark.spy || [];
  const all = [...S, ...H, ...P].map((p) => p.v), lo = Math.min(...all) * 0.98, hi = Math.max(...all) * 1.02;
  const X = (i, n) => 50 + (i / (n - 1)) * 935, Y = (v) => 300 - ((v - lo) / (hi - lo)) * 280;
  const path = (c) => c.map((p, i) => `${i ? "L" : "M"}${X(i, c.length).toFixed(1)} ${Y(p.v).toFixed(1)}`).join("");
  let g = "";
  for (let t = 0; t <= 4; t++) { const v = lo + ((hi - lo) * t) / 4; g += `<line x1="50" x2="985" y1="${Y(v)}" y2="${Y(v)}" stroke="#1b282c"/><text x="44" y="${Y(v) + 4}" text-anchor="end">${(v / 1000).toFixed(0)}k</text>`; }
  for (const [i, d] of [[0, S[0].d], [Math.floor(S.length / 2), S[Math.floor(S.length / 2)].d], [S.length - 1, S.at(-1).d]]) g += `<text x="${X(i, S.length)}" y="318" text-anchor="${i ? (i === S.length - 1 ? "end" : "middle") : "start"}">${d}</text>`;
  $("#chart").innerHTML = g + (P.length ? `<path d="${path(P)}" fill="none" stroke="#6b7d7b" stroke-width="1.5"/>` : "") + (H.length ? `<path d="${path(H)}" fill="none" stroke="#9b7bff" stroke-width="1.8"/>` : "") + `<path d="${path(S)}" fill="none" stroke="#3ee6c4" stroke-width="2.6"/>`;
}

function showResult(r) {
  const m = r.metrics;
  $("#period").textContent = `${m.from} → ${m.to} · start ${usd(m.startCash)}`;
  $("#kpis").innerHTML = [
    ["Strategy return", pct(m.totalReturn), sgn(m.totalReturn), `${pct(m.cagr)} a year`],
    ["Buy & hold", pct(m.buyHold?.ret), sgn(m.buyHold?.ret), `S&P 500: ${pct(m.spy?.ret)}`],
    ["Worst drop", `−${pct(m.maxDrawdown)}`, "", `buy & hold: −${pct(m.buyHold?.maxDrawdown)}`],
    ["Trades", m.trades, "", `win rate ${pct(m.winRate, 0)} · profit factor ${m.profitFactor ?? "–"}`],
  ].map(([a, b, c, d]) => `<div class="kpi"><small>${a}</small><b class="${c}">${b}</b><span>${d}</span></div>`).join("");
  chart(r);
  const v = r.verdict;
  $("#verdict").innerHTML = `<h3>${v.canPromote ? "Passes the gate" : "Does not pass the gate"} <span class="badge ${v.canPromote ? "ok" : "no"}">${v.canPromote ? "can go to paper" : "stays in the lab"}</span></h3>
    <ul>${v.fails.map((f) => `<li class="f">✕ ${esc(f)}</li>`).join("")}${v.notes.map((n) => `<li class="n">${esc(n)}</li>`).join("")}</ul><p class="disc">${esc(v.disclaimer)}</p>`;
  const T = r.trades.slice(-15).reverse();
  $("#tradeNote").textContent = r.trades.length > 15 ? `last 15 of ${r.trades.length}` : `${r.trades.length}`;
  $("#trades").innerHTML = T.length ? `<tr><th>Ticker</th><th>In</th><th class="num">Entry</th><th>Out</th><th class="num">Exit</th><th class="num">Return</th><th>Why</th></tr>` + T.map((t) => `<tr><td><b>${esc(t.symbol)}</b></td><td>${t.entryDate}</td><td class="num">${t.entry.toFixed(2)}</td><td>${t.exitDate}</td><td class="num">${t.exit.toFixed(2)}</td><td class="num ${sgn(t.ret)}">${pct(t.ret)}</td><td class="hint">${esc(t.why)}</td></tr>`).join("") : `<tr><td class="hint">No trades: the entry rules never fired in this period.</td></tr>`;
  $("#saveMsg").textContent = editingId ? `Saving updates "${editingId}".` : "";
  $("#result").hidden = false;
}

async function run() {
  $("#run").disabled = true; $("#status").textContent = "reading the strategy…";
  try {
    const p = await post("/api/parse", { text: $("#text").value });
    showRules(p.strategy, p.unparsed);
    $("#status").textContent = "backtesting on real prices…";
    const r = await post("/api/backtest", { strategy: p.strategy });
    if (r.error) { $("#result").hidden = true; $("#status").textContent = r.error; return; }
    current = { strategy: r.strategy, text: $("#text").value };
    showResult(r);
    $("#status").textContent = `${r.strategy.name} · ${r.metrics.trades} trades`;
  } finally { $("#run").disabled = false; }
}

async function refreshList() {
  const L = await fetch("/api/strategies").then((r) => r.json());
  $("#list").innerHTML = L.length ? `<tr><th>Strategy</th><th>Status</th><th class="num">Return</th><th class="num">Worst drop</th><th class="num">Trades</th><th></th></tr>` + L.map((s) => `<tr>
    <td><b>${esc(s.name)}</b><div class="hint">${esc(s.id)}</div></td><td><span class="st ${s.status}">${s.status}</span></td>
    <td class="num ${sgn(s.last?.totalReturn)}">${pct(s.last?.totalReturn)}</td><td class="num">−${pct(s.last?.maxDrawdown)}</td><td class="num">${s.last?.trades ?? "–"}</td>
    <td style="text-align:right">
      <button class="small" data-act="open" data-id="${esc(s.id)}">Open</button>
      ${s.status === "backtested" ? `<button class="small" data-act="paper" data-id="${esc(s.id)}" ${s.last?.canPromote ? "" : "disabled title='did not pass the gate'"}>To paper</button>` : ""}
      ${s.status === "paper" ? `<button class="small primary" data-act="live" data-id="${esc(s.id)}">Approve live</button>` : ""}
      ${["paper", "live"].includes(s.status) ? `<button class="small" data-act="book" data-id="${esc(s.id)}">Positions</button>` : ""}
      ${s.status === "live" ? `<button class="small" data-act="pause" data-id="${esc(s.id)}">Back to paper</button>` : ""}
      <button class="small" data-act="del" data-id="${esc(s.id)}">Delete</button></td></tr>`).join("") : `<tr><td class="hint">Nothing saved yet. Backtest a strategy, then save it.</td></tr>`;
}
$("#list").onclick = async (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (act === "open") { const s = await fetch(`/api/strategy/${encodeURIComponent(id)}`).then((r) => r.json()); $("#text").value = s.text || ""; editingId = id; showRules(s.strategy, []); const r = await post("/api/backtest", { strategy: s.strategy }); current = { strategy: r.strategy, text: s.text }; showResult(r); scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (act === "book") {
    const [st, ex, sg] = await Promise.all([fetch(`/api/paper/${encodeURIComponent(id)}`).then((r) => r.json()), post("/api/exits", { id }), post("/api/signals", { id })]);
    const open = Object.entries(st.open || {});
    $("#paper").innerHTML = `<h3>${esc(id)} · ${esc(st.status)} · ${st.trades} closed trade${st.trades === 1 ? "" : "s"} · realized ${st.realizedPnl >= 0 ? "+" : ""}${usd(st.realizedPnl)}</h3>
      <div class="grid">
        <div><small>Open positions</small>${open.length ? open.map(([k, p]) => `<b>${esc(k)}</b> ${p.qty} @ ${(+p.entryPrice).toFixed(2)} since ${p.entryDate}`).join("<br>") : "none"}</div>
        <div><small>Sell now?</small>${(ex.exits || []).length ? ex.exits.map((e) => `<b>${esc(e.symbol)}</b> ${e.sell ? `<span class="neg">SELL</span>: ${esc(e.reasons.join(", "))}` : `hold (${esc(e.keepUntil)})`}`).join("<br>") : "nothing open"}</div>
        <div><small>Buy today?</small>${(sg.signals || []).map((x) => `<b>${esc(x.symbol)}</b> ${x.suggested ? `<span class="pos">BUY</span> ${x.suggested.qty} (~${usd(x.suggested.notional)})${x.sizing ? `<br><span class="hint">${esc(x.sizing)}</span>` : ""}` : x.note ? esc(x.note) : "no signal"}`).join("<br>") || esc(sg.error || "")}</div>
      </div><p class="hint">Rehearse never trades. Your agent places these through Brakeline and reports each fill with <code>record_fill</code>.</p>`;
    $("#paper").hidden = false; return;
  }
  if (act === "paper") { const r = await post("/api/promote", { id }); if (r.error) alert(r.error); }
  if (act === "live" && confirm(`Approve "${id}" for LIVE?\n\nYour agent may then place its signals on your real account. Every order still goes through Brakeline's rules.`)) await post("/api/status", { id, status: "live" });
  if (act === "pause") await post("/api/status", { id, status: "paper" });
  if (act === "del" && confirm(`Delete "${id}"?`)) await post("/api/delete", { id });
  refreshList();
};
$("#run").onclick = () => { editingId = null; run(); };
$("#save").onclick = async () => {
  if (!current) return;
  const r = await post("/api/save", { strategy: current.strategy, text: current.text, id: editingId || undefined });
  $("#saveMsg").textContent = r.error ? r.error : `Saved as "${r.saved}" (${r.status}). strategy.md and risk.md written.`;
  if (!r.error) editingId = r.saved;
  refreshList();
};
refreshList(); run();
