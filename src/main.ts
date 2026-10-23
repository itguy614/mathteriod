/**
 * Mathteroid entry point: wires audio, game, learning, store and UI together
 * and owns the screen flow (a small state machine driven by UI callbacks).
 */
import type { Fact, LevelConfig, LevelResult, Operation, Profile, Question, Settings } from './types';
import { AudioEngine, speechSupported } from './audio';
import { createGame } from './game/index';
import { LearningEngine, NEEDS_PRACTICE, isSkillId, weakestFacts } from './learning/index';
import { LocalProfileStore, resetProfileProgress, stardustForLevel, stardustForPractice } from './store';
import { Router } from './ui/router';
import { hangarCenter } from './ui/layout';
import { profilePickerScreen } from './ui/screens/profiles';
import { newPilotScreen } from './ui/screens/newPilot';
import { homeScreen } from './ui/screens/home';
import { hangarScreen } from './ui/screens/hangar';
import { levelIntroScreen } from './ui/screens/intro';
import { playingScreen } from './ui/screens/playing';
import { pauseScreen } from './ui/screens/pause';
import { resultsScreen } from './ui/screens/results';
import { settingsScreen } from './ui/screens/settings';
import { practiceScreen } from './ui/screens/practice';

const LAST_PILOT_KEY = 'mathteroid:lastPilot';

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const gameRoot = document.getElementById('game-root')!;
const uiRoot = document.getElementById('ui-root')!;

const audio = new AudioEngine();
const game = createGame(gameRoot, audio);
const store = new LocalProfileStore();
const router = new Router(uiRoot);

// Music is requested up-front; AudioEngine starts it on the first user gesture.
audio.startMusic();

// Every UI button gets a soft click (AudioEngine throttles duplicates).
uiRoot.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest('button');
  if (btn && !btn.disabled && !btn.hasAttribute('data-nosfx')) audio.play('click');
});

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let profile: Profile | null = null;
let playing = false;
let paused = false;

/**
 * The running practice session, or null during missions. The streak (clears in
 * a row) drives the pace ramp; it resets on a fail, and a new session (picked
 * from the picker) starts fresh.
 */
interface PracticeSession {
  /** Skill ids, or the fixed fact list of a "Needs practice" session. */
  selection: { kind: 'skills'; ids: string[] } | { kind: 'weak'; facts: Fact[] };
  streak: number;
  /** Levels played this session (kid-facing round number). */
  round: number;
}
let practice: PracticeSession | null = null;

let saveChain: Promise<void> = Promise.resolve();
/** Serialize saves so a slow write never overwrites a newer one. */
function persist(p: Profile): Promise<void> {
  const snapshot = structuredClone(p);
  saveChain = saveChain.then(() => store.save(snapshot)).catch((err) => console.error('[main] save failed', err));
  return saveChain;
}

function readLastPilot(): string | null {
  try {
    return localStorage.getItem(LAST_PILOT_KEY);
  } catch {
    return null;
  }
}

function writeLastPilot(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_PILOT_KEY, id);
    else localStorage.removeItem(LAST_PILOT_KEY);
  } catch {
    /* storage unavailable: convenience only */
  }
}

function requireProfile(): Profile {
  if (!profile) throw new Error('No active pilot');
  return profile;
}

// ---------------------------------------------------------------------------
// Screens / routes
// ---------------------------------------------------------------------------

async function goProfiles(): Promise<void> {
  game.showAttract();
  const profiles = await store.list();
  router.show(
    profilePickerScreen({
      profiles,
      lastPilotId: readLastPilot(),
      onPick: selectProfile,
      onNew: goNewPilot,
    }),
  );
}

function goNewPilot(): void {
  router.show(
    newPilotScreen({
      game,
      audio,
      onCreate: async (name, body) => {
        const p = await store.create(name, body);
        audio.play('purchase');
        selectProfile(p);
      },
      onBack: () => void goProfiles(),
    }),
  );
}

function selectProfile(p: Profile): void {
  profile = p;
  writeLastPilot(p.id);
  audio.setSettings(p.settings);
  goHome();
}

function goHome(): void {
  practice = null;
  const p = requireProfile();
  const engine = new LearningEngine(p.learning);
  game.showHangar(p.loadout, hangarCenter());
  router.show(
    homeScreen({
      profile: p,
      stageName: engine.currentStage().name,
      stageProgress: engine.stageProgress(),
      onLaunch: launchLevel,
      onPractice: goPractice,
      onHangar: goHangar,
      onSettings: goSettings,
      onSwitchPilot: () => void goProfiles(),
    }),
  );
}

function goHangar(): void {
  router.show(
    hangarScreen({
      profile: requireProfile(),
      game,
      audio,
      router,
      onSave: (next) => {
        profile = next;
        return persist(next);
      },
      onBack: goHome,
    }),
  );
}

let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;

function goSettings(): void {
  const p = requireProfile();
  router.show(
    settingsScreen({
      profile: p,
      router,
      speechAvailable: speechSupported(),
      onChange: (s: Settings) => {
        const cur = requireProfile();
        cur.settings = s;
        audio.setSettings(s);
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => void persist(cur), 300);
      },
      onTestSpeech: () => audio.speakTest('7 plus 5'),
      onTestSfx: () => audio.play('correct'),
      onReset: async () => {
        profile = resetProfileProgress(requireProfile());
        await persist(profile);
        goHome();
      },
      onDelete: async () => {
        const id = requireProfile().id;
        clearTimeout(settingsSaveTimer);
        await saveChain;
        await store.delete(id);
        if (readLastPilot() === id) writeLastPilot(null);
        profile = null;
        await goProfiles();
      },
      onBack: goHome,
    }),
  );
}

// ---------------------------------------------------------------------------
// Level flow
// ---------------------------------------------------------------------------

function launchLevel(): void {
  practice = null;
  const p = requireProfile();
  const engine = new LearningEngine(p.learning);
  let config: LevelConfig;
  try {
    config = engine.buildLevel();
  } catch (err) {
    console.error('[main] could not build level', err);
    goHome();
    return;
  }
  game.showAttract();
  router.show(levelIntroScreen({ config, audio, onDone: () => startPlay(engine, config) }));
}

function startPlay(engine: LearningEngine, config: LevelConfig): void {
  const p = requireProfile();
  playing = true;
  paused = false;
  router.show(playingScreen());
  game.startLevel(config, p.loadout, {
    onQuestion: (q: Question) => audio.speak(q.speech),
    onPause: pauseGame,
    onLevelEnd: (result: LevelResult) => void (practice ? finishPractice(engine, result) : finishLevel(engine, result)),
  }, {
    controlMode: p.settings.controlMode,
    touchMode: p.settings.touchMode,
    // New pilots get the fading controls hint on their first few levels.
    showControlsHint: p.learning.levelsCleared < 3,
  });
  // The countdown may have finished while the tab was in the background.
  if (document.hidden) pauseGame();
}

function pauseGame(): void {
  if (!playing || paused) return;
  paused = true;
  game.pause();
  audio.setThrust(false);
  router.show(
    practice
      ? pauseScreen({ onResume: resumeGame, onQuit: quitToBase, quitLabel: 'Quit', quitIcon: '🎯' })
      : pauseScreen({ onResume: resumeGame, onQuit: quitToBase }),
  );
}

function resumeGame(): void {
  if (!playing || !paused) return;
  paused = false;
  router.show(playingScreen());
  game.resume();
}

function quitToBase(): void {
  playing = false;
  paused = false;
  game.stop();
  audio.setThrust(false);
  // Practice quits back to the picker (its back button leads home).
  if (practice) goPractice();
  else goHome();
}

async function finishLevel(engine: LearningEngine, result: LevelResult): Promise<void> {
  if (!playing) return;
  playing = false;
  paused = false;
  audio.setThrust(false);
  const p = requireProfile();
  const summary = engine.recordLevel(result);
  p.learning = engine.getState();
  const earned = stardustForLevel(result, summary);
  p.stardust += earned;
  const newBest = result.score > p.bestScore && result.score > 0;
  if (newBest) p.bestScore = result.score;
  await persist(p);
  router.show(
    resultsScreen({
      result,
      summary,
      earned,
      newBest,
      audio,
      onNext: launchLevel,
      onRetry: launchLevel,
      onHangar: goHangar,
      onBase: goHome,
      onPracticeFacts: practiceMissedFacts,
    }),
  );
}

// ---------------------------------------------------------------------------
// Practice flow
// ---------------------------------------------------------------------------

function goPractice(): void {
  const p = requireProfile();
  practice = null;
  game.showAttract();
  const stageOp = new LearningEngine(p.learning).currentStage().op;
  const defaultOp: Operation = stageOp === 'mixed' ? 'add' : stageOp;
  router.show(
    practiceScreen({
      learning: p.learning,
      selected: (p.practiceSkills ?? []).filter(isSkillId),
      defaultOp,
      onStart: (ids) => {
        const cur = requireProfile();
        cur.practiceSkills = [...ids];
        void persist(cur);
        startPracticeSession({ kind: 'skills', ids });
      },
      onNeedsPractice: () => {
        const facts = weakestFacts(requireProfile().learning);
        if (facts.length) startPracticeSession({ kind: 'weak', facts });
      },
      onBack: goHome,
    }),
  );
}

/**
 * "Practice these" on the results screen: drill the facts just missed, topped
 * up with the player's other weakest facts so a session never has just one or two.
 */
function practiceMissedFacts(missed: Fact[]): void {
  const facts = [...missed];
  for (const f of weakestFacts(requireProfile().learning)) {
    if (facts.length >= NEEDS_PRACTICE.minSeen) break;
    if (!facts.some((m) => m.id === f.id)) facts.push(f);
  }
  startPracticeSession({ kind: 'weak', facts });
}

function startPracticeSession(selection: PracticeSession['selection']): void {
  practice = { selection, streak: 0, round: 0 };
  launchPractice();
}

function launchPractice(): void {
  const p = requireProfile();
  const session = practice;
  if (!session) {
    goPractice();
    return;
  }
  session.round++;
  const engine = new LearningEngine(p.learning);
  const sel = session.selection;
  let config: LevelConfig;
  try {
    config =
      sel.kind === 'skills'
        ? engine.buildPracticeLevel(sel.ids, session.streak, { levelNumber: session.round })
        : engine.buildPracticeLevel(sel.facts, session.streak, { levelNumber: session.round, name: 'Needs practice' });
  } catch (err) {
    console.error('[main] could not build practice level', err);
    goPractice();
    return;
  }
  // "Practice · ×6 ×7 ×8" (shortened like the level name) over "Round 2".
  const kicker = sel.kind === 'skills' ? config.stageName.replace(/^Practice: /, 'Practice · ') : '💪 Needs practice';
  game.showAttract();
  router.show(
    levelIntroScreen({
      config,
      audio,
      kicker,
      title: `Round ${session.round}`,
      onDone: () => startPlay(engine, config),
    }),
  );
}

async function finishPractice(engine: LearningEngine, result: LevelResult): Promise<void> {
  if (!playing || !practice) return;
  playing = false;
  paused = false;
  audio.setThrust(false);
  const session = practice;
  const p = requireProfile();
  const summary = engine.recordPractice(result);
  p.learning = engine.getState();
  const earned = stardustForPractice(result, summary);
  p.stardust += earned;
  // Practice scores never touch bestScore (players pick their own difficulty).
  session.streak = result.outcome === 'cleared' ? session.streak + 1 : 0;
  await persist(p);
  router.show(
    resultsScreen({
      result,
      summary,
      earned,
      newBest: false,
      audio,
      onNext: launchPractice,
      onRetry: launchPractice,
      onHangar: goHangar,
      onBase: goHome,
      onPracticeFacts: practiceMissedFacts,
      practice: { streak: session.streak, onPlayAgain: launchPractice, onChangeSkills: goPractice },
    }),
  );
}

// ---------------------------------------------------------------------------
// Global input / lifecycle
// ---------------------------------------------------------------------------

// The game pauses itself on P/Esc and reports it via onPause; while the pause
// menu is up, the same keys resume. The game preventDefault()s the key press
// that paused it, so skip that one or we'd resume on the same event.
window.addEventListener('keydown', (e) => {
  if (!playing || !paused || e.defaultPrevented || e.repeat) return;
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    e.preventDefault();
    resumeGame();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame();
    audio.suspend();
  } else {
    audio.resumeContext();
  }
});
window.addEventListener('blur', () => pauseGame());

void goProfiles();
