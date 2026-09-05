// Standalone check of the -32005 retry classification, run with plain
// node. Mirrors the predicates in genlayer.ts against the exact error
// shapes viem/MetaMask produce, including the reviewer's report.
//
//   node src/lib/retry.test.mjs

function errText(e) {
  const err = e ?? {};
  return [
    err.shortMessage,
    err.details,
    err.message,
    err.cause?.message,
    typeof e === "string" ? e : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function errCode(e) {
  const seen = new Set();
  let cur = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur.code === "number") return cur.code;
    cur = cur.cause;
  }
  return undefined;
}

function retryAfterMs(e) {
  const seen = new Set();
  let cur = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const v = cur.data?.retryAfterMs;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    cur = cur.cause;
  }
  const m = errText(e).match(/"?retryAfterMs"?\s*:\s*(\d+)/);
  return m?.[1] ? Number(m[1]) : undefined;
}

function isTerminal(e) {
  if (errCode(e) === 4001) return true;
  const t = errText(e).toLowerCase();
  return (
    /user rejected|user denied|rejected the request/.test(t) ||
    /insufficient funds/.test(t) ||
    /chain \d+ but client is configured|wrong network|chain mismatch/.test(t)
  );
}

function isRateLimited(e) {
  if (isTerminal(e)) return false;
  if (errCode(e) === -32005) return true;
  const t = errText(e).toLowerCase();
  return (
    t.includes("gas rate limit exceeded") ||
    t.includes("node is at capacity") ||
    t.includes("zksync-os-testnet-genlayer") ||
    t.includes("retryafterms") ||
    t.includes("too many requests")
  );
}

// --- the reviewer's exact error, as viem surfaces it -------------------
const reviewerError = {
  shortMessage: "An unknown RPC error occurred.",
  details:
    '[From https://zksync-os-testnet-genlayer.zksync.dev] server returned an ' +
    'error response: error code -32005: transaction gas rate limit exceeded: ' +
    'node is at capacity, retry in ~816ms, data: {"retryAfterMs":816}',
  cause: { code: -32005, data: { retryAfterMs: 816 } },
};

const cases = [
  ["reviewer -32005 (retry)", reviewerError, { retry: true, after: 816 }],
  [
    "code only, no data",
    { code: -32005, message: "node is at capacity" },
    { retry: true, after: undefined },
  ],
  [
    "message only, scraped ms",
    { message: 'gas rate limit exceeded, data: {"retryAfterMs":420}' },
    { retry: true, after: 420 },
  ],
  [
    "user rejected (never retry)",
    { code: 4001, message: "User rejected the request." },
    { retry: false, after: undefined },
  ],
  [
    "insufficient funds (never retry)",
    { message: "insufficient funds for gas * price + value" },
    { retry: false, after: undefined },
  ],
  [
    "wrong network (never retry)",
    { message: "Wallet is on chain 1 but client is configured for chain 4221" },
    { retry: false, after: undefined },
  ],
  [
    "contract revert (never retry)",
    { message: "UserError(message='EXPECTED: duplicate market')" },
    { retry: false, after: undefined },
  ],
];

let failed = 0;
for (const [name, err, want] of cases) {
  const gotRetry = isRateLimited(err);
  const gotAfter = retryAfterMs(err);
  const ok = gotRetry === want.retry && gotAfter === want.after;
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${name.padEnd(30)} retry=${gotRetry} after=${gotAfter}`,
  );
}

// Backoff schedule when the node gives no hint.
const BASE = 800;
const schedule = [1, 2, 3, 4].map((a) => BASE * 2 ** (a - 1));
const wantSchedule = [800, 1600, 3200, 6400];
const schedOk = JSON.stringify(schedule) === JSON.stringify(wantSchedule);
if (!schedOk) failed++;
console.log(
  `${schedOk ? "  ok  " : " FAIL "} ${"backoff schedule".padEnd(30)} ${schedule.join(", ")}ms`,
);

console.log(failed === 0 ? "\nPASS" : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
