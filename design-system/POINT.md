# The Point

This is not CSS documentation. The implementation lives in `point.css`. This is
the philosophy of the Point — what it means, and why it must never be touched
without understanding it.

---

## What the Point is

> The Point is presence.
>
> It represents steady attention.
>
> It never asks for attention.
>
> It never animates.
>
> It is never the hero.
>
> It quietly illuminates work.
>
> Remove it, and the composition should feel wrong.
>
> Notice it immediately, and it is too strong.

---

## Why it exists

It comes directly from the Foundation. *Nobody should have to be lucky to receive
great care.* The opposite of luck is not effort — it is **steady, certain
attention that never wavers.** Someone is watching over the work, and they will
not look away.

Every interface in medicine blinks and beeps; vitality is rendered as anxiety.
The Point is the refusal of that. It is a single, warm, perfectly still light.
**Stillness is the meaning.** In a world where every dot in technology moves to be
noticed, a point that simply holds — indifferent to being seen — is the visible
form of certainty.

This is also why it can become the company's symbol and not merely a homepage
detail. Its ownership is not in its shape (a point belongs to no one) but in a
discipline no attention-economy product will keep: it never moves. That refusal
is what makes it ours.

---

## The three states (the law)

The Point is correct only when all three are true. Two of them are felt; one is
structural.

1. **Remove it and the composition feels wrong.** The Point is not laid on top of
   a dark surface — the surface is lit *from* it. Delete it and the light goes
   flat, the work loses its source. If a composition is unchanged by removing the
   Point, the Point was not integrated; it was decoration. Start over.

2. **Notice it immediately and it is too strong.** It is a small warm core at the
   faintest reach. You should not see it; you should feel that the room is lit.
   If your eye goes to the Point before it goes to the work, dim it.

3. **The correct state:** *its absence is felt before its existence is
   remembered.* People should miss it when it is gone without being able to say
   what is missing.

---

## How every dark workspace inherits it

The Point is a **primitive**, not an asset to be re-drawn. It lives once, in
`point.css`, imported by `styles.css` — so every surface that loads the shared
stylesheet already has it.

A dark composition declares itself lit with a single class:

```html
<section class="lit"> … the work … </section>
```

From that one class, three things follow automatically: the wash that lights the
composition, the steady core, and the work raised into the light. The light can
be hung where the composition needs it by overriding two custom properties:

```css
.some-dark-surface { --point-x: 50%; --point-y: 6%; }
```

That is the entire interface. There is intentionally nothing else to configure —
no brightness control, no animation toggle, no color option. The constraints are
the design.

---

## The inviolable rules

These are not defaults. They are laws. They hold on every surface, forever:

- **Never animated.** Not on the homepage, not in a workspace, not in a loading
  state, not in the app icon. The moment it moves, it becomes a spinner and dies.
- **Never the focal centre.** The work is always the hero. The Point only lights it.
- **Warm, never blue.** `#F7EFDD` — the temperature of presence, not of a monitor.
- **Subtle enough to miss consciously.** Never brighten it to make it visible.

---

## Beyond the workspace

The Point carries one constant meaning — *presence, kept still* — to every place
Anestheo appears:

- the **favicon** and **app icon** — a single warm point on near-black;
- the moment a **case opens** — the Point, *we are watching this patient now*;
- the **patient** the night before surgery — the Point, *your team is with you*;
- the **loading state** — never a spinner; the steady Point, certainty instead of
  waiting.

It is the same point, the same silence, the same stillness, on every surface. It
never explains itself. It is felt first and understood, if ever, much later.

That is how Anestheo communicates trust: not by saying it, but by never looking
away.
