# Mathteroid — Product Vision

## Statement

**Mathteroid** is a browser-based arcade game, inspired by classic *Asteroids*, that builds
**automatic recall of arithmetic facts** (addition, subtraction, multiplication and division
for numbers 1–12). Players pilot a customizable spaceship through asteroid fields where
**only asteroids carrying the correct answer can be safely destroyed**. The game rewards
both accuracy and speed and adapts to each child. Early levels are full of easy wins.
Promotion comes only when a child has actually mastered a set of facts.

## Who it's for

- Primary: school-age kids of similar age and skill, playing at home.
- Secondary (future): classrooms, where a teacher manages a group of students.
- Each child has their own profile, progress and ship.

## Core gameplay

- **Flight:** Classic Asteroids movement (rotate, thrust, drift, screen wrap), with shooting.
  - Keyboard: arrows/WASD + space.
  - Touch: virtual joystick + fire button (auto-detected).
- **Win a level:** Clear every asteroid from the field.
- **Wrong answer:** Shooting a wrong asteroid is not a failure. It **splits into two smaller
  asteroids**, so the field gets more crowded. The fact is recorded as missed for adaptive
  practice.
- **Lose a level:** Only when the ship **collides with asteroids three times**.
- **On failure:** Encouraging message and an instant retry. Correct answers still count toward
  mastery stats. After 2–3 consecutive failures, the game quietly eases off (slower asteroids,
  fewer splits).
- **Pressure ramp:** Early levels have few, slow asteroids and no timer. Asteroid count and
  speed increase gradually within a stage.

### Equation modes (mixed across levels for variety)

| Mode | Ship shows | Shoot |
|---|---|---|
| **Classic** | One equation (`7 + 5`) | The single asteroid showing the answer; a new equation follows |
| **Swarm** | One equation | Every asteroid carrying the answer, then the equation changes |
| **Reverse** | A number (`24`) | Asteroids whose equation equals it (`3×8`, `4×6`, `12×2`) |

## Learning model

- **Staged progression:** Addition → Subtraction → Multiplication → Division, each ramping
  from easy to hard facts, with **mixed-review** levels between stages.
  - Example multiplication ramp: ×1, ×2, ×5, ×10 → ×3, ×4 → ×6–×9 → ×11, ×12.
- **Adaptive practice:** Every answer is logged per fact (correct/incorrect, response time).
  Facts that are missed or answered slowly appear more often.
- **Mastery gate (accuracy + speed):** A child is promoted from a stage only when they reach,
  for example, **≥90% accuracy with most answers under ~3 seconds** across that stage's facts.
  The thresholds are tunable. Kids progress at their own pace.

## Practice mode (pick a skill)

Next to the main **Mission** path, **Practice** lets a player target specific facts.
For example, they can drill the ×7 table they're learning at school.

- **Skills are fact families:** ×N (either factor is N), ÷N (divide by N), +N (either addend
  is N), −N (subtract N), for N = 1–12. Players can multi-select to combine, e.g. ×6 + ×7 + ×8.
- **Everything is unlocked from day one.** Practice is independent of Mission progress.
- **Skill map:** each tile shows a mastery meter (not started / learning / fast). A
  **Needs practice** tile auto-picks the player's weakest facts.
- **Sessions:** normal clear-the-field levels using only the chosen facts, followed by
  Play again / Change skills.
- **Pace:** each session starts at the gentlest pace and ramps a little with each consecutive
  clear. It resets on a failure or a change of skills.
- **Stats count, promotion doesn't:** Practice answers update per-fact stats (so the
  adaptive engine and mastery know about them), but only Missions promote to the next stage.
- **Rewards:** earns Stardust (slightly less than Missions). Scores don't go on leaderboards,
  since players choose their own difficulty.

## Rewards and customization

- Everyone starts at the same level and **chooses a base ship**.
- Completing levels earns **Stardust**, with bonuses for accuracy and speed.
- **Hangar shop:** Spend Stardust on:
  - **Cosmetics (most items):** hull colors, ship bodies, laser styles, engine trails, decals,
    explosion effects.
  - **Light perks (a few items):** such as a shield that absorbs one hit or slightly faster
    handling. Perks never answer the math for the player.

## Accounts and social (backend phase)

- **Parent/teacher account:** username + password; owns a group of child profiles.
- **Child login:** pick a profile on a "Who's playing?" screen, then enter a simple PIN.
- **Leaderboards:** scoped to the group (family or classroom). Personal bests are always shown.
- **Parent/teacher dashboard (later):** per-child progress, trouble facts, speed trends.
- **Hosting:** starts private/self-hosted with accounts created by the owner. Designed so that
  public signup can be added later, which will need email verification, password reset and
  COPPA-conscious data handling.

## Look, sound and accessibility

- **Visual style:** Neon-vector glow combined with semi-realistic 3D: lit, textured ships and
  rocks with bloom, glowing outlines, a starfield and particle explosions.
- **Audio:** Synthwave-style music and SFX (lasers, explosions, success chimes) with
  separate volume controls.
- **Read equation aloud:** optional text-to-speech for early readers.
- **Color-blind safe:** correct/incorrect feedback never relies on color alone (shape, icon,
  sound and motion cues too).

## Technology

- **Frontend:** TypeScript + Three.js (WebGL, post-processing bloom), built with Vite.
- **Backend (phase 2):** Node + Fastify (TypeScript), SQLite initially with a Postgres-ready
  schema, shipped as a single Docker image.

## Roadmap

1. **Phase 1: Playable prototype (no backend).** Core flight/shooting, asteroid splitting,
   3-hit failure, Classic mode, addition + subtraction stages with adaptive mastery, base-ship
   choice, a small Stardust shop. Profiles and progress live in browser `localStorage`. Goal:
   prove it's fun for the kids.
   - **Phase 1.5: Practice mode** (pick-a-skill drilling, skill map with mastery meters),
     added from playtest feedback.
2. **Phase 2: Backend and accounts.** Parent login, child profiles with PINs, server-side
   progress and per-fact stats, group leaderboards.
3. **Phase 3: Full curriculum and modes.** Multiplication and division stages, Swarm and Reverse
   modes, mixed-review levels, light perks, expanded shop.
4. **Phase 4: Parent/teacher dashboard and polish.** Stats views, classroom features, audio/TTS
   polish, preparation for public signup.

## Success criteria

- Kids *ask* to play.
- Measurable drop in per-fact response times and miss rates over weeks.
- Children progress through stages without frustration-driven quitting.
