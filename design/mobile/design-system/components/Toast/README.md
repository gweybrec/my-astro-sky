The brief, auto-dismissing message for asynchronous feedback: save succeeded, import done, solver error, undo offer.

## Use

Call `showToast(message, type)` from `src/toast.ts`; it renders `.toast` inside `#toast-container`, fixed at the bottom centre. Classes: `toast` (neutral), `toast-error` (`card-status-failed` border, `btn-danger-hover-text` text), `toast-warning` (`status-warn-*`), `toast-undo` (`border-accent`) with a `.toast-action` button for "Annuler".

Use it for async feedback only. Inline form validation is `input-error` plus `input-error-msg`, never a toast.

## You supply

- The message string through `t('...')`, with placeholders filled: "« M31_2024.jpg » supprimée".
- For an undo toast, the action label and handler; the undo window is 5 seconds.
- Nothing about position or timing: the container and the fade-out (`toast-fade-out`) handle both.

## States

- Enter: slides up 10px and fades in over 0.25s; exit fades out over 0.3s.
- Types: neutral, error, warning, undo. There is no success colour; success is the neutral toast.
- Box: `bg-deep`, `border-panel`, `radius-lg`, 13px `text-secondary`, padding `space-5` by `space-7`.

## Do / Don't

- Do keep messages to one line.
- Do pair a destructive action with an undo toast when it can be undone.
- Don't use a toast for something the user must act on; use a dialog.
- Don't stack more than a few toasts; the container stacks them with a `space-4` gap.
- On mobile, raise the container above the tab bar (`mobile-tabbar-height` plus the bottom safe area).
