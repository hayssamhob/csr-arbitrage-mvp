Below is a real arbitrage readiness checklist the exact mental model used by professional crypto trading desks before they allow capital to flow.

Think of this as a go/no-go gate.
If any item fails → no live arbitrage.

⸻

✅ Real Arbitrage Readiness Checklist

(CEX ↔ DEX, thin-liquidity assets like CSR / CSR25)

⸻

1. Market Data Integrity (NON-NEGOTIABLE)

✔ Must be true:
	•	CEX bid/ask comes from live authenticated API
	•	DEX price comes from:
	•	real pool state or
	•	simulated swap (exact size)
	•	Every price has:
	•	timestamp
	•	source
	•	quote age (ms)

❌ Fail if:
	•	Any fallback price is inferred, cached too long, or copied from another token
	•	CEX and DEX quotes are from different time windows
	•	Quote age exceeds thresholds (e.g. CEX > 3s, DEX > 10s)

System behavior on fail:
→ Disable arbitrage + show reason

⸻

2. Liquidity Reality Check (Thin Markets)

✔ Must be true:
	•	Quotes are size-aware (not mid-price fantasy)
	•	Price impact is measured at the exact trade size
	•	Ladder exists: $1 / $5 / $10 / $25 / $50 / $100 …

❌ Fail if:
	•	“Recommended size” is extrapolated
	•	Trade size would move price beyond max slippage
	•	Liquidity breaks before required alignment

System behavior on fail:
→ Reduce size or abort

⸻

3. Inventory Feasibility (Most bots fail here)

✔ Must be true for BUY CEX → SELL DEX:
	•	USDT available on CEX
	•	CSR withdrawable from CEX
	•	Wallet connected and funded with gas

✔ Must be true for BUY DEX → SELL CEX:
	•	USDT available in wallet
	•	CSR deposit enabled on CEX
	•	CEX account not rate-limited / frozen

❌ Fail if:
	•	Any leg cannot complete today
	•	Withdrawals or deposits are paused
	•	Inventory is insufficient after fees

System behavior on fail:
→ Show “Not executable (inventory constraint)”

⸻

4. Cost & Fee Accuracy (No hidden optimism)

✔ Must be included:
	•	CEX trading fees
	•	DEX LP fee tier
	•	Gas (estimated conservatively)
	•	Slippage at size
	•	Transfer fees (if applicable)

Edge must be shown as:
	•	Edge before costs (bps)
	•	Total costs (bps)
	•	Edge after costs (bps)

❌ Fail if:
	•	Net edge is not explicitly computed
	•	Any fee is assumed zero
	•	Gas is ignored “because it’s small”

⸻

5. Execution Atomicity & Risk

✔ Must be defined:
	•	Which leg executes first
	•	What happens if second leg fails
	•	Time window between legs

For MANUAL mode:
	•	User explicitly confirms DEX leg
	•	UI warns: “CEX trade already executed”

For AUTO mode:
	•	Wallet permissions explicit
	•	Failure handling defined
	•	Max loss per trade enforced

❌ Fail if:
	•	Partial execution risk is ignored
	•	No rollback or containment logic

⸻

6. Risk Limits Enforcement (SERVER-SIDE)

✔ Must be enforced in execution service:
	•	Max order size
	•	Daily volume limit
	•	Min edge (bps)
	•	Max slippage
	•	Kill switch

❌ Fail if:
	•	Limits exist only in UI
	•	Strategy engine ignores updated limits
	•	Arbitrage shown even when below threshold

System behavior on fail:
→ Strategy returns NO ACTION

⸻

7. State, History & Learning

✔ Must be stored:
	•	Price snapshots (CEX + DEX)
	•	Executed trades
	•	Failed attempts + reasons
	•	Price deviation history (last N)

Purpose:
	•	Validate strategy accuracy
	•	Detect false positives
	•	Improve thresholds

❌ Fail if:
	•	Analytics are computed only in-memory
	•	History does not match reality
	•	Charts lie

⸻

8. User Trust & Transparency

✔ User must always see:
	•	Why a trade is recommended
	•	Why it is blocked
	•	What assumption is limiting it
	•	Exact size used for calculation

❌ Fail if:
	•	UI says “No opportunity” without reason
	•	Numbers change without explanation
	•	System feels like a black box

⸻

9. Safety Controls (Before AUTO is allowed)

AUTO mode is locked unless:
	•	All above checks pass
	•	Wallet permissions explicitly granted
	•	Kill switch tested
	•	Dry-run / paper mode validated
	•	Max loss per day configured

AUTO is a privilege, not a toggle.

⸻

10. Final GO / NO-GO Rule

If you cannot explain a trade to a human in one sentence,
the system must not execute it.

Example of a valid explanation:

“Buy CSR on LATOKEN at 0.00277, sell on Uniswap at 0.00318, size $500, net edge +946 bps after fees, slippage 0.9%, inventory available.”

If you can’t generate that sentence → NO TRADE.

⸻

Closing Thought

What we are building is beyond 90% of crypto bots.
This checklist is what separates:
	•	A dashboard that looks smart
from
	•	A system that can safely touch capital.

If you want next:
	•	I can convert this into acceptance tests (PASS/FAIL per trade)
	•	Or into a system status panel (“Arbitrage readiness: 8/10”)
