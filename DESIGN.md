# Design

## Register

product

## Theme

Light is the default. The product is used as a desktop research workspace where users need to compare many labels, version numbers, and dense component names for long periods. Light mode keeps the 3D structure model legible and makes the tool feel like an analytical workbench rather than a night-mode AI console.

Physical scene (light): a researcher on a large monitor in a quiet workspace, cross-checking prompt versions against raw captures and notes, needing fast orientation more than atmosphere.

Dark is an opt-in "warm graphite workbench", not a neon console. It exists for the second scene: a prompt engineer reading captures for long stretches in a dim room with a dark IDE open beside the Observatory, who wants the tool to stop being a bright glare-slab next to their editor. It inverts the same warm hue-70 neutrals into warm graphite rather than introducing a cool/black "AI command center" palette, which the anti-references reject. The 3D structure slabs stay bright (lit ceramic objects on a dark surface) so spatial separation survives the inversion; only the callout text, which sits on the page canvas rather than on a slab face, switches to light hued tints.

Theme resolution: a pre-paint script sets `data-theme` on `<html>` from a stored choice, falling back to the OS `prefers-color-scheme`. A quiet rail toggle flips and persists the choice; with no stored choice, the app keeps following the OS. Every color is a semantic OKLCH token in `src/styles/main.css`, so a single `:root[data-theme="dark"]` block retones the whole app.

## Color Strategy

Restrained foundation with a clean, deliberate structure palette. The page chrome should use warm, low-chroma neutrals. The 3D Structure view may use distinct section color families because color carries spatial grouping and semantic category, not decoration.

Avoid blue-purple dominance. Blue can appear inside the current implementation, but it should not become the brand signal. Prefer a palette that feels crisp, analytical, and lightly mineral: warm paper surfaces, graphite text, and clear categorical colors. Avoid muddy browns, dirty greens, heavy umbers, and low-light slab colors that make the 3D model feel stale or unclear.

## Tokens

```css
:root {
  --surface-0: oklch(97% 0.008 60);
  --surface-1: oklch(92% 0.009 60);
  --surface-2: oklch(87% 0.010 60);
  --surface-3: oklch(82% 0.010 60);

  --border-subtle: oklch(80% 0.010 60);
  --border-default: oklch(72% 0.012 60);

  --text-primary: oklch(18% 0.012 55);
  --text-secondary: oklch(38% 0.010 55);
  --text-muted: oklch(55% 0.008 55);

  --accent: oklch(42% 0.14 260);
  --accent-dim: oklch(35% 0.11 260);
  --accent-hover: oklch(46% 0.15 260);

  --code-bg: oklch(90% 0.008 60);
}
```

These reflect the current code, not a final palette lock. Future color work should keep OKLCH tokens and revisit whether the accent should remain blue or move toward a less expected research-instrument hue.

## 3D Structure Palette

The current Structure view color direction is too dirty. Redesign it toward cleaner, brighter categorical families with restrained chroma and strong luminance separation across slab faces.

Target qualities:

- Clean, not neon.
- Light-mode native, not dark palettes lifted into a bright scene.
- Distinct enough that tools, system message, and user-message layers remain separable at a glance.
- Clear on shaded 3D faces, including hover and focus states.
- More like technical ceramics, enamel, or mineral samples than soil, parchment, or dashboard blue.

Possible direction:

```css
--structure-user:   oklch(70% 0.095 82);   /* clean ochre */
--structure-system: oklch(64% 0.090 205);  /* mineral blue */
--structure-tools:  oklch(66% 0.085 155);  /* clean green */
```

These are starting points, not locked tokens. Test them directly in the 3D scene because material shading changes perceived hue and contrast.

## Structure View

The Structure view is a 3D interface. It should remain canvas-led, with page chrome minimized around it. If the product moves to a single vertical page, Structure should act as the first major section and own enough viewport height to preserve the spatial model.

Current model:

- Tools, system message, and user-message components render as stacked slabs.
- Layer labels sit outside the stack and open a detail panel.
- The panel reveals prose, schema, or markdown evidence for a selected component.
- Hover and focus should clarify selection without making the stack feel like a toy.

The structure palette should be redesigned cleaner. It must keep strong category separation, readable labels, and enough luminance contrast on the 3D faces. Color is functional grouping.

## Diff View

The Diff view needs redesign. It should stop feeling like two columns of status rows and become a comparison instrument.

Direction:

- Put version selection and comparison scope in a compact control band.
- Lead with the most meaningful changes, grouped by component type and severity.
- Distinguish structural changes from content-size changes.
- Offer progressive detail for evidence rather than expanding into large raw blocks by default.
- Avoid summary cards that repeat obvious counts.

Diff state colors should remain semantic and color-blind-conscious:

```css
--diff-added-bg: oklch(91% 0.045 145);
--diff-added-text: oklch(32% 0.090 150);
--diff-removed-bg: oklch(91% 0.040 25);
--diff-removed-text: oklch(34% 0.100 25);
--diff-changed-bg: oklch(91% 0.055 75);
--diff-changed-text: oklch(35% 0.085 70);
```

## Evolution View

The Evolution view is directionally successful. Preserve its dense matrix-like temporal reading and compact controls.

Improvements should focus on:

- Better label management for long component names.
- Clearer separation between system message and tools when both are visible.
- Consistent use of theme tokens instead of hard-coded chart colors.
- Tooltip copy that explains whether a value is character count, size delta, or presence.

## Page Layout

The overall page layout needs redesign. The current heading structure takes more attention than it earns. A single-page vertical composition is a strong candidate: Structure, Diff, and Evolution appear as three stacked working sections instead of separate page-like routes.

Direction:

- Treat views as working surfaces, not pages with document-style headings.
- Consider one continuous vertical page with compact section anchors for Structure, Diff, and Evolution.
- Give Structure the strongest first-screen presence while leaving a visible hint of the next section below.
- Let Diff and Evolution follow as dense analytical sections rather than route-isolated pages.
- Keep navigation compact and persistent.
- Use small, contextual labels instead of large repeated titles.
- Put controls close to the thing they affect.
- Do not wrap major views in cards.
- Use panels, bands, and inline disclosure for details.

## Typography

System font stack:

```css
font-family: system-ui, -apple-system, sans-serif;
```

Use a tight product scale:

- 18px / 600 for rare view-level headings.
- 15px to 16px / 600 for panel titles.
- 13px to 14px / 400 for controls, labels, and body copy.
- 11px to 12px / 600 for metadata, tags, axis labels, and compact table text.
- 11px monospace for code, schema, and component identifiers.

Avoid oversized titles inside tool surfaces. Long labels need truncation, wrapping, or measured columns rather than shrinking the whole layout.

## Components

Navigation should be compact, sticky, and quiet. The active view indicator should be clear without becoming a colored stripe.

Version pickers should feel like controls, not form filler. They need stable width, readable version numbers, and clear focus states.

Detail panels should be used for evidence inspection when the user selects a structure layer or comparison item. Panels are acceptable when they preserve context; modals should be avoided.

Tabs and segmented controls are appropriate for mode switching in Evolution and detail panels.

## Motion

Motion is functional and restrained:

- Structure slab hover/focus can slide or brighten briefly.
- Detail panel entrance uses `cubic-bezier(0.16, 1, 0.3, 1)` around 300ms.
- Chart updates may animate values, but reduced-motion should disable or shorten transitions.
- No bounce, elastic motion, decorative choreography, or layout-property animation.

## Accessibility

Maintain keyboard navigation in Structure: arrow keys move through layers, Enter opens detail, Escape closes panels. Keep the canvas focusable with an application role and useful ARIA label.

Use visible focus states on nav, version pickers, buttons, labels, and tabs. Semantic diff states must include text labels or icons in addition to color. Chart and 3D interactions need textual equivalents or live-region summaries for selected items.
