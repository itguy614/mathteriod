/**
 * Mathteroid entry point: wires audio, game, learning, store and UI together
 * and owns the screen flow (a small state machine driven by UI callbacks).
 */
import type { LevelConfig, LevelResult, Profile, Question, Settings } from './types';
import { AudioEngine, speechSupported } from './audio';
import { createGame } from './game/index';
import { LearningEngine } from './learning/index';
import { LocalProfileStore, resetProfileProgress, stardustForLevel } from './store';
import { Router } from './ui/router';
import { hangarCenter } from './ui/layout';
import { titleScreen } from './ui/screens/title';
import { profilePickerScreen } from './ui/screens/profiles';
import { newPilotScreen } from './ui/screens/newPilot';
import { homeScreen } from './ui/screens/home';
import { hangarScreen } from './ui/screens/hangar';
import { levelIntroScreen } from './ui/screens/intro';
import { playingScreen } from './ui/screens/playing';
import { pauseScreen } from './ui/screens/pause';
import { resultsScreen } from './ui/screens/results';
import { settingsScreen } from './ui/screens/settings';

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

function goTitle(): void {
  game.showAttract();
  router.show(titleScreen({ onPlay: () => void goProfiles() }));
}

async function goProfiles(): Promise<void> {
  game.showAttract();
  const profiles = await store.list();
  if (profiles.length === 0) {
    goNewPilot();
    return;
  }
  router.show(
    profilePickerScreen({
      profiles,
      lastPilotId: readLastPilot(),
      onPick: selectProfile,
      onNew: goNewPilot,
      onBack: goTitle,
    }),
  );
}

function goNewPilot(): void {
  router.show(
    newPilotScreen({
      game,
      audio,
      onCreate: async (name, avatar, body) => {
        const p = await store.create(name, avatar, body);
        audio.play('purchase');
        selectProfile(p);
      },
      onBack: () => void goProfilesOrTitle(),
    }),
  );
}

async function goProfilesOrTitle(): Promise<void> {
  if ((await store.list()).length) await goProfiles();
  else goTitle();
}

function selectProfile(p: Profile): void {
  profile = p;
  writeLastPilot(p.id);
  audio.setSettings(p.settings);
  goHome();
}

function goHome(): void {
  const p = requireProfile();
  const engine = new LearningEngine(p.learning);
  game.showHangar(p.loadout, hangarCenter());
  router.show(
    homeScreen({
      profile: p,
      stageName: engine.currentStage().name,
      stageProgress: engine.stageProgress(),
      onLaunch: launchLevel,
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
        await goProfilesOrTitle();
      },
      onBack: goHome,
    }),
  );
}

// ---------------------------------------------------------------------------
// Level flow
// ---------------------------------------------------------------------------

function launchLevel(): void {
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
    onLevelEnd: (result: LevelResult) => void finishLevel(engine, result),
  }, {
    controlMode: p.settings.controlMode,
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
  router.show(pauseScreen({ onResume: resumeGame, onQuit: quitToBase }));
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
  goHome();
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

goTitle();
