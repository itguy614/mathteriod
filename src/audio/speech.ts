/** Text-to-speech via the Web Speech API, tuned for early readers. */

const SYMBOL_WORDS: [RegExp, string][] = [
  [/\s*[−–—]\s*/g, ' minus '], // unicode minus, en and em dashes
  [/(\d)\s*-\s*(\d)/g, '$1 minus $2'], // ASCII hyphen between numbers
  [/\s*\+\s*/g, ' plus '],
  [/\s*[×✕*]\s*/g, ' times '],
  [/(\d)\s*x\s*(\d)/gi, '$1 times $2'],
  [/\s*[÷/]\s*/g, ' divided by '],
  [/\s*=\s*/g, ' equals '],
  [/\?/g, ' '],
];

/** Make sure math symbols are never read out as symbol names. */
export function speechFriendly(text: string): string {
  let out = text;
  for (const [re, word] of SYMBOL_WORDS) out = out.replace(re, word);
  return out.replace(/\s+/g, ' ').trim();
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined && cachedVoice !== null) return cachedVoice;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const preferred = [/google us english/i, /samantha/i, /aria/i, /jenny/i, /natural/i, /zira/i, /en-us/i];
  for (const re of preferred) {
    const v = en.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return (cachedVoice = v);
  }
  cachedVoice = en.find((v) => v.localService) ?? en[0] ?? voices[0] ?? null;
  return cachedVoice;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speakNow(text: string): void {
  if (!speechSupported()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(speechFriendly(text));
    const voice = pickVoice(synth);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = 'en-US';
    }
    u.rate = 0.85;
    u.pitch = 1.05;
    u.volume = 1;
    synth.speak(u);
  } catch {
    /* speech is a nice-to-have */
  }
}

/**
 * iOS only lets speech start from a tap until it has spoken once: call this from
 * a user gesture to say nothing, so later (timer-driven) speech is allowed.
 */
export function primeSpeech(): void {
  if (!speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function cancelSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

// Voices load asynchronously in some browsers.
if (speechSupported()) {
  try {
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      cachedVoice = undefined;
    });
  } catch {
    /* ignore */
  }
}
