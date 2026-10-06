A bordered, tinted row that reflects the state of an asynchronous operation (reading, success, error, warning), used by the WCS companion panel and the auto-solve flow.

## Use

- `wcs-status` with one modifier: `wcs-status--info` (blue, reading or processing), `--success` (green), `--error` (red), `--warning` (amber, partial success or mismatch). The base gives margin, padding, `radius-sm` and 12px text.
- `status-info`, `status-success`, `status-error`, `status-warn` are colour-only shortcuts (fill, border, text from the `status-*` tokens) for banners that bring their own padding.

Info is blue on purpose in every theme (`wcs-info-*`: a scientific-instrument colour); the `status-info-*` trio follows the theme.

## You supply

- The message with its state word or glyph: a status is never colour alone ("✓ Résolution réussie", "Résolution échouée").
- The modifier class. Set the **full** `className` on every transition (`'wcs-status wcs-status--info'`), never `classList.add`, so no stale modifier accumulates.
- Hiding: add `hidden` and clear the row's content before the next operation.

## States

| State      | Fill                | Border                  | Text                  |
| ---------- | ------------------- | ----------------------- | --------------------- |
| Info (wcs) | `wcs-info-bg`       | `wcs-info-border`       | `wcs-info-text`       |
| Success    | `status-success-bg` | `status-success-border` | `status-success-text` |
| Error      | `status-error-bg`   | `status-error-border`   | `status-error-text`   |
| Warning    | `status-warn-bg`    | `status-warn-border`    | `status-warn-text`    |

## Do / Don't

- Do put an inline spinner (`auto-solve-spinner`) before the text while an operation runs.
- Do keep one status row per operation.
- Don't use a status row for form validation (`input-error`) or for transient feedback (`Toast`).
- Don't tell success from error by hue alone: keep the glyph or the word.
