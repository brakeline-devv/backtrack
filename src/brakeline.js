// Reads the human's Brakeline rules (if Brakeline is installed) so Backtrack can warn when a strategy's
// position size is bigger than Brakeline will allow, and size today's signals to fit. Looks in BRAKELINE_HOME, then ~/.brakeline, then a sibling ../brakeline/data.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// keep in sync with Brakeline's FUNDS (src/rules.js)
export const FUNDS = new Set(["SPY", "VOO", "IVV", "VTI", "QQQ", "DIA", "IWM", "BND", "AGG", "TLT", "SHY", "SGOV", "GLD", "IAU"]);

export function brakelineLimits() {
  const dirs = [process.env.BRAKELINE_HOME, join(homedir(), ".brakeline"), fileURLToPath(new URL("../../brakeline/data/", import.meta.url))].filter(Boolean);
  for (const d of dirs) {
    const f = join(d, "rules.json");
    if (!existsSync(f)) continue;
    try {
      const r = JSON.parse(readFileSync(f, "utf8"));
      const stock = Number(r.maxPositionPct ?? 5), fund = Number(r.maxFundPositionPct ?? 30);
      return { found: true, file: f, stock: stock / 100, fund: fund / 100 };
    } catch { /* unreadable: try the next place */ }
  }
  return { found: false };
}
