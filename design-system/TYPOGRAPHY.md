# Typography

Typography is not a layer of the design. It *is* the design. If the type is set
correctly, the page is already most of the way to being Anestheo. Two voices
carry everything; a third is never added.

---

## Why two typefaces, and only two

The brand holds a single tension: **the certainty of an operating system, the
humility of medicine.** We give each half a voice, and we refuse a third — because
a third voice is noise, and restraint is confidence (Principle 4).

### Newsreader — the human voice

**Why it exists.** Newsreader is an editorial text serif: warm, sturdy, the
typeface of a serious publication. It carries the part of Anestheo that is human,
trustworthy, and unhurried — the Belief, the Vision, the Promise. A serif says
*establishment, gravity, care*. It is also durable: editorial serifs have looked
correct for centuries and will not date.

**Why not Playfair (or any high-contrast display serif).** High-contrast,
fashion-display serifs read as *style*, and style ages. Newsreader is lower
contrast and quieter — it carries weight without drawing attention to itself,
which is the whole brand.

**How it is set.** Display and statements only. Weight **450 — never bold.**
Confidence at large size comes from scale and space, not from heft. A bold serif
headline is trying too hard; a medium-weight serif at 88px is simply certain.

### Inter — the system voice

**Why it exists.** Inter is a neutral grotesque — the modern heir to Helvetica.
It carries everything functional: sub-lines, labels, navigation, product
captions, interface. It is precise, legible, and self-effacing — the typeface
equivalent of a well-made instrument. It never competes with the serif; it
supports it.

**How it is set.** Weights 400 / 500 / 600. Labels are Inter, uppercase, widely
tracked (`+0.16–0.18em`) — the quiet "spec-sheet" texture that signals precision
without a third font.

---

## The scale

One scale, large jumps, no in-between sizes. Sizes are fluid (`clamp`) so a frame
breathes the same on a phone and a wall.

| Role | Face / weight | Size | Leading · tracking |
|---|---|---|---|
| Monument (hero, the two bookend statements) | Newsreader 450 | `clamp(44px, 6.6vw, 88px)` | 1.04 · −0.022em |
| Statement (section headline) | Newsreader 450 | `clamp(33px, 4.9vw, 64px)` | 1.08 · −0.018em |
| Lead / sub | Inter 400, muted | `clamp(17px, 1.6vw, 21px)` | 1.6 · 0 |
| Body (rare, short) | Inter 400 | 16–17px | 1.6 |
| Label / eyebrow | Inter 500, uppercase | 12–13px | +0.16–0.18em |

The serif is always the hero. The sans always supports. The label always
whispers. This relationship never inverts.

---

## Line length

The measure is capped so headlines wrap with intent and prose stays readable:

- **Statements:** ~12–16 words, roughly `15–19ch` of max-width. Control the break;
  a monument's line endings are composed, not accidental.
- **Lead / body:** ~`30–34ch`. Past this, a line tires the eye.

A long line of serif running the full width of a screen is the surest sign that
no one set the type. We always constrain the measure.

---

## Hierarchy — the rule of two

**At most two type roles are visible in any one view.** A monument and a label.
A statement and a lead. Never three competing sizes on one screen — that is a
brochure, and we are not a brochure. Hierarchy is built by *contrast between
two*, not by a staircase of five.

---

## What typography must never become

- **A third typeface.** Two voices, forever. A new font is a new noise.
- **Bold for emphasis.** Emphasis comes from scale, space, and the serif/sans
  contrast — never from making a word heavier or coloring it.
- **Centered by default.** We are left-aligned and editorial (`LAYOUT.md`).
  Centering is reserved for the rare resolution beat, used deliberately.
- **Decoration.** No outlines, no letter-spacing tricks on headlines, no type as
  ornament. The word carries the meaning; the setting gets out of the way.
- **Mono.** A monospaced face reads "developer," and that is a SaaS tell. The
  precision texture is achieved with tracked uppercase Inter, not code type.

If the type is doing its job, you will not notice the type. You will notice that
you knew exactly where to look.
