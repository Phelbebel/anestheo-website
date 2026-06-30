# Components

A component is the smallest place the principles can fail. These are not widgets
to assemble a page from — they are the parts, each one already obeying the
language. When in doubt, a component should look like *less* than you expected.

The unit of construction is not the box. It is the **hairline and the space.**

---

## Hairlines

**Why first.** Most systems divide space with boxes, fills, and shadows. We
divide it with a single 1px line, or with nothing but space. A hairline is the
quietest possible structure, and quiet structure is the brand.

- Light world: `rgba(21,33,28,.10–.12)`. Dark world: `rgba(244,242,236,.12–.14)`.
- Use a hairline before you reach for a card. Use space before you reach for a
  hairline.

## Spacing

The 8px system from `LAYOUT.md` governs everything: `8 · 16 · 24 · 40 · 64 · 96`.
Inside a component, spacing is generous and consistent. Cramped padding is the
fastest way to look cheap. When a component feels tight, add space, not cleverness.

## Buttons and calls to action

**Why they are quiet.** A loud filled button is a page that is unsure you will
act. Ours assumes you will.

- The primary form is a **text-weight signpost with a single arrow**, not a
  heavy pill shouting for the click. (See *Doors*.)
- A filled button exists only where an action genuinely needs weight inside the
  product. On brand pages, prefer text + arrow.
- The arrow may carry the **one teal accent** (`COLOR.md`) — and the scarcity rule
  holds: at most twice per page.
- Hover is a *subtle* shift — the arrow eases a few pixels, nothing more. No color
  floods, no scale jumps. Focus is always visible (`:focus-visible`, teal, offset).
- Copy follows `COPY.md`: calm verbs, no urgency.

## Doors (the two-path choice)

The signature navigation moment — *I'm having surgery* / *I deliver care*.

- **Typography, not cards.** A serif label, one Inter line beneath, a teal arrow.
  Hairline or space between the two — never two boxes.
- Balanced and centered (a resolution beat). The arrows are the page's only color.
- They read as an *invitation*, not a form. See `COPY.md`.

## Navigation

**Why the homepage wears no app bar.** A persistent chrome bar is the most "web"
object there is. On brand pages the navigation is a **masthead** — a wordmark and
a single quiet link, set like a magazine, that scrolls away. It is part of the
first composition, not furniture bolted above it.

- Inside the product, the shared app navigation is appropriate and consistent —
  it is an instrument, and instruments may be present. The distinction is: brand
  pages get a masthead; workspaces get navigation.
- Never two competing navigations. Never a sticky bar on a brand page.

## Cards

Used sparingly, and only when a set of true peers must be visually grouped.

- A card is defined by a **hairline**, generous internal space, and at most a
  single soft shadow if it must lift off a surface. No heavy borders, no filled
  backgrounds for variety, no nested cards.
- Prefer a list with hairline dividers, or plain spacing, over a grid of cards.
  A wall of cards is a feature wall (`PRODUCT_PRESENTATION.md`), and we do not
  build those.

## Forms

Where the product asks something of a patient or clinician — often at a vulnerable
moment. Clarity here is a safety value, not a style.

- One question in focus at a time where possible. Generous spacing. Plain labels
  in the system voice (`COPY.md`).
- Calm states: a quiet, certain confirmation, never a celebratory burst. Errors
  are exact and kind — they say what to do, not what went wrong.
- Inputs are restrained: a hairline, a clear focus state, no heavy fills.

## Workspace sections

The dark surfaces where the product lives.

- A dark section that shows or frames the work declares itself **`lit`** so it
  inherits the Point (`POINT.md`). The work is the hero; the Point lights it.
- Internal density is the product's own concern (clinical UI must be legible and
  information-rich) — but the *framing*, spacing, and headings still obey this
  system. The instrument may be dense; the room around it is calm.

---

## Interaction rules (all components)

- **Hover is subtle.** A small, single change. If a hover state is noticeable from
  across the room, it is too much.
- **Focus is always visible.** Keyboard users see a clear, consistent focus ring
  (teal, offset). Accessibility is not negotiable.
- **Motion obeys `MOTION.md`.** One easing, one duration, and almost never.
- **Targets are honest.** Whole cards and rows are clickable where they imply it;
  touch targets are comfortable.

If a component needs decoration to feel finished, it is not finished — it is
overbuilt. Remove until it is calm, then ship.
