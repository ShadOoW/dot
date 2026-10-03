---
name: ui-legibility
description: |
  How to run a legibility and readability pass over a screen that is already built and
  behaviourally correct: type size, contrast, truncation, focus, and the one visual affordance
  that a dense layout always lacks. The pass is entirely measurable, so the method is a
  measure-decide-remeasure loop with a census taken before anything is touched — not a reading
  of screenshots. Carries the three DOM probes, the decision rules that keep a fix inside the
  design system, the CSS traps that silently defeat clamping and focus measurement, and the
  report contract that makes "more readable" checkable.
  Use when a layout, table, dashboard or dense screen is functionally done and the next step is
  making it readable; when a ticket says legibility, readability, polish, contrast, WCAG, AA,
  accessibility of text, truncation, ellipsis or "hard to read"; when text is clipped, cramped
  or too small; when about to claim a UI is more readable than it was; and when deciding whether
  a truncation should be a clamp, a tooltip, a shorter string or a wider column.
---

# The legibility pass

A legibility pass has one property that separates it from every other UI task: **every claim in
it is a number.** Font size is a number, contrast is a ratio, clipping is `scrollWidth >
clientWidth`, fit is a bounding box. There is no taste argument until the numbers are in.

So the failure mode is not bad taste. It is **an agent that looks at a screenshot, changes six
`sx` blocks, and reports "improved readability"** — unfalsifiable, unreviewable, and usually
wrong in at least one place it did not look. The method below exists to make that impossible.

The second failure mode is subtler and costs more: **arithmetic standing in for measurement.**
"12 px × 26 characters ≈ 219 px, so it won't fit" is a guess wearing a number's clothes. Real
text has kerning, letter-spacing, a text-transform and a font that may not be the one you think.
Measure the element. See "Trap 3".

## The loop

    1. census      → baseline, before touching anything, split by ownership
    2. decide      → variant + token, inside the design system
    3. change
    4. re-census   → same probe, same page state
    5. screenshot  → for anything a number cannot show (ellipsis, hierarchy, affordance)
    6. report      → before/after table; every survivor justified in one line

Steps 1 and 4 must run the **same probe on the same page state**, or the delta means nothing.
Save the probe to a file and re-run it; do not retype it, and do not "improve" it between runs.

### 1. Census first — and split it by ownership

Take the baseline **before the first edit**. Two reasons, both learned the expensive way:

- A number from a previous session was measured on different data. If you inherit "93 nodes at
  10 px" and measure 104, you have not regressed anything — you are looking at a different week,
  a different tenant, a different fixture. Re-baseline and say so.
- Without a baseline you cannot tell a survivor from a thing you broke.

**Split every count by zone**, where a zone is a region of the screen with a distinct owner —
another component, another ticket, a shared wrapper you are not allowed to touch. A pass that
reports "104 → 48 at 10 px" reads like a partial job. The same pass reporting "56 of the 104 were
mine, and all 56 are fixed; the other 48 are one component owned by another ticket, here are
their measurements" is complete, and it hands the next agent their work already measured.

Zones come from a selector map you write per screen, e.g. `{ header: '.grid-header', card:
'[data-slot-card]', axis: '.grid-pinned' }`. Five minutes of selector work turns an ambiguous
report into a boundary.

### 2. Decide inside the design system

The levers, in order of preference:

1. **Variant** — pick the next step up the type scale. Never write `fontSize`.
2. **Token** — pick a colour that already exists. Never write a hex.
3. **String** — a label that only fits at 10 px is too long; shorten it.
4. **Clamp or tooltip** — for content you cannot shorten.
5. **Geometry** — column widths and row heights are usually a product decision that predates
   you. Changing one is an escalation, not a fix. Say so and ask.

The project's design system outranks this file on which token and which variant — its own skill
if it has one (in `/data/code/fleet` that is `ui`). This file only says _how to know_ you need one.

**One secondary colour, chosen for the worst background it can land on.** A grey that passes on
white will fail on a tinted row, a hover state, or a highlighted column — and you will not notice
because you only measured the white case. Enumerate every background the text can sit on, pick
the one colour that clears the threshold on all of them, and use it everywhere. The alternative
is a per-context colour matrix nobody maintains.

## The three probes

In `references/probes/`. Each is a bare arrow function for
`playwright-cli -s=<session> --raw eval "$(cat probe.js)"`; adapt the root and zone selectors at
the top. They ship with an MUI data grid's selectors because the pass they survived was over
one; they are an example to retarget per screen, not a default.

| Probe         | Answers                                                                  | Watch for                                                          |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `census.js`   | how many text nodes at each size, how many clipped, by zone              | it only means something for `noWrap` text — see Trap 2             |
| `contrast.js` | measured ratio of every distinct (colour, background, size, weight) pair | must blend through **ancestors**, not read the declared background |
| `fit.js`      | does this string fit, and how much headroom                              | find the real ceiling by growing the element, not by arithmetic    |

### Contrast is not the declared background

`getComputedStyle(el).backgroundColor` on a text node's parent is almost always
`rgba(0, 0, 0, 0)`. The colour behind the text is whatever the nearest painted ancestor is, and
it may be a semi-transparent overlay composited onto another. `contrast.js` walks the ancestor
chain and alpha-composites it. Anything simpler reports the ratio against white and passes text
that is unreadable on a tinted row.

Thresholds: **4.5:1** for body text, **3:1** for text ≥ 18.66 px bold or ≥ 24 px, **3:1** for
graphical objects and UI component boundaries that carry meaning. A 1 px rule and a 3 px rule
have the same ratio — thickness never helps contrast.

## Traps that cost a session each

**Trap 1 — a clamped element that is a flex item never clamps.** `display: -webkit-box` on a
direct child of a flex container is blockified (Chrome computes `flow-root`), so
`-webkit-line-clamp` silently does nothing and the text overflows its row. Wrap the clamped
element in a plain block box. Also set `whiteSpace: 'normal'` explicitly — table and grid cells
commonly set `nowrap`, and it inherits.

**Trap 2 — `scrollHeight > clientHeight` is what a _working_ clamp looks like.** `clientHeight`
is pinned to N lines; `scrollHeight` is the full unclamped layout. Judge a clamp by
`clientHeight` staying constant across a short and a long string, and confirm the ellipsis in a
screenshot. The clipping census only means something for single-line `noWrap` text.

**Trap 3 — `clientWidth` on a shrink-to-fit element is its content, not its ceiling.** A
`noWrap` inline element sizes to its text until it hits the container, then pins and clips.
Reading `clientWidth: 135` and concluding "135 px available" is backwards. Find the real ceiling
empirically: append one character at a time to the **live element** until `scrollWidth >
clientWidth`, and report the transition. Headroom is `ceiling − measured`, and both come from the
DOM.

**Trap 4 — `.focus()` is not `:focus-visible`.** Programmatic focus does not set the
focus-visible heuristic, so a control that shows a perfectly good ring under `Tab` measures as
having none. Drive real key presses. And read the computed style **while the element is actually
focused** — `document.activeElement === el` — because the unfocused computed value of `outline`
can be a declared width with `outline-style: none`, which looks damning and means nothing.

**Trap 5 — the census counts other people's components.** Before reporting a survivor, know who
owns it. Before fixing one, know whether you may.

## What a legibility pass must not do

- **Not widen a column or grow a row** to make text fit, unless geometry is explicitly yours.
  Fix inside the geometry: variant, weight, colour, clamp, tooltip, shorter string.
- **Not restyle a component another ticket owns**, however bad its numbers are. Measure it, write
  the measurement into that ticket, leave it.
- **Not add a token, a palette entry or a scale step** for one screen.
- **Not smuggle in an unrelated accessibility fix** because it is "one line". A shared theme or
  wrapper change touches every screen in the product. Report it and let someone own it.
- **Not silently overturn a settled decision.** If the measurement contradicts a decision the
  team already made, the finding is the deliverable — state the number, state that the earlier
  justification was wrong, and make the revert cost explicit. Then let a human choose.

## The report contract

Nothing here is optional; all of it is cheap once the probes have run.

1. **A before/after table** of the census, split by zone.
2. **Every survivor justified in one line** — who owns it, or why it stays.
3. **Every colour you changed, with its measured ratio** over its real background. Name the
   token, not the hex.
4. **Screenshots** for what numbers cannot show: the ellipsis, the new affordance, the hierarchy.
5. **Every judgement call named** — a shortened string, a dropped qualifier, an approximation, a
   declined item, a contradicted assumption. An unstated approximation reads as a bug to the next
   reviewer and as done to the next agent.
6. **Any measurement you inherited and found wrong**, corrected in the document that carried it.
   A wrong number in a brief costs every future session that reads it.

## Re-run the pass; do not write tests for it

This pass is meant to be run **many times** — after every layout change, on every screen, by
whoever is holding the ticket. Repetition is the mechanism. A pinned assertion is not.

- **No snapshot or golden test.** A legibility census is a function of the _data on screen_:
  a different week, tenant or fixture changes the node count without anything regressing. A
  test that pins 130 nodes fails on Tuesday and gets deleted by Thursday.
- **No CI gate on the ratios either**, until a screen has been through the pass at least twice
  and its zone selectors have stopped moving. A gate written on the first pass encodes a
  boundary nobody has confirmed yet.
- **What makes the next run cheap is the record, not a test**: the zone selector map, the one
  secondary colour that cleared every background, and the survivors with their owners. Put
  those where the next agent reads them — the project rulebook for what always holds, the
  ticket brief for what was measured — and the second pass starts from numbers instead of
  from scratch.
- **Re-running is safe and cheap by construction.** Every probe is read-only apart from
  `fit.js`, which mutates one element's text and restores it; check its `restored` field. Two
  runs on an unchanged screen must produce identical counts — if they do not, the page state
  differed, and the delta you were about to report is noise.

## Related

- `web-verify`, `playwright-cli` — how the browser session and the screenshots happen.
- the project's design-system skill, if it has one (fleet: `ui`) — it outranks this file on
  tokens, variants and components.
