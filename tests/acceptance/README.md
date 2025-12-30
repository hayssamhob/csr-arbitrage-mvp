# Acceptance Tests

This directory contains acceptance tests for the CSR Arbitrage Platform.
These tests validate the readiness checklist from `docs/acceptance-tests.md`.

## Test Categories

1. **price-freshness.test.ts** - Verify data staleness detection (abort if quotes > 5s old)
2. **quote-ladder.test.ts** - Verify size comes from quote ladder, not extrapolation
3. **edge-calculation.test.ts** - Verify edge uses user's current risk limits
4. **cost-modeling.test.ts** - Verify gas + slippage + fees calculated explicitly
5. **inventory-check.test.ts** - Verify user has sufficient balance before trade
6. **settings-persistence.test.ts** - Verify settings persist across reloads
7. **health-check.test.ts** - Verify service health and auto-restart on disconnect

## Running Tests

```bash
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npm test price-freshness    # Run specific test
```

## Test Philosophy

- Tests are **acceptance tests** not unit tests
- They validate **observable behavior** not implementation details
- Each test should map to a specific requirement in `docs/acceptance-tests.md`
- Tests should fail loudly with clear reasons
