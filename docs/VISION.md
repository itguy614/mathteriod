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
- **Waves:** A mission level is 3 waves (2 on an eased level). Each wave flies in a fresh field
  of 3–5 rocks; clear it and the next wave arrives after a short breather that also repairs a
  third of the hull. About 10–14 questions per level, without crowding the screen (an early
  playtest showed more rocks at once turns the game into dodging). Practice rounds are 1 wave.
- **Win a level:** Clear every wave.
- **Hull:** Three ship icons, each split into thirds. A collision costs a whole ship; a wrong
  answer costs a third. Three correct answers in a row repair a third (never past three ships).
- **Wrong answer:** Shooting a wrong asteroid **splits it into two smaller asteroids**, so the
  field gets more crowded, and chips the hull. Spraying shots at every rock no longer clears a
  level for free. The fact is recorded as missed for adaptive practice.
- **Teaching feedback:** After a miss, the equation briefly shows the full fact in gold
  (`7 × 8 = 56`, read aloud when Read Aloud is on), then returns to `= ?` so the player still
  finds the answer. A second miss on the same question makes the correct rock pulse.
- **Streak meter:** Pips beside the hull count correct answers in a row toward the next repair.
- **Results:** A "Facts to practice" list shows the facts missed that level, with a one-tap
  Practice session on them.
- **Lose a level:** When the hull runs out (collisions and wrong answers combined).
- **On failure:** Encouraging message and an instant retry. Correct answers still count toward
  mastery stats. After 2–3 consecutive failures, the game quietly eases off (slower asteroids,
  fewer splits).
- **Pressure ramp:** Early levels have few, slow asteroids and no timer. Asteroid count and
  speed increase gradually within a stage.

- **Power-ups:** Every 5 correct answers in a row drops a crystal (fly into it or shoot it):
  🐢 Slow-mo (rocks drift at under half speed), 💥 Big blaster (fatter bolts), 🧲 Magnet
  (stronger aim assist). Each lasts 8 seconds. None of them ever picks the answer.
- **Bonus UFO:** Some Classic waves get a UFO that crosses the screen once, showing a number:
  sometimes the current answer, sometimes a near miss. Shoot it when it's right for a score and
  Stardust bonus (it counts as answering the question); shoot it when it's wrong and it's a
  normal wrong answer; ignore it at no cost.
- **Boss waves:** Every (non-eased) level in a review stage ends with a boss: a giant rock
  circled by 4 numbered shards. Shooting the shard with the answer cracks the boss (5 cracks to
  win, +50 Stardust); a wrong shard heals it by one. Its hide deflects bolts.
- **Reverse waves** are smaller and slower (3 rocks, 75% speed): reading equations takes longer.

### Equation modes (mixed across levels for variety)

| Mode | Ship shows | Shoot |
|---|---|---|
| **Classic** | One equation (`7 + 5`) | The single asteroid showing the answer; a new equation follows |
| **Swarm** | One equation | Every asteroid carrying the answer, then the equation changes |
| **Reverse** | A number (`24`) | Asteroids whose equation equals it (`3×8`, `4×6`, `12×2`) |

**Built so far:** Classic, and Reverse as the middle wave of every 2nd mission level (never on
an eased level). In Reverse, hitting `3×8` for 24 counts as a correct answer for 3×8; hitting
`5×5` counts as a miss on 5×5, and the reveal shows `5 × 5 = 25`.

## Learning model

- **Staged progression:** Addition → Subtraction → Multiplication → Division, each ramping
  from easy to hard facts, with **mixed-review** levels between stages.
  - Example multiplication ramp: ×1, ×2, ×5, ×10 → ×3, ×4 → ×6–×9 → ×11, ×12.
- **Adaptive practice:** Every answer is logged per fact (correct/incorrect, response time).
  Facts that are missed or answered slowly appear more often.
- **Spaced review:** Facts from earlier stages come back on a schedule: the gap grows with
  each correct first try (1 → 3 → 7 → 14 → 30 days), a miss makes the fact due again, and slow
  facts stay on the shortest gap. Due facts fill about 1 in 5 questions of a mission level.
- **Fair timing:** Recall time stops at the decision (a tap, or firing the bolt that hits),
  minus the ship's minimum turn time, so steering skill doesn't count against the math.
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

## Journey

- **Base is the galaxy:** a 3D scene of every mission stage as a planet on a winding route,
  with the player's own ship on it. Stage progress carries the ship up to 85% of the way to the
  next planet; promotion flies it the rest of the way and the new planet lights up. The ship
  only ever flies forward (a rough mission leaves it parked, with an encouraging note). Kids
  drag to look along the route and tap a planet for its name and status (✓ done, 🚀 here,
  🔒 locked, 👾 boss). Launch is a quick boost along the route into the mission; Next on the
  results screen goes by way of the galaxy, so every mission shows the flight. A tap skips.
- **Badges & journey** (Base → Badges): the badge shelf, then the stages as a list (icons and
  words, never color alone).
- **Badges:** 27 achievements, each paying 20 Stardust once: pilot badges (first clear,
  flawless, 10 and 25 in a row, no-damage 3-wave clear, fast clear, comeback, UFO, boss,
  practice), journey badges (finish each operation, beat the final boss) and ×1–×12 times-table
  badges (every fact in the family answered fast). New ones are announced on the results
  screen; the shelf lives under the galaxy map.

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

### Parked: battle mode and a shared leaderboard (considered October 2026)

- **Couch battle** (two ships on one device, each player answering their own profile's facts,
  first to clear wins) needs no infrastructure: the cheapest way to learn whether kids enjoy
  competing. **Challenge links** (a fixed, repeatable question set plus a score in a shareable
  URL) add async rivalry, still serverless. **Live online battles** need a real-time server,
  matchmaking, cheat protection and safeguards against pairing kids with strangers.
- **Leaderboards** need a backend (the static GitHub Pages site can't share state), mean
  storing children's data online (nickname + score only, family or class scoped), and can be
  faked from the browser. Raw scores also aren't comparable across stages and reward existing
  skill; rank effort and improvement instead (badges, facts mastered this week, days played,
  personal-best gains).
- Revisit with the Phase 2 backend rather than changing hosting just for this.

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
