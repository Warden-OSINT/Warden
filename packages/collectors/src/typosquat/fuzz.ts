import { domainToASCII } from 'node:url';

// Generador de dominios parecidos (typosquatting). Sigue las técnicas de dnstwist
// (Apache-2.0) pero implementado aquí: así la única red que se usa es dns.google y no
// hay modos activos (descarga de páginas, banners, pruebas SMTP) que desactivar.

/** Sufijos de dos niveles comunes; los demás se asumen de un nivel (com, mx, io…). */
const TWO_LEVEL_SUFFIXES = new Set([
  'com.mx', 'org.mx', 'net.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'com.br', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.gt', 'co.uk', 'com.au',
]);

const ALT_SUFFIXES = ['com', 'net', 'org', 'mx', 'com.mx', 'co', 'io', 'info', 'biz', 'online', 'site', 'app', 'xyz', 'lat'];

// Palabras que se añaden al nombre en campañas de phishing (español e inglés).
const DICTIONARY = ['login', 'secure', 'seguro', 'soporte', 'support', 'pago', 'pagos', 'cuenta', 'mail', 'portal', 'app', 'online', 'mx', 'verify', 'banca'];

const KEYBOARD: Record<string, string> = {
  '1': '2q', '2': '3wq1', '3': '4ew2', '4': '5re3', '5': '6tr4', '6': '7yt5', '7': '8uy6', '8': '9iu7', '9': '0oi8', '0': 'po9',
  q: '12wa', w: '3esaq2', e: '4rdsw3', r: '5tfde4', t: '6ygfr5', y: '7uhgt6', u: '8ijhy7', i: '9okju8', o: '0plki9', p: 'lo0',
  a: 'qwsz', s: 'edxzaw', d: 'rfcxse', f: 'tgvcdr', g: 'yhbvft', h: 'ujnbgy', j: 'ikmnhu', k: 'olmji', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

const ASCII_HOMOGLYPHS: Record<string, string[]> = {
  a: ['4'], b: ['d', 'lb'], d: ['b', 'cl'], e: ['3'], g: ['q', '9'], i: ['1', 'l'], l: ['1', 'i'],
  m: ['n', 'nn', 'rn'], n: ['m', 'r'], o: ['0'], q: ['g'], s: ['5'], u: ['v'], w: ['vv'], z: ['2'],
};
const MULTI_HOMOGLYPHS: [string, string][] = [['rn', 'm'], ['vv', 'w'], ['cl', 'd'], ['nn', 'm']];
// Caracteres cirílicos idénticos a letras latinas: el dominio resultante es IDN (punycode).
const UNICODE_HOMOGLYPHS: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у' };

const VOWELS = 'aeiou';
const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface SplitDomain {
  /** Nombre registrable sin sufijo (`empresa` en `www.empresa.com.mx`). */
  label: string;
  suffix: string;
}

/** Separa el dominio registrable: ignora subdominios, que no se pueden registrar por separado. */
export function splitDomain(domain: string): SplitDomain {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.');
  const two = parts.slice(-2).join('.');
  const suffixSize = parts.length > 2 && TWO_LEVEL_SUFFIXES.has(two) ? 2 : 1;
  const label = parts[parts.length - suffixSize - 1];
  if (!label) throw new Error(`Dominio sin nombre registrable: ${domain}`);
  return { label, suffix: parts.slice(-suffixSize).join('.') };
}

export interface Permutation {
  domain: string;
  /** Técnica que lo generó (para evidencia y depuración). */
  fuzzer: string;
}

function labelVariants(label: string): [string, string][] {
  const out: [string, string][] = [];
  const add = (fuzzer: string, value: string) => out.push([fuzzer, value]);

  for (let i = 0; i < label.length; i++) {
    const ch = label[i]!;
    const before = label.slice(0, i);
    const after = label.slice(i + 1);
    add('omission', before + after);
    add('repetition', before + ch + ch + after);
    if (i < label.length - 1) add('transposition', before + label[i + 1] + ch + label.slice(i + 2));
    if (i > 0) add('hyphenation', `${before}-${ch}${after}`);
    for (const key of KEYBOARD[ch] ?? '') {
      add('replacement', before + key + after);
      add('insertion', before + key + ch + after);
      add('insertion', before + ch + key + after);
    }
    if (VOWELS.includes(ch)) for (const v of VOWELS) if (v !== ch) add('vowel-swap', before + v + after);
    for (const glyph of ASCII_HOMOGLYPHS[ch] ?? []) add('homoglyph', before + glyph + after);
    const unicode = UNICODE_HOMOGLYPHS[ch];
    if (unicode) add('homoglyph', before + unicode + after);
    for (let bit = 0; bit < 8; bit++) {
      const flipped = String.fromCharCode(ch.charCodeAt(0) ^ (1 << bit)).toLowerCase();
      if (/[a-z0-9-]/.test(flipped)) add('bitsquatting', before + flipped + after);
    }
  }
  for (const [from, to] of MULTI_HOMOGLYPHS) {
    for (let i = label.indexOf(from); i !== -1; i = label.indexOf(from, i + 1)) {
      add('homoglyph', label.slice(0, i) + to + label.slice(i + from.length));
    }
  }
  for (const ch of ALPHANUM) add('addition', label + ch);
  for (const word of DICTIONARY) {
    add('dictionary', `${label}-${word}`);
    add('dictionary', `${word}-${label}`);
    add('dictionary', label + word);
  }
  return out;
}

/** Convierte a ASCII (punycode) y valida; undefined si no es un nombre registrable. */
function toAsciiLabel(value: string): string | undefined {
  // `xn--` y similares (guiones en posiciones 3-4) están reservados para IDN.
  if (/^[a-z0-9-]+$/.test(value)) return LABEL.test(value) && value.slice(2, 4) !== '--' ? value : undefined;
  const ascii = domainToASCII(`${value}.com`).replace(/\.com$/, '');
  return ascii && LABEL.test(ascii) ? ascii : undefined;
}

/**
 * Dominios parecidos al registrable de `domain`, sin repetir ni incluir el original.
 * Se acota a `limit` priorizando el orden de las técnicas (las más comunes primero).
 */
export function generatePermutations(domain: string, limit = 1500): Permutation[] {
  const { label, suffix } = splitDomain(domain);
  const original = `${label}.${suffix}`;
  const seen = new Set([original]);
  const result: Permutation[] = [];
  const push = (fuzzer: string, candidate: string) => {
    if (seen.has(candidate) || result.length >= limit) return;
    seen.add(candidate);
    result.push({ domain: candidate, fuzzer });
  };

  for (const alt of ALT_SUFFIXES) if (alt !== suffix) push('tld-swap', `${label}.${alt}`);
  for (const [fuzzer, variant] of labelVariants(label)) {
    const ascii = toAsciiLabel(variant);
    if (ascii) push(fuzzer, `${ascii}.${suffix}`);
  }
  return result;
}
