# Design system — `chrome/easel.css`

Static precompiled CSS. No build step, no Tailwind runtime, no CDN. Token names follow DaisyUI's vocabulary so existing artifact patterns port over unchanged.

## Themes

The shell page sets `data-theme` on the `<html>` element. Three families — default, `lantern`, `fig` — each in a light and a dark mode:

```html
<html data-theme="light">          <!-- default family -->
<html data-theme="dark">
<html data-theme="lantern-light">  <!-- named families suffix the mode -->
<html data-theme="fig-dark">
```

The family comes from the tuner’s Family row (localStorage `sf-theme-family`) or a `?theme=<family>` URL pin; the mode from the Auto / Light / Dark cycle in the topbar. The ⚙ tuner popup layers per-browser inline token overrides (localStorage `sf-tuner-v2`) on top of whichever family is active.

Both live in the expanded bar. Under 1500px — the width at which the full bar stops fitting one line — the chrome opens collapsed — one row of the controls a reader acts on, with theme, page width, the diff legend and the round note folded away — and the chevron at its right end expands it (localStorage `sf-chrome-compact`).

**It has to be `<html>`, not a wrapper div.** A wrapper resolves the base rules against `:root`'s light defaults, so dark tables render dark-on-dark. This bit once and the rule is pinned in the contract between the daemon and the chrome.

## Text tiers

Three, ordered by contrast, and the ordering is the point:

| Token | Used for | Measured on the page ground |
|---|---|---|
| `--color-base-content` | headings, `<strong>`, table cells, controls | #141414 / #E4E4E4 |
| `--color-body-content` | prose (`p`, `li`), inline `code` | secondary ink (74% / 55%) |
| `--color-muted-content` | secondary text, `sd-muted` | solid `#707070` / `#808080` — ≥ 4.5:1 on `base-100` |

Inline `code` **pins** the body tier rather than inheriting it. Inheriting put muted text on the raised code ground at 4.27:1 — each token fine alone, the stack below AA.

**Default chrome is a neutral editor palette.** Light is editor `#FCFCFC` / chrome `#F8F8F8` / sidebar `#F3F3F3` with `#141414` ink. Dark is `#181818` / `#141414` / `#141414` with `#E4E4E4` ink. Accent is a muted blue (`#3685BF` light, `#599CE7` dark) — used on links, focus, and primary actions. Status, diffs, and annotation markers keep their own category hues. Lantern and fig do not inherit that block — each family has its own warm foundation, then its literary overrides.

Type on the default family is a compact UI scale: H1 24/30/590, H2 18/24/590, H3 16/22/590, body 14/20. Cards are framed, 8px radius, 16px pad, no shadow; `.sd-card-title` is a 28px / 12px / 500 title on a quiet fill. Buttons and `[data-option]` hug their label at 24px / 6px radius. Pills (`.sd-badge`) are always neutral; status is a category dot. Tables are a framed rounded shell. Callouts take a 10% tone tint and a leading glyph (info / check / warning / error). Stats (`.sd-metric`) are open value+label, with optional `.sd-metric-success|warning|error|info`. Diff lines use the insert/remove tints and a 3px accent strip. Default charts use the standard series (`#1F8A65` / `#2E79B5` / `#7B64B8` / `#F0A040` / `#C85898`); lantern and fig keep the warmer oklch set.

The dark page ground is **near-black**; `--color-base-100` and `--color-base-300` step *up* from it, so panels lift off the page. In light they recede, which is why the two themes order those tokens differently.

`--border-subtle` is lighter than `--border`: internal table rules use it so the outer edge stays the stronger line.

**Collapsing** body prose into the emphasis tier is a regression: uniform near-maximum contrast is what made long documents read flat and fatiguing. Body may sit high — on dark it is deliberately bright — as long as a real gap remains. `test/design-system.e2e.test.js` pins both the ordering and the gap in each theme.

`sd-muted` is written with `#sf-content` in its selector, because `#sf-content p` would otherwise outrank a bare class — including when `sd-muted` wraps rendered markdown, whose children are `<p>`.

## Fonts

`--font-sans` carries display and body on the default family. `--font-serif` remains for lantern/fig and the tuner. `--font-mono` is labels and code. Every face is a system face, so nothing is fetched and the publish path stays same-origin.

`[data-option]` pins `font-family` rather than relying on `font: inherit` alone: a control inside a monospace ancestor otherwise renders as what looks like a code sample.

## Two class namespaces

| Prefix | Owner | Meaning |
|---|---|---|
| `sd-*` | templates | Design system. Emitted by `templates/*.js`; `easel.css` styles it. |
| `sf-*` | chrome | Structure built by `chrome/client.js`, plus the content-layer markers it applies at runtime (`sf-annotated`, `sf-diff-*`, `sf-recorded`). |

**Templates never emit an `sf-` class** — `easel.css` only styles them. `page.js` actively rejects input that carries one, in every legal attribute syntax including the unquoted `class=sf-queue` form.

The chrome DOM vocabulary itself — which elements client.js builds and which classes it applies — is specified in `docs/api.md`.

## The `[hidden]` rule

`easel.css` sets `[hidden] { display: none !important; }`. Without it, an explicit `display:` on a chrome class beats the user-agent `[hidden]` rule and the attribute silently stops working — which is why panels appeared to ignore being hidden. `test/css.test.js` pins this with a computed-style check.
