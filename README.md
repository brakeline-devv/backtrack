# Rehearse · strategy lab for AI agents (working name)

Describe a trading strategy in plain words. Rehearse turns it into auditable rules, backtests it on ~3 years of
real daily prices, and walks it up **draft → backtested → paper → live**. Only the human can approve live.
Rehearse never trades: the agent places orders through [Brakeline](https://brakeline.trade).

- **Plain words in** (English or Indonesian): "Buy NVDA when it drops 5% in a week. Sell at +8% or a 4% stop loss."
  Anything it can't read is reported in `unparsed`, never guessed.
- **Honest backtest**: signals at the close, fills at the next open, stop loss assumed before take profit on the
  same day, gap fills, 5 bps slippage. Compared with buy & hold and SPY.
- **Promotion gate**: 10+ trades, drawdown under the limit, positive return, and better return per unit of risk
  than simply holding. Warns when the position size exceeds the user's Brakeline cap.
- **strategy.md + risk.md** written for every saved strategy.
- **Paper / live loop**: `todays_signals` (entries), `check_exits` (take profit, stop loss, max hold, RSI / average
  exits for open positions), `record_fill`, `paper_status`.

Rules: price drop / rise over N days, RSI below / above, above / below an N-day average, average cross up, MACD
cross up, volume spike. Exits: take profit, stop loss, max hold days, RSI above.

## Run

```
npm install
npm start          # dashboard on http://localhost:6200/app
npm test
node src/cli.js "Buy QQQ when it drops 3% in 2 days, take profit 4%, stop loss 4%"
claude mcp add rehearse -- node /path/to/backtest-loop/src/cli.js mcp
```

Past results do not predict future returns. Not investment advice.
