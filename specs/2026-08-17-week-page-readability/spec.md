# Atlas Week page readability

## Problem

The Week page becomes unreadable on desktop because seven day columns compress
cards to roughly one word per line. Context and risk items incorrectly report
missing linked actions, dated context is duplicated in the supporting section,
and small text plus repeated summaries make the page difficult to scan.

## Requirements

- Use one column on phones, two on tablets, and three readable columns on
  desktop.
- Treat unlinked `context` and `risk` items as valid notes.
- Show a missing-source warning only when an item actually has a
  `source_action_id` whose action cannot be loaded.
- Make the weekly item title the primary card heading and the canonical action
  a secondary source link.
- Do not repeat dated context in the bottom Context section.
- Collapse secondary supporting material in read mode.
- Keep body text at a readable size and preserve long-title wrapping.
- Add accessible labels to all Week editor controls.
- Preserve the current weekly planning, editing, review, and publication flows.

## Verification

- Component regression tests cover valid unlinked context, true missing links,
  and duplicate suppression.
- App tests, worker tests, typecheck, contract validation, and production build
  pass.
- Local desktop and mobile browser checks show readable cards without
  horizontal overflow.
