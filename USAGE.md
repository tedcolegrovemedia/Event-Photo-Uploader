# AI Usage, Cost, and Environmental Footprint

This document estimates the compute resources consumed while building Event Uploader with Claude Code between 13 August and 15 September 2026.

Token figures are **measured**: they come from the six Claude Code session transcripts stored for this project, deduplicated by API message id. Cost figures apply Anthropic's published list prices to those tokens. Environmental figures are **estimates** with a stated range, because Anthropic does not publish per-token energy data.

## Summary

| Metric | Value |
|---|---|
| Total billed tokens | ~71.3 million |
| Output tokens (including thinking) | 391,540 |
| API calls | 431 |
| Sessions | 6 across 3 working days |
| Active model time | ~6 hours |
| Cost at API list price | $53 to $60 |
| Electricity (estimate) | 0.6 to 3.6 kWh |
| CO2e (estimate) | 0.24 to 1.45 kg |
| Water (estimate) | 0.9 to 5.4 L |

## Token usage

| Bucket | Claude Opus 5 (13 Aug) | Claude Fable 5.1 (2 and 15 Sep) | Total |
|---|---|---|---|
| Output tokens (incl. thinking) | 210,636 | 180,904 | 391,540 |
| Fresh input + cache writes | 599,586 | 578,828 | 1,178,414 |
| Cache reads | 43,331,985 | 26,386,505 | 69,718,490 |
| API calls | 269 | 162 | 431 |

Cache reads are 98% of the volume. This is the normal shape of agentic coding: every tool call resends the whole growing conversation, and prompt caching reprices the repeated prefix at a tenth or less of the base input rate.

### Sessions

| Session start | Model | User messages | API calls |
|---|---|---|---|
| 2026-08-13 13:39 | Opus 5 | 9 | 408 raw / ~200 unique |
| 2026-08-13 15:00 | Opus 5 | 9 | 56 raw |
| 2026-08-13 22:58 | Opus 5 | 1 | 28 raw |
| 2026-09-02 17:01 | Fable 5.1 | 14 | 194 raw |
| 2026-09-15 13:18 | Fable 5.1 | 9 | 219 raw |
| 2026-09-15 19:21 | Fable 5.1 | 1 | 5 raw |

Raw call counts include one transcript line per content block, so they overstate unique API calls. The deduplicated totals above are the reliable figures.

## Cost at Anthropic list price

Rates used (per million tokens):

| Model | Input | Output | Cache write (1h TTL) | Cache read |
|---|---|---|---|---|
| Claude Opus 5 | $5.00 | $25.00 | $10.00 | $0.50 |
| Claude Fable 5.1 | $10.00 | $50.00 | $20.00 | $0.25 |

| | Opus 5 | Fable 5.1 | Total |
|---|---|---|---|
| Output | $5.27 | $9.05 | $14.32 |
| Cache writes (1-hour TTL) | $5.96 | $11.47 | $17.43 |
| Cache reads | $21.67 | $6.60 | $28.27 |
| Fresh input | $0.02 | $0.05 | $0.07 |
| **Total** | **$32.91** | **$27.16** | **$60.08** |

With the 5-minute cache TTL (1.25x write multiplier instead of 2x) the total is $53.54.

The work was done through a Claude subscription in the desktop app, so these figures represent the API-equivalent value of the compute rather than an out-of-pocket amount.

## Environmental impact

Anthropic does not publish per-token energy figures. The range below is built from public estimates for frontier-model inference and should be read as order-of-magnitude.

Assumptions:

- 0.5 to 3.0 Wh per 1,000 output tokens (decode is the expensive phase)
- One tenth of that per 1,000 fresh input tokens (prefill is far cheaper per token)
- One hundredth of that per 1,000 cache-read tokens
- 0.4 kg CO2e per kWh (approximate US grid average, location-based)
- 1.5 L water per kWh (on-site cooling plus off-site generation)

| Scenario | Electricity | CO2e | Water |
|---|---|---|---|
| Low | 0.6 kWh | 0.24 kg | 0.9 L |
| Mid | 1.8 kWh | 0.72 kg | 2.7 L |
| High | 3.6 kWh | 1.45 kg | 5.4 L |

For scale, the mid case is roughly the energy of running a gaming PC for 3 to 6 hours, or driving a gasoline car about 3 km.

Excluded: the developer's laptop power during the sessions, amortized model training energy, and datacenter overhead beyond a typical PUE.

## Caveats

- Only sessions stored under this project's Claude Code directory were counted. Work done in another folder before the repository was set up here is not included.
- Token counts are exact as logged by the API. Pricing comes from Anthropic's published model reference.
- The energy figures are the weakest link. Credible published estimates disagree by 5x or more, which is why a range is given rather than a point value.

## Method

1. Parsed every `.jsonl` transcript in the project's Claude Code session directory.
2. Summed `usage` fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) per model, keeping only the first occurrence of each API message id.
3. Applied list prices per token bucket.
4. Applied per-token energy factors, then grid carbon intensity and water intensity.

*Generated 2026-09-15.*
