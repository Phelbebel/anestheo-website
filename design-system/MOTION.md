# Motion

The rule for motion at Anestheo is almost the rule of no motion. **If a visitor
notices an animation, it has failed.** Movement exists only to reinforce meaning;
it is never decoration, never delight for its own sake, and never a way to seem
modern. In a medical product, calm is not a style — it is a clinical value.

---

## Why so little

Every interface in technology moves to capture attention: things spin, slide,
bounce, pulse, and count. That motion is the language of the attention economy,
and it reads as anxiety. We are selling the opposite of anxiety. Stillness is our
signature — most of all in the Point (`POINT.md`), which never moves at all.

Restraint here is also durability: motion trends date faster than anything. A
page that does almost nothing will still feel correct in 2045.

---

## The two motions that exist

Only two. Both reinforce meaning.

### 1 · The reveal

Content arrives once, gently, as it enters the viewport — a slow fade and a small
rise.

- **One easing:** `cubic-bezier(.2, .7, .3, 1)`.
- **One duration:** `~600ms` (`600–800ms`).
- **Once.** It never re-animates on scroll-back. It is an arrival, not a loop.
- Transform: `translateY(20–24px) → 0`, opacity `0 → 1`. A small stagger
  (`~80ms`) is allowed within a single group.

**Why.** It mirrors a thought settling — the way a considered sentence appears.
It is felt as composure, not as animation.

### 2 · The dim and the lift

The single expressive motion on the page: the warm paper world **dims** into the
dark workspace, and later **lifts** back into the light. It is achieved with a
background gradient as you cross the threshold — not a scripted effect.

**Why.** It is the only motion that *means* something specific to Anestheo: the
descent into the dark where the work happens, and the return. It earns its
existence by being the experience, not by decorating it.

---

## One easing, one duration

We do not keep a library of easings and timings. **One curve, one duration**,
used everywhere. A consistent motion signature is what makes a product feel like
a single hand made it. Variety in motion is noise.

---

## What motion must never be

- **Decorative.** Parallax, floating shapes, animated gradients, hover wiggles.
- **Attention-seeking.** Counters that tick up, badges that pulse, anything that
  blinks. The Point especially never blinks — a blinking point is a monitor; a
  steady point is certainty.
- **Scroll-jacking.** The scroll belongs to the reader. We never hijack it.
- **Autoplay.** Nothing plays, loops, or moves on its own.

---

## Accessibility is not optional

Every motion respects `prefers-reduced-motion: reduce`: reveals become instant,
transforms are removed, nothing animates. Because the system already moves so
little, honoring this is trivial — which is the point. A design that needs motion
to work was not designed quietly enough.

> The Point never moves, so for it there is nothing to disable. That is the model
> for all of our motion: so restrained that turning it off changes almost nothing.
