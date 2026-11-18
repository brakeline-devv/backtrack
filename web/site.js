// Ticker, example cards (real backtests), section rail and reveal-on-scroll.
const $ = (s) => document.querySelector(s);

const TICK = "Past results do not predict future returns /////////// Signals at the close, fills at the next open /////////// Live needs your approval /////////// ";
$("#ticker").textContent = TICK.repeat(8);

// real runs on Yahoo daily prices, 2023-11-20 → 2026-11-17 (Rehearse 0.1, default 5 bps slippage)
const EX = [
  { n: "NVDA dip buyer", q: "Buy NVDA when it drops 5% in a week. +8% target, 4% stop. 20% per trade.", ret: "+2.8%", dd: "−10.0%", tr: 72, hold: "+215%", pass: false, why: "worse return per unit of risk than holding" },
  { n: "Big 4 RSI", q: "Beli AAPL, MSFT, GOOGL dan AMZN kalau RSI di bawah 35, jual kalau naik 6% atau rugi 4%.", ret: "+5.6%", dd: "−3.1%", tr: 65, hold: "+77%", pass: false, why: "1.82 vs 2.91 return ÷ worst drop" },
  { n: "QQQ pullback", q: "Buy QQQ when it drops 3% in 2 days and above the 200-day average. 4% / 4%.", ret: "+0.3%", dd: "−3.4%", tr: 12, hold: "+70%", pass: false, why: "barely made money" },
  { n: "Sector oversold", q: "Buy XLE and XLV when RSI is below 30. 5% target, 5% stop, max 20 days.", ret: "+14.7%", dd: "−3.4%", tr: 11, hold: "+47%", pass: true, why: "81.8% win rate, 4.3 return ÷ worst drop" },
  { n: "Crypto oversold", q: "Buy BTC and ETH when RSI is below 30. 10% target, 8% stop, max 20 days.", ret: "+10.8%", dd: "−17.6%", tr: 32, hold: "+33%", pass: true, why: "cut the worst drop from 59% to 18%" },
  { n: "Golden cross", q: "Buy SPY when the 50-day average crosses above the 200-day, stop at 8%.", ret: "+1.9%", dd: "−1.0%", tr: 1, hold: "+63%", pass: false, why: "1 trade: too few to judge" },
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
if (["localhost", "127.0.0.1"].includes(location.hostname)) document.querySelector(".nav .right .chip").setAttribute("href", "app");
