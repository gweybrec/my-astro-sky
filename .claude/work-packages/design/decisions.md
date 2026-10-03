# Design and scope decisions (made by the user)

One line per decision, with the date. Cards and design rounds must follow these.

| Date       | Topic              | Decision                                                                                                                                                                                           |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | Keyboard shortcuts | **Not on mobile.** The 22 desktop shortcuts are dropped. Where a key is today the _only_ way to do something (Escape to cancel or close), mobile needs a visible control — see D1.                 |
| 2026-10-03 | tokens.css         | **Wire it in.** Move the tokens out of `src/style.css` into `src/styles/tokens.css`, import it, and end with **no duplicate**: one `:root` token block, in `tokens.css` only. Done by card WP0.D2. |
