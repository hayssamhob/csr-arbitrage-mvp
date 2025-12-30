Here are acceptance tests you can paste into the repo as docs/acceptance-tests.md (or turn into automated tests). They’re written PASS/FAIL, with clear inputs, expected outputs, and failure reasons.

⸻

Arbitrage System Acceptance Tests (PASS/FAIL)

A. Quote & Freshness Gate

A1 — CEX quote freshness

Given: CEX quote timestamp age > threshold (e.g., > 3s)
When: system computes arbitrage opportunities
Then: opportunity list shows NO ACTION for that market
And: UI reason = cex_stale with age shown

✅ PASS if: the market is blocked with explicit reason
❌ FAIL if: the market still shows edge/opportunity using stale data

⸻

A2 — DEX quote freshness

Given: latest DEX quote age > threshold (e.g., > 10s)
When: system computes arbitrage opportunities
Then: market is blocked
And: UI reason = dex_stale with age shown

✅ PASS if: blocked with reason
❌ FAIL if: uses stale DEX quote or falls back silently

⸻

A3 — No silent fallback

Given: primary DEX source fails and system uses a fallback
When: displaying DEX price / trade suggestion
Then: UI must label source as fallback:<type>
And: confidence must degrade (e.g., HIGH → MEDIUM/LOW)

✅ PASS if: fallback is explicit
❌ FAIL if: UI shows normal prices as if primary succeeded

⸻

B. Liquidity & “Size-to-Impact” Logic

B1 — Ladder exists and is used

Given: ladder sizes configured: $1/$5/$10/$25/$50/$100/$250…
When: scraper runs
Then: UI shows ladder rows for both CSR and CSR25
And: each row includes price + impact + age

✅ PASS if: ladder is visible and populated
❌ FAIL if: ladder missing, partial, or not used in recommendation

⸻

B2 — Recommendation must be “smallest sufficient size”

Given: target impact needed = X% (derived from deviation + band)
When: ladder contains multiple sizes
Then: recommended size = minimum USDT amount whose impact >= X%
And: UI shows: needed X%, got Y%, chosen size=$Z

✅ PASS if: smallest sufficient size chosen
❌ FAIL if: fixed amount (e.g., always $250) or non-minimal size

⸻

B3 — No hardcoded “$250”

Given: deviation changes between runs (e.g., 2%, 8%, 12%)
When: recommendation runs
Then: recommended size must vary accordingly
And: must not remain constant unless ladder truly implies it

✅ PASS if: size varies with deviation/impact
❌ FAIL if: recommended size stays $250 across conditions

⸻

C. Cost Model & Net Edge

C1 — Edge must be computed net of costs

Given: an opportunity with positive gross edge
When: costs are applied (CEX fees + LP fee + gas + slippage)
Then: UI must show:
	•	gross_edge_bps
	•	total_cost_bps
	•	net_edge_bps

✅ PASS if: all 3 displayed and consistent
❌ FAIL if: net edge not computed or costs ignored

⸻

C2 — Block if net edge below min_edge_bps

Given: user risk limit min_edge_bps = 30
When: net edge = 29 bps
Then: opportunity must be blocked
And: reason shown: below_min_edge (29 < 30)

✅ PASS if: respects updated min_edge_bps
❌ FAIL if: UI still uses old threshold (e.g., 50 bps)

⸻

D. Risk Limits (Server-Side Enforcement)

D1 — Max order size enforced on execution

Given: risk limit max_order_usdt = 100
When: user attempts execution with 250
Then: API returns 400 + error order_size_exceeds_limit
And: UI shows friendly error

✅ PASS if: backend blocks it even if UI allows typing it
❌ FAIL if: UI-only enforcement or trade executes anyway

⸻

D2 — Daily volume enforced

Given: daily_limit_usdt = 1000 and used_today_usdt = 950
When: attempt trade size = 100
Then: execution is blocked with daily_limit_exceeded

✅ PASS if: blocked correctly
❌ FAIL if: trade still allowed

⸻

D3 — Kill switch blocks everything

Given: kill switch = ON
When: any trade attempt is made (manual or auto)
Then: execution is blocked and reason shown

✅ PASS if: nothing executes
❌ FAIL if: any order is placed

⸻

E. Execution Safety (Atomicity)

E1 — Manual mode warns about partial execution

Given: trade requires CEX leg + DEX leg
When: system executes CEX leg first
Then: UI must display warning:
“CEX executed. DEX pending user signature.”

✅ PASS if: warning shown before/at execution
❌ FAIL if: user is not warned of partial risk

⸻

E2 — Auto mode requires explicit wallet control consent

Given: AUTO mode selected
When: wallet delegation not enabled
Then: system prevents AUTO start and prompts consent flow

✅ PASS if: cannot start AUTO without consent
❌ FAIL if: AUTO starts with no wallet control

⸻

F. Data Persistence & Analytics Truth

F1 — Price deviation history persists

Given: system runs for 30 minutes
When: user reloads page
Then: “Deviation History (Last 20)” is unchanged (for same timeframe)
And: values come from DB, not memory

✅ PASS if: persisted and consistent
❌ FAIL if: history resets on refresh

⸻

F2 — Store a snapshot for every computed opportunity

Given: strategy computes opportunities every N seconds
When: system runs
Then: DB stores:
	•	timestamp
	•	cex bid/ask
	•	dex exec price (for ladder size used)
	•	gross/net edge
	•	reason if blocked

✅ PASS if: full audit trail exists
❌ FAIL if: only UI state exists

⸻

G. Integrations Health & Observability

G1 — Connection error must show “why”

Given: LBank API fails
When: UI shows status indicator
Then: status displays reason category:
	•	auth_error / rate_limited / timeout / bad_response
And: last_success timestamp shown

✅ PASS if: reason + last success visible
❌ FAIL if: generic “connection error” only

⸻

H. UX Correctness

H1 — Correct market opens correct Uniswap pool link

Given: CSR market context link
When: user clicks
Then: opens CSR pool URL (not swap screen; not CSR25)

✅ PASS if: correct pool page
❌ FAIL if: wrong token/pair opened

⸻

H2 — Terminology

Given: UI label “Spread”
When: user views alignment modal
Then: label must be renamed to:
“Price Deviation (DEX vs CEX)” (or your chosen term)
And: tooltip explains formula

✅ PASS if: correct naming and tooltip
❌ FAIL if: ambiguous “Spread” remains

⸻

Definition of “Ready for LIVE”

System is LIVE-ready only if:
	•	All A–H tests pass in PAPER + MANUAL
	•	E2 (auto consent) passes
	•	Observability (G1) reliably explains failures
	•	Risk enforcement is confirmed server-side (D suite)

⸻

If you want, I can also convert these into a single “Readiness Score” widget (e.g., 14/14 checks passing) and a JSON schema so the backend can emit pass/fail/reason per market every cycle.
