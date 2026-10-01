/**
 * Animated landing art scene, ported 1:1 from the approved static design.
 * buildScene() returns the full inner SVG markup string; COPIES holds the
 * rotating tweet-card copy (same timing as the original script).
 */

export type TweetCopy = [string, string][];

export const COPIES: TweetCopy[] = [
  [
    ['Just landed in Lucknow.', 'First stop: chaat, obviously.'],
    ['Found the best kebab', 'stall. No, I won’t share.'],
    ['Rain, tea and old songs.', 'Perfect evening.'],
  ],
  [
    ['Match starts in ten.', 'Who’s watching with me?'],
    ['That last over.', 'My heart cannot handle this.'],
    ['Called it. Told you all', 'at the start of the game.'],
  ],
  [
    ['Anyone else’s timeline', 'unusually wholesome today?'],
    ['Someone in my replies', 'just made my whole week.'],
    ['Good morning to everyone', 'except my alarm clock.'],
  ],
  [
    ['Our little bookshop just', 'hit 1,000 readers today.'],
    ['New shelf arrived.', 'Poetry finally has a home.'],
    ['A stranger left a note', 'in a book. Now I’m crying.'],
  ],
];

const N = '#0b2545';
const CREAM = '#fff6e6';
const BIRD =
  'M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z';

interface PersonOpts {
  skin: string;
  hair: string;
  shirt: string;
  h: 'afro' | 'long' | 'bun' | 'short';
  f: number;
  b?: boolean;
}

function person(i: number, x: number, y: number, o: PersonOpts): string {
  let g =
    '<g class="twl-breathe" style="animation-delay:-' +
    i * 0.9 +
    's"><g transform="translate(' +
    x +
    ' ' +
    y +
    ')" stroke="' +
    N +
    '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">';
  if (o.h === 'afro') g += '<circle cy="-14" r="48" fill="' + o.hair + '"/>';
  if (o.h === 'long')
    g += '<path d="M-42 -6C-46 -54 46 -54 42 -6L50 66H-50Z" fill="' + o.hair + '"/>';
  if (o.h === 'bun') g += '<circle cy="-54" r="16" fill="' + o.hair + '"/>';
  g += '<path d="M-70 210C-70 92 -40 58 0 58C40 58 70 92 70 210Z" fill="' + o.shirt + '"/>';
  g += '<rect x="-11" y="28" width="22" height="34" rx="8" fill="' + o.skin + '"/>';
  g += '<ellipse rx="34" ry="38" fill="' + o.skin + '"/>';
  if (o.h !== 'afro')
    g +=
      '<path d="M-35 -6C-38 -52 38 -52 35 -6C22 -26 -18 -26 -35 -6Z" fill="' + o.hair + '"/>';
  if (o.b)
    g +=
      '<path d="M-33 4C-32 50 32 50 33 4C22 24 -22 24 -33 4Z" fill="' + o.hair + '"/>';
  g +=
    '<g stroke="none" fill="' +
    N +
    '"><circle cx="-12" cy="-2" r="3.6"/><circle cx="12" cy="-2" r="3.6"/></g>';
  g += '<path d="M-9 14Q0 23 9 14" fill="none" stroke="' + (o.b ? CREAM : N) + '" stroke-width="3"/>';
  let ln = '';
  for (let k = 0; k < 8; k++)
    ln +=
      '<rect x="37" y="' +
      (91 + k * 8) +
      '" width="' +
      (k % 2 ? 9 : 13) +
      '" height="3" rx="1.5" fill="' +
      CREAM +
      '" stroke="none"/>';
  g +=
    '<g transform="scale(' +
    o.f +
    ' 1)"><rect x="30" y="84" width="26" height="44" rx="6" fill="' +
    N +
    '"/><clipPath id="cp' +
    i +
    '"><rect x="34" y="89" width="18" height="30" rx="3"/></clipPath><rect x="34" y="89" width="18" height="30" rx="3" fill="#4cb4f5" stroke="none"/><g clip-path="url(#cp' +
    i +
    ')"><g class="twl-scroll" style="animation-delay:-' +
    i * 0.5 +
    's">' +
    ln +
    '</g></g><circle cx="38" cy="132" r="10" fill="' +
    o.skin +
    '"/></g>';
  return g + '</g></g>';
}

function card(
  i: number,
  x: number,
  y: number,
  w: number,
  tx: number,
  ty: number,
  name: string,
  h: string,
  copy: [string, string][],
  av: string,
  d: number,
): string {
  const H = 84;
  const bx = Math.max(x + 30, Math.min(tx, x + w - 30));
  return (
    '<g class="twl-pop" style="animation-delay:' +
    d +
    's"><path d="M' +
    (bx - 14) +
    ' ' +
    (y + H - 2) +
    'L' +
    tx +
    ' ' +
    ty +
    'L' +
    (bx + 14) +
    ' ' +
    (y + H - 2) +
    'Z" fill="' +
    CREAM +
    '" stroke="' +
    N +
    '" stroke-width="3" stroke-linejoin="round"/>' +
    '<rect x="' +
    (x + 5) +
    '" y="' +
    (y + 5) +
    '" width="' +
    w +
    '" height="' +
    H +
    '" rx="14" fill="' +
    N +
    '"/>' +
    '<rect x="' +
    x +
    '" y="' +
    y +
    '" width="' +
    w +
    '" height="' +
    H +
    '" rx="14" fill="' +
    CREAM +
    '" stroke="' +
    N +
    '" stroke-width="3"/>' +
    '<circle cx="' +
    (x + 26) +
    '" cy="' +
    (y + 26) +
    '" r="14" fill="' +
    av +
    '" stroke="' +
    N +
    '" stroke-width="2.5"/>' +
    '<text x="' +
    (x + 26) +
    '" y="' +
    (y + 31) +
    '" font-size="14" font-weight="700" text-anchor="middle" fill="' +
    N +
    '">' +
    name[0] +
    '</text>' +
    '<text x="' +
    (x + 48) +
    '" y="' +
    (y + 31) +
    '" font-size="14" font-weight="700" fill="' +
    N +
    '">' +
    name +
    ' <tspan fill="#6b7a90" font-weight="400">@' +
    h +
    '</tspan></text>' +
    '<g class="twl-txt" id="t' +
    i +
    '" font-size="14" fill="' +
    N +
    '"><text x="' +
    (x + 16) +
    '" y="' +
    (y + 56) +
    '">' +
    copy[0][0] +
    '</text><text x="' +
    (x + 16) +
    '" y="' +
    (y + 74) +
    '">' +
    copy[0][1] +
    '</text></g></g>'
  );
}

function sticker(x: number, y: number, r: number, fill: string, glyph: string, d: number): string {
  return (
    '<g class="twl-float" style="animation-delay:-' +
    d +
    's"><g class="twl-pop" style="animation-delay:' +
    d +
    's"><g transform="translate(' +
    x +
    ' ' +
    y +
    ') rotate(' +
    r +
    ')"><circle cx="4" cy="4" r="27" fill="' +
    N +
    '"/><circle r="27" fill="' +
    fill +
    '" stroke="' +
    N +
    '" stroke-width="3"/>' +
    glyph +
    '</g></g></g>'
  );
}

const heart =
  '<g class="twl-beat"><path d="M0 11C-22 -3-12 -21 0-8C12-21 22-3 0 11Z" fill="' +
  CREAM +
  '" stroke="' +
  N +
  '" stroke-width="3" stroke-linejoin="round"/></g>';
const rt =
  '<path d="M-11-4H8M3-10L9-4L3 2M11 6H-8M-3 0L-9 6L-3 12" fill="none" stroke="' +
  N +
  '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
const cm =
  '<path d="M-12-10H12V5H1L-7 13V5H-12Z" fill="' +
  CREAM +
  '" stroke="' +
  N +
  '" stroke-width="3" stroke-linejoin="round"/>';

function spark(x: number, y: number, k: number, d: number): string {
  return (
    '<g class="twl-twinkle" style="animation-delay:-' +
    d +
    's"><path transform="translate(' +
    x +
    ' ' +
    y +
    ') scale(' +
    k +
    ')" d="M0-10Q1-1 10 0Q1 1 0 10Q-1 1-10 0Q-1-1 0-10Z" fill="' +
    CREAM +
    '"/></g>'
  );
}

function mini(x: number, fill: string, d: number): string {
  return (
    '<g transform="translate(' +
    x +
    ' 330)"><g class="twl-rise" style="animation-delay:' +
    d +
    's"><path d="M0 7C-15-2-9-15 0-6C9-15 15-2 0 7Z" fill="' +
    fill +
    '" stroke="' +
    N +
    '" stroke-width="2.5" stroke-linejoin="round"/></g></g>'
  );
}

export function buildScene(): string {
  let s =
    '<circle cx="-20" cy="720" r="320" fill="#1682d4"/><circle cx="740" cy="40" r="250" fill="#4cb4f5"/>';
  s +=
    '<circle cx="373" cy="213" r="118" fill="' +
    N +
    '"/><circle cx="360" cy="200" r="118" fill="' +
    CREAM +
    '" stroke="' +
    N +
    '" stroke-width="4"/>';
  s +=
    '<circle class="twl-ring" cx="360" cy="200" r="122" fill="none" stroke="' +
    CREAM +
    '" stroke-width="3"/><circle class="twl-ring" style="animation-delay:-2s" cx="360" cy="200" r="122" fill="none" stroke="' +
    CREAM +
    '" stroke-width="3"/>';
  s +=
    '<path transform="translate(360 200) scale(6) translate(-12 -12)" d="' +
    BIRD +
    '" fill="#1d9bf0" stroke="' +
    N +
    '" stroke-width=".55" stroke-linejoin="round"/>';
  s += mini(45, '#ff6b5b', 0) + mini(195, CREAM, 1.4) + mini(525, '#ffc93c', 2.8) + mini(675, '#ff6b5b', 4.1);
  s +=
    sticker(150, 120, -12, '#ff6b5b', heart, 2.8) +
    sticker(590, 110, 10, '#7ee0c3', rt, 3) +
    sticker(130, 290, 8, '#ffc93c', cm, 3.2) +
    sticker(600, 300, -8, '#ffc93c', heart, 3.4);
  s += spark(250, 60, 1.3, 0) + spark(520, 60, 1, 0.8) + spark(60, 210, 1, 1.6) + spark(670, 210, 1.3, 0.4);
  s += person(0, 100, 545, { skin: '#a86b3c', hair: '#1c1c1c', shirt: '#ffc93c', h: 'afro', f: 1 });
  s += person(1, 262, 620, { skin: '#f0c08a', hair: '#5a3420', shirt: '#ff6b5b', h: 'long', f: -1 });
  s += person(2, 458, 620, { skin: '#d99a63', hair: '#1c1c1c', shirt: '#7ee0c3', h: 'short', b: true, f: 1 });
  s += person(3, 630, 545, { skin: '#7a4a2b', hair: '#2b1a12', shirt: '#8b7cf6', h: 'bun', f: -1 });
  s += card(0, 10, 350, 225, 100, 498, 'Aarav', 'aarav', COPIES[0], '#ffc93c', 0.3);
  s += card(1, 140, 452, 225, 262, 572, 'Meera', 'meera', COPIES[1], '#ff6b5b', 0.9);
  s += card(2, 385, 452, 205, 458, 572, 'Sam', 'samdoes', COPIES[2], '#7ee0c3', 1.5);
  s += card(3, 480, 350, 225, 630, 498, 'Noor', 'noor.reads', COPIES[3], '#8b7cf6', 2.1);
  return s;
}
