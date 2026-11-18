// Ticker, example cards (real backtests), section rail and reveal-on-scroll.
const $ = (s) => document.querySelector(s);

const TICK = "Past results do not predict future returns /////////// Signals at the close, fills at the next open /////////// Live needs your approval /////////// ";
$("#ticker").textContent = TICK.repeat(8);

// real runs of these exact sentences on Yahoo daily prices, 2023-11-20 → 2026-11-17 (Backtrack 0.1.1, defaults: 10% per trade unless stated, 3 positions, 5 bps slippage)
const EX = [
  { n: "NVDA dip buyer", q: "Buy NVDA when it drops 5% in a week. +8% target, 4% stop. 20% per trade.", ret: "+2.8%", dd: "−10.0%", tr: 72, hold: "+215%", pass: false, why: "0.27 vs 5.84 return ÷ worst drop" },
  { n: "Big 4 RSI", q: "Beli AAPL, MSFT, GOOGL dan AMZN kalau RSI di bawah 35, jual kalau naik 6% atau rugi 4%.", ret: "+5.9%", dd: "−3.1%", tr: 64, hold: "+77%", pass: false, why: "1.88 vs 2.91 return ÷ worst drop" },
  { n: "QQQ pullback", q: "Buy QQQ when it drops 3% in 2 days and above the 200-day average. 4% / 4%.", ret: "−0.7%", dd: "−1.7%", tr: 12, hold: "+70%", pass: false, why: "lost money over three years" },
  { n: "Sector oversold", q: "Buy XLE and XLV when RSI is below 30. 5% target, 5% stop, max 20 days.", ret: "+3.1%", dd: "−0.8%", tr: 11, hold: "+47%", pass: true, why: "82% win rate, worst drop 0.8% vs 15.8% holding" },
  { n: "Crypto oversold", q: "Buy BTC and ETH when RSI is below 30. 10% target, 8% stop, max 20 days.", ret: "+2.9%", dd: "−4.1%", tr: 32, hold: "+33%", pass: true, why: "worst drop 4.1% vs 58.6% holding" },
  { n: "Golden cross", q: "Buy SPY when the 50-day average crosses above the 200-day, stop at 8%.", ret: "+1.9%", dd: "−1.0%", tr: 1, hold: "+63%", pass: false, why: "1 trade in 3 years: too few to judge" },
];
const card = (e) => `<article class="card" data-p="${e.pass ? "pass" : "fail"}"><div class="t"><span>${e.n}</span><i class="${e.pass ? "pass" : "fail"}">${e.pass ? "PASS" : "FAIL"}</i></div>
  <div class="b"><q>"${e.q}"</q><div class="m"><span>return</span><b class="${e.pass ? "l" : ""}">${e.ret}</b><span>worst drop</span><b>${e.dd}</b><span>trades</span><b>${e.tr}</b><span>buy &amp; hold</span><b>${e.hold}</b></div>
  <p style="margin-top:10px;color:#9a9a9a">${e.why}</p></div></article>`;
$("#cards").innerHTML = EX.map(card).join("");
$("#tabs").onclick = (ev) => {
  const f = ev.target.dataset.f; if (!f) return;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b === ev.target));
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("hide", f !== "all" && c.dataset.p !== f));
};

// rail: highlight the section in view
const rail = [...document.querySelectorAll(".rail span")];
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) rail.forEach((s, i) => s.classList.toggle("on", i + 1 === +e.target.dataset.n)); }), { rootMargin: "-45% 0px -45% 0px" });
document.querySelectorAll("section[data-n]").forEach((s) => io.observe(s));

// reveal
const rv = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); rv.unobserve(e.target); } }), { threshold: .12 });
document.querySelectorAll("section .copy, section h2, .bul, .gate-wrap, .cards, .mission, .join, .two").forEach((el) => { el.classList.add("rv"); rv.observe(el); });

// keep videos playing (autoplay can stall on tab switch)
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.querySelectorAll("video").forEach((v) => v.play().catch(() => {})); });

// the dashboard runs on the user's computer: on the public site, point the dashboard links to the install steps
if (["localhost", "127.0.0.1"].includes(location.hostname)) document.querySelectorAll(".nav .right .chip").forEach((c) => { if (c.textContent.includes("DASHBOARD")) c.setAttribute("href", "app"); });
