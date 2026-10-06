The rotating ring that shows loading: `accent-fill-md` ring, `spinner-active` leading arc, one shared `loading-spin` keyframe.

## Use

| Class                | Size           | Use                                                            |
| -------------------- | -------------- | -------------------------------------------------------------- |
| `loading-spinner`    | 36px, 3px ring | App startup overlay                                            |
| `targets-spinner`    | 36px, 3px ring | Targets view loading state (centred, with a `space-13` margin) |
| `auto-solve-spinner` | 12px, 2px ring | Inline with solver status text                                 |

For content loaded asynchronously in a modal, wrap an inline spinner and its text in `.modal-loading-placeholder`; show `.modal-loading-error` on failure. Never use a bare spinner class without a wrapping placeholder.

## You supply

- A text next to or below the spinner through `t('...')` ("Chargement…", "Chargement du catalogue stellaire…").
- `role="status"` and an `aria-label` for a spinner that stands alone.
- Removal: replace the placeholder with the result or the error element on completion.

## States

A spinner has one state: it turns, 0.8s per revolution, linear and infinite. There is no disabled or paused look. The arc colour is `spinner-active`, which is also the keyboard focus-ring colour.

## Do / Don't

- Do keep the ring colours on tokens; they follow the active theme.
- Do pair every spinner with a text a screen reader can read.
- Don't restyle a spinner inline or change its speed.
