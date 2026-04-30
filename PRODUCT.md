# Product

## Register

product

## Users

Primary users are AI researchers, prompt engineers, and developers studying Claude Code's system prompt history. They are technically literate, comfortable with dense structured data, and usually work on a desktop browser while reading code, prompt captures, or release notes alongside the interface.

Secondary users are curious developers who want a trustworthy way to understand how Claude Code is instructed without reading hundreds of raw prompt files by hand.

## Product Purpose

Prompt Drift Observatory is a research interface for exploring how Claude Code's prompt structure evolves across versions. The current product is a Vite app with three primary views:

- Structure: inspect a selected prompt version as a 3D layered model of tools, system message sections, and user-message components.
- Diff: compare two versions and understand structural and content changes. This view needs a redesign so comparison feels analytical rather than like a flat list of status rows.
- Evolution: scan changes across a version range. This view is directionally successful and should stay focused on compact temporal comparison.

The product should help users move from orientation to evidence: what exists now, what changed between versions, and how components grew, disappeared, or shifted over time.

## Brand Personality

Precise, investigative, spatial. The UI should feel like a serious research instrument with enough visual character to make prompt structure legible and memorable. It should not feel like a marketing page, a generic SaaS dashboard, or a decorative AI demo.

Tone is quiet and technical. Labels should be plain, specific, and evidence-oriented.

## Anti-references

- Generic SaaS dashboards with hero metrics, blue gradient headers, and repeated cards.
- Raw parser UIs that expose implementation jargon before user meaning.
- Dark neon "AI command center" aesthetics.
- Decorative glassmorphism, purple gradients, and cyberpunk styling.
- Overly editorial layouts that make the tool feel like an article instead of an instrument.
- Heading-heavy page structure where titles take space without improving orientation.

## Design Principles

- The structure is the interface. The 3D Structure view is not decoration; it is the primary way to understand the shape of a prompt version.
- Start spatial, then get textual. Show prompt architecture first, then reveal prose, schema, and component evidence on demand.
- Comparison should explain the change. Diff needs to guide attention toward what matters, not merely list added, removed, and changed items.
- Temporal views should stay dense and calm. Evolution should remain compact enough to scan across many versions without dashboard clutter.
- Page chrome should recede. Navigation and headings should help orientation without competing with the views.

## Accessibility & Inclusion

Target WCAG AA. Preserve keyboard access for the 3D Structure view, including focus movement and panel opening. Maintain screen-reader announcements for selected structure layers. Use color as reinforcement, not the only carrier of diff state. Respect reduced-motion preferences for camera, slab, chart, and panel motion.
