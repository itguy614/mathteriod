/**
 * Standalone harness for the game engine: /src/game/dev.html
 * Stub question provider (addition facts), console audio, loadout switcher.
 */
import { CATALOG } from '../catalog';
import type { AudioBus, ControlMode, LevelConfig, LevelOptions, Question, QuestionProvider, ShipLoadout } from '../types';
import { createGame } from './index';

const logEl = () => document.getElementById('dev-log');
function log(msg: string): void {
  console.log('[dev]', msg);
  const el = logEl();
  if (!el) return;
  el.textContent = `${msg}\n${el.textContent ?? ''}`.slice(0, 4000);
}

const audio: AudioBus = {
  play: (name) => log(`sfx ${name}`),
  setThrust: (on) => console.log('[dev] thrust', on),
  startMusic: () => log('music start'),
  stopMusic: () => log('music stop'),
  speak: (text) => log(`speak "${text}"`),
};

const rint = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

/** Addition facts with addends 1..9 (answers 2..18). */
function additionProvider(): QuestionProvider {
  const make = (answer: number): Question => {
    const a = rint(Math.max(1, answer - 9), Math.min(9, answer - 1));
    const b = answer - a;
    return { factId: `add:${a}:${b}`, prompt: `${a} + ${b}`, speech: `${a} plus ${b}`, answer };
  };
  return {
    initialValues(count) {
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        let v = rint(2, 18);
        for (let t = 0; t < 6 && out.includes(v); t++) v = rint(2, 18);
        out.push(v);
      }
      return out;
    },
    pickQuestion(live) {
      return make(live[Math.floor(Math.random() * live.length)]);
    },
    splitValue(current) {
      let v = current.answer;
      while (v === current.answer) v = Math.min(18, Math.max(2, current.answer + rint(-3, 3)));
      return v;
    },
  };
}

// --------------------------------------------------------------------------- panel

const panel = document.getElementById('dev-panel')!;
const toggle = document.getElementById('dev-toggle')!;
toggle.addEventListener('click', () => {
  panel.classList.toggle('hidden');
  toggle.textContent = panel.classList.contains('hidden') ? 'Dev ▸' : 'Dev ▾';
});

const opts = (kind: string) =>
  CATALOG.filter((i) => i.kind === kind)
    .map((i) => `<option value="${i.id}">${i.name}</option>`)
    .join('');

panel.innerHTML = `
  <h3>Loadout</h3>
  <label>Body <select id="d-body">${opts('body')}</select></label>
  <label>Hull color <select id="d-color">${opts('color')}</select></label>
  <label>Laser <select id="d-laser">${opts('laser')}</select></label>
  <label>Laser color <select id="d-lcolor">${opts('color')}</select></label>
  <label>Trail <select id="d-trail">${opts('trail')}</select></label>
  ${CATALOG.filter((i) => i.kind === 'perk')
    .map((p) => `<label>${p.name} <input type="checkbox" class="d-perk" value="${p.id}"></label>`)
    .join('')}
  <h3>Level</h3>
  <label>Level # <input id="d-level" type="number" value="1" min="1"></label>
  <label>Asteroids <input id="d-count" type="number" value="4" min="1" max="12"></label>
  <label>Speed <input id="d-speed" type="number" value="3" min="1" max="20" step="0.5"></label>
  <label>Max asteroids <input id="d-max" type="number" value="8" min="1" max="40"></label>
  <label>Controls <select id="d-mode"><option value="rotate">Rotate (classic)</option><option value="direct">Direct (8-way)</option></select></label>
  <label>Controls hint <input id="d-hint" type="checkbox" checked></label>
  <div class="row">
    <button id="d-start">Start level</button>
    <button id="d-hangar">Hangar</button>
  </div>
  <label>Hangar center <input id="d-center" type="text" value="0.5,0.5" style="width:120px"></label>
  <div class="row">
    <button id="d-attract">Attract</button>
    <button id="d-pause">Pause</button>
    <button id="d-resume">Resume</button>
    <button id="d-stop">Stop</button>
  </div>
  <div id="dev-log"></div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadout(): ShipLoadout {
  return {
    body: $<HTMLSelectElement>('d-body').value,
    color: $<HTMLSelectElement>('d-color').value,
    laser: $<HTMLSelectElement>('d-laser').value,
    laserColor: $<HTMLSelectElement>('d-lcolor').value,
    trail: $<HTMLSelectElement>('d-trail').value,
    perks: Array.from(document.querySelectorAll<HTMLInputElement>('.d-perk'))
      .filter((c) => c.checked)
      .map((c) => c.value),
  };
}

const num = (id: string) => Number($<HTMLInputElement>(id).value);

function levelOptions(): LevelOptions {
  return {
    controlMode: $<HTMLSelectElement>('d-mode').value as ControlMode,
    showControlsHint: $<HTMLInputElement>('d-hint').checked,
  };
}

const game = createGame($('game-root'), audio);
let mode: 'idle' | 'level' | 'hangar' = 'idle';
(window as unknown as { game: typeof game }).game = game;

function start(): void {
  const config: LevelConfig = {
    stageId: 'dev-add',
    stageName: 'Addition: Launch Pad',
    levelNumber: num('d-level'),
    mode: 'classic',
    initialAsteroids: num('d-count'),
    asteroidSpeed: num('d-speed'),
    maxAsteroids: num('d-max'),
    eased: false,
    questions: additionProvider(),
  };
  mode = 'level';
  game.startLevel(config, loadout(), {
    onQuestion: (q) => log(`question ${q.prompt} (= ${q.answer})`),
    onAnswer: (e) => log(`answer ${e.correct ? '✓' : '✗'} ${e.chosenValue} in ${e.responseMs}ms (${e.factId})`),
    onShipHit: (h, n) => log(`ship hit ${h}/${n}`),
    // onPause is left out on purpose so the HUD's fallback pause card is used here;
    // in the real app main handles onPause with its own menu.
    onLevelEnd: (r) => {
      mode = 'idle';
      log(`LEVEL END ${r.outcome} score=${r.score} hits=${r.hitsTaken} answers=${r.answers.length} ${r.durationMs}ms`);
    },
  }, levelOptions());
  // let keyboard focus go to the game, not the button
  (document.activeElement as HTMLElement | null)?.blur();
}

$('d-start').addEventListener('click', start);
function center(): { x: number; y: number } {
  const [x, y] = $<HTMLInputElement>('d-center').value.split(',').map(Number);
  return { x: x || 0.5, y: y || 0.5 };
}
$('d-hangar').addEventListener('click', () => {
  mode = 'hangar';
  game.showHangar(loadout(), center());
});
$('d-attract').addEventListener('click', () => {
  mode = 'idle';
  game.showAttract();
});
$('d-pause').addEventListener('click', () => game.pause());
$('d-resume').addEventListener('click', () => game.resume());
$('d-stop').addEventListener('click', () => {
  mode = 'idle';
  game.stop();
});
panel.addEventListener('change', () => {
  if (mode === 'hangar') game.showHangar(loadout(), center());
  (document.activeElement as HTMLElement | null)?.blur();
});

// URL shortcuts for quick testing: ?hangar=phoenix  or  ?start=1
const params = new URLSearchParams(location.search);
const hb = params.get('hangar');
if (hb !== null) {
  if (hb) $<HTMLSelectElement>('d-body').value = hb;
  for (const k of ['color', 'laser', 'trail'] as const) {
    const v = params.get(k);
    if (v) $<HTMLSelectElement>(k === 'color' ? 'd-color' : `d-${k}`).value = v;
  }
  mode = 'hangar';
  game.showHangar(loadout());
} else if (params.get('start')) {
  const b = params.get('body');
  if (b) $<HTMLSelectElement>('d-body').value = b;
  if (params.get('shield')) (document.querySelector('.d-perk[value=shield]') as HTMLInputElement).checked = true;
  // ?mode=direct  ?hint=0  ?count=5  ?speed=4  ?laser=twin
  const m = params.get('mode');
  if (m === 'direct' || m === 'rotate') $<HTMLSelectElement>('d-mode').value = m;
  if (params.get('hint') === '0') $<HTMLInputElement>('d-hint').checked = false;
  for (const k of ['count', 'speed'] as const) {
    const v = params.get(k);
    if (v) $<HTMLInputElement>(`d-${k}`).value = v;
  }
  const lz = params.get('laser');
  if (lz) $<HTMLSelectElement>('d-laser').value = lz;
  start();
}
