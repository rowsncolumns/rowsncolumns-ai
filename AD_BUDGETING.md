# Ad Budgeting (Credits to USD)

Last updated: 2026-03-24

## Current app defaults

- `INITIAL_CREDITS = 30` credits per user per day
- Example user count: `100`
- Total credits/day: `100 * 30 = 3,000`

## Core formulas

- Daily credits: `users * credits_per_user_per_day`
- Daily cost (USD): `daily_credits * usd_per_credit`
- Monthly cost (USD): `daily_cost_usd * days_in_month`

## Daily budget for 100 users

| USD per credit | Daily credits | Daily budget |
| --- | ---: | ---: |
| $0.005 | 3,000 | $15.00 |
| $0.010 | 3,000 | $30.00 |
| $0.020 | 3,000 | $60.00 |

## Monthly budget for 100 users

| USD per credit | 28 days | 30 days | 31 days |
| --- | ---: | ---: | ---: |
| $0.005 | $420.00 | $450.00 | $465.00 |
| $0.010 | $840.00 | $900.00 | $930.00 |
| $0.020 | $1,680.00 | $1,800.00 | $1,860.00 |

## If you keep 1 credit = $0.01

- Daily budget: `$30.00`
- Monthly budget (28 days): `$840.00`
- Monthly budget (30 days): `$900.00`
- Monthly budget (31 days): `$930.00`

## Optional safety buffer

To reduce risk from usage spikes, reserve +20% to +30%.

- 30-day month at $0.01/credit:
- Base monthly budget: `$900.00`
- With +20% buffer: `$1,080.00`
- With +30% buffer: `$1,170.00`

## Suggested starter paid plan (500 credits)

Based on your observed run in trace (`$0.1027`) and current credit logic (heavy models often starting near `2 credits/run` before long-output/tool adders):

- Estimated cost per credit: `$0.1027 / 2 = $0.05135`
- Estimated internal cost for 500 credits: `500 * $0.05135 = $25.68`

Suggested launch price:

- `500 credits = $49` (good starter)
- `500 credits = $59` (safer margin)

Pricing formula:

- `plan_price = (avg_cost_per_credit * credits_in_plan) / (1 - target_margin)`

Reference table for 500 credits at `$0.05135` cost/credit:

| Target margin | Price |
| --- | ---: |
| 50% | $51.35 |
| 60% | $64.19 |
| 70% | $85.58 |

Note:

- Recalculate monthly from real production data using a 30-day average `cost_per_credit`.
