# Layout

Layout is how we compose a page the way an editor composes a spread: a strong
axis, a measured column, and a great deal of space we choose not to fill. The
arrangement of emptiness is as designed as the arrangement of content.

---

## The editorial spine

**Why.** Centered layouts read as generic and slightly timid — everything pulled
to the safe middle. A strong, consistent **left axis** reads as considered and
confident, the way a serious publication sets its page. It is also a quiet act of
order: every statement on the page begins on the same vertical line, so the eye
always knows where the next thought starts.

**How.** One left margin — the spine — runs down the entire page. Headlines,
leads, and section markers all originate from it. The margin is generous and
fluid: `clamp(24px, 6vw, 96px)`.

**The exception.** Centering is reserved for *resolution* — a beat that has
earned symmetry after asymmetry (the Promise; the Invitation). Used rarely, a
centered frame feels like an exhale. Used by default, it feels like a template.

---

## The 12-column system

**Why.** A grid is not a cage; it is the reason unrelated elements feel related.
Twelve columns give enough division for editorial asymmetry without inviting
clutter.

**How.**
- Content max-width **1180–1200px**; a product image may breathe to **1320px**.
- Statements span **columns 1–8**; leads span **1–6**. Content lives left of
  center; the unused right columns are deliberate.
- Asymmetry is the tool: type on the spine, product and labels offset, void
  between. Never a centered slab of full-width content.
- Mobile collapses to one column, ~`22px` side margins, the same fluid type. The
  composition does not rearrange into cards; it simply stacks and breathes.

---

## Whitespace is poise

**Why.** Space is the most expensive-feeling material we have. It says we are not
anxious to fill the page — that we have so much certainty we can afford to leave
most of the surface empty. Unused space is not wasted; it is confidence made
visible (Principle 4).

**How.**
- Base unit **8px**. Rhythm: `8 · 16 · 24 · 40 · 64 · 96 · 140 · 200`.
- **One idea owns one screen.** A monument occupies ~`80–92vh` with its statement
  set low or high, never crammed. Section rhythm is `clamp(120px, 16vw, 200px)`
  of vertical air between beats — generous to the point of boldness.
- If a screen feels slightly *too* empty, it is almost certainly correct. The
  discomfort of a disciplined designer is the comfort of the reader.

---

## Composing with negative space

The *placement* of a statement within its frame is a designed sequence, not a
default. Across a page, where type sits should tell a story:

- weight low in the frame reads as gravity, a held breath, a problem;
- weight high reads as rising, opening, hope;
- centered reads as resolution.

This choreography of emptiness — low, then high, then centered — is itself the
graphic idea. Most designers never compose the space between elements. We always
do.

---

## What layout must never become

- A page that rearranges into a card grid to "use the space."
- Full-width slabs of centered content.
- Symmetry by default.
- Density. When in doubt, remove a column of content and add a column of space.
