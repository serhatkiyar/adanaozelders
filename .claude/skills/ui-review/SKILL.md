---

name: ui-review
description: Visually review meaningful frontend changes against the Adana Özel Ders design system using the running application. Use after frontend UI changes and before declaring them complete.
---

# UI Review

Use this workflow after a meaningful frontend visual or UX change.

This is a visual verification workflow. A passing build, test suite or typecheck is not sufficient evidence that the UI is correct.

## Before review

Read:

* `/CLAUDE.md`
* `/frontend/CLAUDE.md`
* `/docs/DESIGN.md`
* `/docs/UI-ISSUES.md` if it exists

Understand which DESIGN.md rules are:

* [E] Established
* [R] Recommendation
* [I] Inconsistency

Established rules have priority.

Do not silently enforce recommendations as if they were established product rules.

## Inspect the real UI

Run or use the existing development environment.

Inspect the actual affected route in a browser.

Prefer Playwright MCP when available. If it is unavailable, use the project's installed Playwright/browser tooling instead.

Review at minimum:

* desktop around 1440px
* mobile around 390px

When the changed surface is sensitive to intermediate widths, also inspect a relevant tablet/intermediate viewport.

Do not judge visual quality only from JSX, CSS or Tailwind classes.

## Evaluate

Review the changed surface for:

### Product consistency

* Does it follow established patterns in DESIGN.md?
* Does it look like the same product as surrounding Adana Özel Ders screens?
* Did the implementation invent a new visual language unnecessarily?

### Visual hierarchy

* Is the primary action immediately clear?
* Are headings, supporting text and secondary actions correctly prioritized?
* Is there unnecessary competition between elements?

### Layout

* alignment
* spacing
* whitespace
* density
* container widths
* overflow
* accidental wrapping

### Typography

* hierarchy
* size
* weight
* line height
* contrast
* unnecessary typography variants

### Surfaces

Look specifically for generic AI-generated patterns:

* unnecessary cards
* cards inside cards
* decorative containers with no structural purpose
* unnecessary brand-soft colored boxes
* excessive pills or badges
* gradients without a product reason
* arbitrary shadows
* arbitrary radius values
* emoji used as product UI icons
* decorative UI that adds no information or affordance

### Responsive behavior

Verify that mobile is deliberately designed rather than merely compressed desktop UI.

Check:

* navigation
* primary actions
* stacking
* touch targets
* horizontal overflow
* fixed/sticky elements
* modal/drawer behavior

### Accessibility

Check obvious issues including:

* keyboard accessibility
* visible focus where relevant
* contrast
* button/link semantics
* labels
* usable touch targets

## Compare with surrounding product

Inspect at least one nearby or equivalent existing product surface when useful.

Do not evaluate the changed component in isolation if its quality depends on consistency with neighboring screens.

## Independent review

After the implementation has been visually inspected, delegate a critique to the `ui-reviewer` subagent.

Give the reviewer:

* the affected route(s)
* what changed
* relevant screenshots if available
* the expected user goal

Do not tell the reviewer that the implementation is good or ask it to confirm your work.

Ask it to find problems.

## Respond to findings

Address meaningful NEEDS REVISION findings.

Do not mechanically implement reviewer suggestions that conflict with:

* established DESIGN.md rules
* product behavior
* accessibility
* explicit user requirements

After revisions, inspect the real UI again.

## UI issue tracking

Use `/docs/UI-ISSUES.md` as the persistent backlog for concrete unresolved frontend problems.

If the file does not exist and a real unresolved issue needs to be tracked, create it.

During every meaningful frontend review:

* If you discover a concrete user-visible UI/UX problem that is outside the current task scope and is not already tracked, add it to `docs/UI-ISSUES.md`.
* If the current task fixes an issue already listed there, remove it only after browser verification and reviewer PASS.
* If an issue changes but is not fully resolved, update the existing entry instead of creating a duplicate.
* If an issue can no longer be reproduced, remove it only after verifying the relevant route and viewport.
* Keep verification gaps separate from confirmed bugs.
* Do not add speculative problems.
* Do not add generic design recommendations.
* Do not duplicate DESIGN.md recommendations merely to create more backlog items.
* A DESIGN.md inconsistency should appear in UI-ISSUES.md only when it causes a concrete user-visible problem that still requires implementation work.
* Do not ask the user to manually maintain this file.

Organize `docs/UI-ISSUES.md` under:

* High
* Medium
* Low
* Verification gaps

Each issue should be concise and actionable and should include the affected route/component or viewport when known.

## Completion standard

A frontend task may be reported complete only when:

* the intended behavior works
* relevant code validation passes
* desktop visual inspection passes
* mobile visual inspection passes
* there are no known serious visual regressions
* meaningful reviewer findings have been resolved or explicitly explained
* `docs/UI-ISSUES.md` reflects any concrete unresolved problems discovered during the review

Report briefly:

* what changed
* what viewports/routes were visually verified
* whether the reviewer passed it
* which UI issue entries were added, updated or removed
* any remaining known visual risk
