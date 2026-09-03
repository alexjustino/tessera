# Design system

This is a contract, not advice. Every user-facing surface in Tessera obeys it, and a change
that diverges is corrected rather than merged.

The goal is narrow and demanding: Tessera should look like it belongs on Windows 11, not like a
web page inside a frame.

---

## 1. The one rule

> **A component never writes a raw value. If it is not a token, it does not exist.**

No hex colour, no pixel radius, no arbitrary duration, no one-off shadow in a component file.
The token layer is [`src/styles/tokens.css`](src/styles/tokens.css) and it is the only place a
value is decided.

If you need something the tokens do not offer, add it to the token layer with a reason —
do not approximate it locally. An approximation in one component is how a product stops looking
like one product.

## 2. Colour

Semantic values live under their own namespaces (`--surface-*`, `--fg-*`, `--stroke-*`,
`--accent-*`, `--state-*`) and are mapped into Tailwind's colour namespace by reference with
`@theme inline`. That indirection is what lets a theme change re-colour every utility at once
rather than freezing a literal into the compiled CSS.

**Light is the base definition on bare `:root`.** Nothing is defined _only_ inside a media
query — a token must always resolve. Dark is declared twice on purpose: once under
`prefers-color-scheme` for the system default, once under `[data-theme='dark']` so an explicit
choice wins in both directions.

### Surfaces, in the order Windows layers them

| Token      | What it is                                                 |
| ---------- | ---------------------------------------------------------- |
| `backdrop` | the Mica material — transparent, because Windows paints it |
| `layer`    | the content region floating on Mica                        |
| `card`     | an opaque element inside the layer                         |
| `flyout`   | Acrylic popovers, menus, the tray panel                    |

An opaque `body` background would cover the Mica material and undo the entire effect. It stays
transparent.

### The accent colour is the user's, not ours

`src/app/theme.ts` reads the Windows accent **ramp** from the host and writes it into the token
layer. Windows exposes a ramp rather than a single colour because the shade that reads well on
white does not read well on near-black: light themes take the base and darker steps, dark
themes the lighter ones. Re-apply the ramp whenever the theme changes.

When the system cannot be asked, the built-in default is used and `fromSystem` is `false` —
and the interface says so. It does not pretend.

### Severity is never colour alone

State (`info`, `success`, `caution`, `danger`) is carried by **colour and an icon and the
wording**. A red border alone is invisible to a large share of users. See `ui/InfoBar.tsx` for
the canonical shape.

Collection, category and calendar colours are validated for contrast **in both themes** before
being added.

## 3. Type

Segoe UI Variable with a declared fallback stack. The Fluent ramp:

`caption 12` → `body 14` (the product default) → `body-lg 16` → `subtitle 20` → `title 28` →
`display 40`

## 4. Space, radius, elevation

Spacing is the 4 px scale. Radius follows Windows 11 geometry: 8 px on the window, 4–6 px on
controls. Elevation has exactly four steps — `card`, `flyout`, `dialog`, `toast` — and a
component picks one rather than inventing a shadow.

**Density** is one attribute, two values: `comfortable` (default) and `compact`. Rows and
controls read `--density-row` and `--density-control`; they never hard-code a height. Changing
one attribute on `<html>` re-sizes the whole product.

## 5. Icons

**Fluent UI System Icons**, and only that set. Mixing icon families is immediately visible and
cannot be undone later without touching every screen.

- Sizes 16 / 20 / 24, matched to the control they sit in.
- `Filled` variants indicate an active or selected state; `Regular` otherwise.
- **An icon is never the only cue.** `IconButton` requires a `label`, which becomes both the
  accessible name and the tooltip. That requirement is in the type signature so it cannot be
  forgotten.

### The mark

The product's own icon is `src-tauri/icons/tessera.svg`: four tiles, one of them
lighter and a hair apart — the tessera being set. It is drawn to survive sixteen
pixels in the tray: four shapes, one accent, no stroke thinner than the gap
between tiles. The blue is the Windows 11 default accent, the value the token
layer starts from.

Every raster the platform needs is generated from that one file, never edited by
hand:

```bash
node -e "require('sharp')('src-tauri/icons/tessera.svg').resize(1024,1024).png().toFile('src-tauri/icons/tessera-1024.png')"
npx tauri icon src-tauri/icons/tessera-1024.png --output src-tauri/icons
```

The same file is `src/assets/mark.svg`, shown beside the name in the title bar
and on About, so the window, the tray, the installer and the screen all carry one
mark.

## 6. Motion

Fluent curves and durations, from the token layer: `--ease-easy`, `--ease-decelerate`,
`--ease-accelerate`; 100 / 150 / 200 / 300 ms. Motion connects states — a card that opens grows
from where it was — it does not decorate.

Loading shows a skeleton of the shape that is coming, not a spinner.

**`prefers-reduced-motion` is honoured globally**, in `global.css`, not per component. A
component cannot forget it. Nothing animates in a loop.

> A hard-won rule: check the **built** CSS, not just the source. A minifier that drops a
> prefix it does not understand can turn a conditional animation into an unconditional one from
> perfectly correct source.

## 7. Accessibility — WCAG 2.1 AA, without an asterisk

- Visible focus on every interactive element, in both themes. `:focus-visible` is styled
  globally; never remove an outline without replacing it.
- Full keyboard reach, including **dragging by keyboard** on the board and the calendar.
- Contrast verified in both themes, including accent-on-surface.
- Minimum target 32 px at comfortable density.
- Live regions for anything that changes without a click.

## 8. The canonical primitives

Everything lives in `src/ui/`. If a screen needs something that is not here, it is built here
first — not inline in the feature.

`Button` · `IconButton` · `SplitButton` · `Input` · `SearchBox` · `Select` · `Combobox` ·
`DatePicker` · `TimePicker` · `Checkbox` · `Radio` · `Toggle` · `Slider` · `Badge` · `Chip` ·
`Avatar` · `Card` · `Modal` · `ConfirmDialog` · `Drawer` · `Flyout` · `Tooltip` · `Menu` ·
`ContextMenu` · `CommandBar` · `TabStrip` · `Breadcrumb` · `ProgressBar` · `ProgressRing` ·
`Skeleton` · `EmptyState` · `Toast` · `InfoBar` · `Kbd` · `Resizer` · `VirtualList`

Present today: `Button`, `IconButton`, `Card`, `InfoBar`, `Input`, `Select`, `Checkbox`, `Chip`,
`Drawer`, `Modal`, `ConfirmDialog`, `ChoiceGroup`, `TabStrip`, `EmptyState`, `Kbd`. The rest arrive with the slice that first
needs them, and arrive _here_.

A shortcut shown beside the thing it triggers is a `Kbd`, everywhere — the palette, the rail,
Diagnostics, the capture window — so a person learns to read it once.

### Asking "are you sure"

`ConfirmDialog`, always. It names what will happen, the confirming button repeats the verb, and
a destructive action takes the danger tone — with the wording carrying the consequence too,
never colour alone. `window.confirm` is not themed, not keyboard-consistent, and blocks the
window's own event loop; it does not appear in this codebase.

## 9. The window

The window is drawn without system decorations so Mica runs behind the chrome and the command
surface shares the title strip, the way modern Windows applications are built. The three window
controls are ours, including Fluent hover behaviour: close turns red, the others take the
neutral hover.

Drag regions are marked with `data-tauri-drag-region`; interactive children inside them opt out
automatically via `global.css`.

**Known gap, tracked rather than hidden.** Snap Layouts — hovering maximise to choose a layout
— requires native `WM_NCHITTEST` handling that a custom title bar does not get for free.
Maximising works; the hover flyout does not appear yet.

## 10. Degrade visibly, never silently

A native capability that is unavailable must be _seen_ to be unavailable.

- Mica unsupported → a solid token surface, and the application still looks deliberate.
- The accent ramp could not be read → the default is used and the interface reports it.
- A toast was delivered under a borrowed identity → the interface says which identity, and why
  that is not proof.

Silence is the bug. A wrong colour with no explanation is worse than a plain one with a reason.

## 11. The gate

Every pull request that touches a user-facing surface is checked against this document, and:

- the screen was **opened in the real application**, in **both themes**, and driven by keyboard;
- `npm run gates` is green — including ESLint, where `react-hooks/rules-of-hooks` is an error,
  because a hook after an early return type-checks cleanly and crashes the screen at runtime.

A green type-check is not evidence that a UI works.
