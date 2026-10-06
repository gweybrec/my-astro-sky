Proposed — not in the code. The phone counterpart of the desktop confirmation dialog (`.dialog` in `src/style.css`, built by `src/photo-delete-confirm.ts`): a card centred over a dimmed screen that asks one question and has two answers.

## Use

`.mob-dialog` over a `.mob-scrim`. Anatomy: `.mob-dialog-title` (`m-title`, `text-primary`), `.mob-dialog-message` (`m-body`, `text-secondary`) and `.mob-dialog-buttons`, two equal columns 8px apart: cancel on the left (a plain `.mob-btn.mob-btn--lg`, label "Annuler", `gallery.cancelEdit`) and the destructive confirm on the right (`.mob-btn.mob-btn--danger-fill.mob-btn--lg`, the desktop's `btn-danger`). It is 16px from each screen edge (`mobile-gutter`), has 16px of padding, `bg-deep`, `border-panel`, `mobile-card-radius`, and is centred on the screen both ways without a transform. Both buttons are 56px high and may wrap their label onto two lines; they never overflow.

**Every delete on the phone goes through this dialog**: a plan, a plan entry, a photo, a setup, a frame, an observation window, a region, a point of interest on the sky map and all data. A delete is never a bare button that acts at once. Wording is the desktop's (`photo-delete-confirm.ts`): the title is the name of the action, the message asks the question with the name of the item between « and », the confirm button repeats the action ("Supprimer le plan", "Supprimer", "Retirer ...").

## You supply

- The title, message and confirm label through `t('...')` (the desktop keys: `targets.plan.delete` and `targets.plan.confirmDelete` for a plan, `photos.deleteConfirmTitle`, `photos.deleteConfirmMessage` and `photos.deleteConfirmAction` for a photo, `fovOverlay.deleteSetupTitle` and `fovOverlay.deleteSetupConfirm` for a setup, `targets.skyRegion.deleteConfirmTitle` and `.deleteConfirmMessage` for a region, `fovOverlay.deleteFrame` and `fovOverlay.deleteFrameConfirm` for a plan entry); `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby` and `aria-describedby`.
- The behaviour: Cancel and a tap on the scrim answer no (there is no Escape key on a phone); the first focus is on Cancel for an irreversible delete.

## States

- Cancel: plain `.mob-btn` (label 14.35:1 on `bg-deep`). Confirm: `btn-danger-bg` fill, `btn-danger-border`, label `btn-danger-text` (9.24:1); pressed `btn-danger-bg-hover`; disabled .4.
- The scrim is `bg-overlay`; the dialog is above it (`z-toggle`) and above the screen's floating controls.

## Do / Don't

- Do keep the question in one or two lines and the two buttons side by side, equal.
- Do use the danger fill only for the confirm of a delete; a non-destructive confirmation uses `.mob-btn--confirm` and an action uses `.mob-btn--action`.
- Don't put a delete in a sheet footer or a row without this dialog, and don't offer "Don't ask again".
- Don't use it for the removal of a line inside a form (a field, an integration row, a chip): that is an edit, undone by Cancel.
