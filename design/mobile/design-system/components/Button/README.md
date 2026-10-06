The four text-button roles of MyAstroSky: amber action, green confirm, dim cancel and red danger, each a plain CSS class on a `<button>`.

## Use

| Role    | Class         | Use for                                                                                           |
| ------- | ------------- | ------------------------------------------------------------------------------------------------- |
| Action  | `btn-action`  | Panel primary action, open map, trigger the solver. Add `btn-action--full` to span the container. |
| Confirm | `btn-confirm` | The main positive action of a modal footer.                                                       |
| Cancel  | `btn-cancel`  | Dismiss or go back, next to a confirm.                                                            |
| Danger  | `btn-danger`  | The sole destructive choice of a confirmation dialog.                                             |

Pick the role by intent and use the class as is. Do not invent a fifth variant: compact panel controls are the ghost button (`display-controls-btn`, not built here) and per-item icon controls are `IconButton`.

## You supply

- A `<button>` with the class and a label. Labels are short verbs from `t('...')`, never hard-coded: "Valider", "Annuler", "Supprimer", "+ Ajouter des photos".
- `disabled` for the disabled state. Do not fade a button with opacity yourself.
- In a modal footer, put cancel then confirm, right-aligned, in `.modal-footer` (or two equal columns in `.modal-footer-grid2`).

## States

- Rest and hover: hover moves the fill (`accent-bg` to `accent-bg-hover`, `btn-confirm-bg` to `btn-confirm-bg-hover`, `btn-danger-bg` to `btn-danger-bg-hover`). On hover the danger label becomes `btn-danger-hover-text`.
- Disabled: action 50% opacity, confirm / cancel / danger 40%.
- Keyboard focus: 2px solid `spinner-active` ring with a 2px offset (app rule `button:focus-visible`).
- The label of `btn-action` is `text-bright` on `accent-bg`; on hover it falls under 4.5:1 in some themes (see Contrast flags in the brand book).

## Do / Don't

- Do use `btn-action--full` for the single button of a side-panel section.
- Do keep one primary button per surface.
- Don't change padding, radius or colour inline; they come from `--space-*`, `--radius-md` and the button tokens.
- Don't use `btn-danger` for a per-item delete: that is `btn-icon--danger` with the trash icon.
- Don't use these desktop buttons on the mobile layer: all four are 41px high, under `mobile-touch-min`.
