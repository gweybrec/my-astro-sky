# UI Guidelines — Layout, Patterns & Known Issues

> ← Back to [UI Guidelines](../ui-guidelines.md) · see also [Design Tokens](tokens.md) · [Component Catalog](components.md)

---

## 3. Layout Patterns

- **Side panel:** fixed width `var(--panel-width)` (280 px), outer padding `var(--space-8)`.
- **Section gap:** `var(--space-7)` (16 px) between sidebar sections.
- **Component inner gap:** `var(--space-4)` (8 px) between sibling elements inside a component.
- **Modal size:** max-width 960 px / 90 vw; max-height 85 vh.
- **Modal header padding:** `var(--space-7)` (16 px) vertical, `var(--space-8)` (20 px) horizontal.

---

## 4. Panel Labels & Row Utilities

| Class                         | Description                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| `.display-controls-mag-row`   | Flex row for any labelled control (slider, value) inside the panel |
| `.display-controls-mag-label` | Label span inside a `.display-controls-mag-row`                    |
| `.dso-toggle-label`           | `<label>` wrapping a checkbox row inside a panel                   |

Use `display-controls-mag-row` + `display-controls-mag-label` for **any** new labelled
control row in the side panel.

---

## 5. Input Hints

**Never use `placeholder` for example values or default paths.** Placeholders look like real
content and confuse users into thinking the field is already filled.

**Do:** set the `title` attribute on both the `<label>` and the `<input>`:

```ts
lbl.title = 'Full path to the astap_cli binary. Example: /opt/astap/astap_cli';
input.title = 'Full path to the astap_cli binary. Example: /opt/astap/astap_cli';
```

The browser's native tooltip appears on hover — no extra element needed.

---

## 6. Known Issues

Live design-debt only. Address each when you next touch the relevant component; do not batch into
one giant refactor. Historical items resolved by the CSS-token sweep and the `uno.config.ts`
shortcut migration have been removed — the git history holds them if needed.

| #   | Issue                                                          | Action                                                                                                                                                                                 |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Legacy button aliases still coexist with the `btn-*` shortcuts | Migrate call-sites off the bespoke classes listed in [Buttons](components.md) §2.1 to `btn-action` / `btn-confirm` / `btn-cancel` / `btn-danger` / `btn-icon`, then delete the aliases |

> Found a new inconsistency? Add a row here **and** fix it or note the file, so this list stays a
> short, honest record rather than growing into another stale backlog.
