# Design Decisions — what we rejected, and why

This is a permanent record of directions we considered and deliberately turned
down. It exists so they are not re-debated every year by every new designer. A
rejection here is not a matter of taste — each one violates a principle that
descends from `FOUNDATION.md`. If you want to revive one of these, you are not
proposing a design; you are proposing to change the constitution, which requires
founder approval (`CHANGELOG.md`).

The principles cited below live in `DESIGN_PRINCIPLES.md`; the values live in
`FOUNDATION.md`.

---

## Surface & material

### Glassmorphism
**What.** Frosted, translucent, blurred panels floating over backgrounds.
**Why rejected.** It is a trend with a timestamp — it screams "2021." It adds
visual complexity to manufacture depth that hierarchy should create.
**Violates.** *Restraint is confidence* · *Editorial before interface* · would not
look correct in 2045.

### Decorative gradients
**What.** Color washes used for mood, vibrancy, or "tech" atmosphere.
**Why rejected.** The only gradient we permit is *functional light* — the dim
into the dark, and the wash from the Point. A gradient that does not describe
light is ornament.
**Violates.** *Restraint is confidence* · `COLOR.md` (color is a signal, not decoration).

### Decorative icons
**What.** Little glyphs beside every heading and feature to add color and "polish."
**Why rejected.** Icons used for decoration are noise that dilutes typography's
job. We use an icon only when it is the most precise carrier of meaning, never as
garnish.
**Violates.** *Typography creates hierarchy* · *Remove before adding*.

### Infinite color palettes
**What.** A broad, expanding set of brand colors, tints, and category hues.
**Why rejected.** Color earns meaning from scarcity. There is paper, there is the
dark, and there is one teal used at most twice per page. A second accent does not
exist.
**Violates.** *Restraint is confidence* · `COLOR.md` (the law of scarcity).

---

## Imagery

### Generic healthcare imagery
**What.** Smiling clinicians, gloved handshakes, abstract "wellness" visuals.
**Why rejected.** It is the visual language of every interchangeable medical
brand. It says nothing true and could belong to anyone.
**Violates.** *Quiet Authority* · the Belief (we are not a generic medical company).

### Medical stock photography
**What.** Purchased photos of doctors, patients, and equipment.
**Why rejected.** Stock is the opposite of real. Our proof is the real product
and real decisions, not a staged photograph.
**Violates.** *Product is always the proof* · the value of *evidence*.

### ECG decorations
**What.** Heartbeat lines and waveform motifs used as graphics.
**Why rejected.** A fake monitor is a fake medical element — the cliché of the
category, and dishonest. We removed every one of these on purpose.
**Violates.** *Quiet Authority* · *evidence* · `PRODUCT_PRESENTATION.md` (only real work).

---

## How the product is shown

### Large browser mockups
**What.** Product screenshots inside laptop frames or browser chrome with
traffic-light dots.
**Why rejected.** Window chrome reads "marketing render" and dates instantly. The
work is shown frameless, lit by the Point, as a real object.
**Violates.** *Editorial before interface* · `PRODUCT_PRESENTATION.md`.

### Feature walls
**What.** A grid of a dozen product cards, each with an icon and a feature.
**Why rejected.** A wall of features is a company unsure which one matters. We
show one product, fully, in its moment.
**Violates.** *One idea per screen* · *Remove before adding*.

### Endless cards
**What.** Stacking every idea into identical boxes to fill the page.
**Why rejected.** Cards are a default that replaces composition with containers.
We prefer hairlines and space; a card is used only to group true peers.
**Violates.** *Editorial before interface* · *Restraint is confidence*.

### Fake UI
**What.** Invented or idealized screens we do not actually ship.
**Why rejected.** If it does not exist, we do not show it. We would rather say
nothing than show something untrue.
**Violates.** *Product is always the proof* · *rigor* and *evidence*.

### Dashboard-first homepages
**What.** Opening the company on a screenshot of the app.
**Why rejected.** We open on the Belief — a moral statement — and let the product
be discovered as proof. The product is a co-hero, never the first word.
**Violates.** *Editorial before interface* · *One emotional beat per section*.

---

## Copy & messaging

### Startup copy
**What.** "Get started today," "join thousands of teams," conversion-funnel
language.
**Why rejected.** It is the voice of a company performing growth. Ours is the
voice of someone certain and kind.
**Violates.** *Quiet Authority* · `COPY.md`.

### Marketing hype
**What.** "Revolutionary," "world-class," "game-changing," exclamation marks.
**Why rejected.** Hype is a company telling you it is impressive instead of being
impressive. If a sentence leans on hype, it has no real claim underneath.
**Violates.** *Quiet Authority* · *humility* · `COPY.md` (banned words).

### "AI-powered" messaging
**What.** Leading with the technology — "AI-powered," "next-gen AI."
**Why rejected.** We describe the *decision the product improves*, never the
mechanism. The technology will change; the human truth will not. AI is how we
keep the Promise, not what we sell.
**Violates.** *Quiet Authority* · the Mission (decisions, not mechanisms) · `COPY.md`.

---

## Motion

### Animated loaders
**What.** Spinners, progress animations, bouncing dots while waiting.
**Why rejected.** A spinner is the language of waiting and anxiety. Where we show
waiting, we show the steady Point — certainty, not a spinner. The Point never
animates.
**Violates.** `MOTION.md` · `POINT.md` (never animated).

### Attention-seeking motion
**What.** Parallax, hover wiggles, counters ticking up, things that pulse or
blink for the eye.
**Why rejected.** That is the motion language of the attention economy, and it
reads as anxiety. If a visitor notices an animation, it has failed.
**Violates.** *Quiet Authority* · `MOTION.md`.

### Hero videos
**What.** Autoplaying video backgrounds behind the hero.
**Why rejected.** Autoplay, motion, and spectacle the moment you arrive — the
opposite of the silence we open with. Nothing plays on its own.
**Violates.** *Quiet Authority* · *One emotional beat per section* · `MOTION.md`.

---

## Layout

### Centered SaaS layouts
**What.** Everything pulled to a safe center column — centered hero, centered
features, centered everything.
**Why rejected.** Centered-by-default reads as generic and timid. We compose on a
left editorial spine; centering is reserved for the rare resolution beat.
**Violates.** *Editorial before interface* · `LAYOUT.md`.

---

These are settled. To reopen any of them, see `CHANGELOG.md`: it is a constitutional
change, not a design choice.
