# Design System

**Direction:** premium financial infrastructure × institutional decision tooling × modern
developer infrastructure. The interface explains the system; it does not decorate it.
Premium comes from type, alignment, density and restraint — not effects.

## 1. Rules

Do: hairline rules, tabular numerals, left-aligned text, right-aligned numbers, visible
provenance for every value, one accent colour, dense but breathable tables.

Never: gradients, glow, blobs, glassmorphism, blur, large radii, drop shadows, robot or
neural imagery, 3D ornaments, emoji, decorative animation, pill overload, fake charts or
numbers, testimonials, partner logos, TVL or user counts.

## 2. Typography

| Role | Family | Notes |
|---|---|---|
| UI / text | **IBM Plex Sans** (400, 500, 600) | via `next/font/google` |
| Data / hashes / numbers | **IBM Plex Mono** (400, 500) | `font-variant-numeric: tabular-nums` |

| Token | Size / line | Use |
|---|---|---|
| `display` | 32 / 40, 500, −0.01em | page title (one per page) |
| `h2` | 20 / 28, 500 | section titles |
| `h3` | 15 / 22, 600 | panel titles |
| `body` | 14 / 22, 400 | default |
| `small` | 12 / 18, 400 | captions, meta |
| `label` | 11 / 16, 500, uppercase, +0.06em | column heads, field labels |
| `mono` | 13 / 20 | values, hashes |

Hashes display as `0x3f9a…c21e` (6+4) with copy on click and full value on hover.

## 3. Colour

Paper and ink, one accent (oxide), semantic colours used only for state.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F6F2` | `#0F1011` | page |
| `--surface` | `#FFFFFF` | `#16171A` | panels, tables |
| `--surface-2` | `#EFEDE7` | `#1D1F22` | table header, code |
| `--ink` | `#16171A` | `#ECEAE4` | primary text |
| `--ink-2` | `#55575C` | `#A2A39F` | secondary text |
| `--ink-3` | `#8A8B8F` | `#6E6F72` | tertiary, disabled |
| `--rule` | `#DEDBD3` | `#2A2C30` | hairlines, borders |
| `--accent` | `#B4501E` | `#E07A45` | primary action, focus, selected |
| `--pass` | `#1F6B45` | `#4FB283` | threshold passed, correct, verified |
| `--fail` | `#A8321E` | `#E2705C` | failed, wrong, mismatch |
| `--wait` | `#8A6A12` | `#D2AE4A` | pending, escalated |

Fork colours are **not** semantic rainbow; forks are identified by label and a 4-step
ink ramp (`NO_ACTION` lightest → `DEPLOY` darkest) so support bars stay neutral.

Theme via CSS variables on `:root` and `[data-theme="dark"]`, defaulting to system.

## 4. Space, grid, shape

- 4 px base: 4, 8, 12, 16, 24, 32, 48, 64.
- Content max width 1200 px; 12-column grid, 24 px gutters; 16 px side gutter on mobile.
- Radius: 2 px (inputs, buttons), 0 for panels/tables. Borders 1 px `--rule`. No shadows.
- Focus: 2 px `--accent` outline, offset 2 px.

## 5. Motion

Only state change: 120 ms opacity/colour for status updates; lifecycle rail step fills
when its tx confirms. No looping animation except a 1 px progress line during pending tx.
Respects `prefers-reduced-motion`.

## 6. Primitives (`web/components/ui/`, shadcn-style, restyled)

`Button` (primary = ink bg, secondary = outline, link) · `Table` · `Tabs` (underline) ·
`Tooltip` · `Dialog` · `Field/Label` · `Code` · `Hash` · `Amount` (MON, 4 dp) ·
`Timestamp` (absolute UTC + relative) · `Status` (small caps text + 6 px square marker, not a pill).

## 7. Domain components

| Component | Shows |
|---|---|
| `LifecycleRail` | 7 statuses horizontally; each step: time, block, tx link; current step in accent |
| `StateTable` | every state input: key, value, unit, source, observed at, status; unavailable rows explicit |
| `QuestionList` | numbered questions verbatim, assigned agents, rubric expandable |
| `DecisionMatrix` | rows = agents, cols = choice, score, probability, weight, reason (expand), tx; rows for MISSED agents stay visible |
| `BatchView` | agent × question grid; each cell expands to the full Jev answer + Merkle proof status |
| `SupportBars` | weighted support per fork from `getAggregation`, threshold drawn as a vertical rule; numbers printed beside bars |
| `ThresholdVerdict` | the three gates (quorum, share, score) each with value vs. requirement |
| `ActionRecord` | executed fork, amount moved, bucket balances before/after, start price |
| `OutcomeRecord` | start/end price with publish times, move bps, band, correct fork |
| `SettlementTable` | per agent: result, lock, penalty, reward, bond after |
| `IntegrityPanel` | every hash: on-chain vs. recomputed, VERIFIED / MISMATCH / UNAVAILABLE |
| `Unavailable` | `—` plus reason on hover; never a placeholder number |

Charts are only drawn from real series (support bars, bond history per agent). No chart
appears where there is no data yet; an empty state explains what will fill it.

## 8. Page skeletons

- **`/`** — header strip (network, block height, contract status), latest decision summary
  (status rail + verdict + outcome), vault buckets, agent standings table.
- **`/demo`** — left column: step list with live status and tx links; right: the current
  stage's detail component. One primary button that advances only when the chain allows.
- **`/decisions/[id]`** — anchored sections in lifecycle order: State → Questions →
  Decisions → Aggregation → Action → Outcome → Settlement → Integrity.
- **`/how-it-works`** — the pipeline as a typeset vertical sequence with one sentence and
  one real example value per stage (linked to a real decision).

## 9. Voice

Short, declarative, technical. "Threshold not met: 54.2 % support for DERISK, 60.0 % required."
Not: "Our AI agents couldn't agree!". No exclamation marks.
