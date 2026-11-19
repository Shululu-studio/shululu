import test from 'node:test';
import assert from 'node:assert/strict';
import { countSyllables, parseLyricsText } from './lyricsParser';
import { CURATED_FONTS, FONT_CATEGORIES, LYRIC_LANGUAGES } from '../data/presets';

test('countSyllables estimates English words accurately', () => {
  assert.equal(countSyllables('grace'), 1);
  assert.equal(countSyllables('morning'), 2);
  assert.equal(countSyllables('melody'), 3);
  assert.equal(countSyllables('hallelujah'), 4);
});

test('parseLyricsText detects section headers and splits words cleanly', () => {
  const raw = `[Verse 1]
Morning light breaks across the sky
[Chorus]
Sing the melody tonight
[Bridge]
Hold steady in the storm`;

  const result = parseLyricsText(raw, 24, 'fade');
  assert.equal(result.hasLrcTimestamps, false);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].section, 'verse');
  assert.equal(result.lines[1].section, 'chorus');
  assert.equal(result.lines[2].section, 'bridge');
  assert.ok(result.lines[0].words.length === 6);
  assert.ok(result.lines[0].start < result.lines[0].end);
  assert.ok(result.lines[1].start >= result.lines[0].end);
});

test('parseLyricsText parses LRC timestamps when present', () => {
  const lrc = `[ti:Sample Song]
[00:02.50]First line begins here
[00:06.00]Second line follows`;

  const result = parseLyricsText(lrc, 20, 'karaoke');
  assert.equal(result.hasLrcTimestamps, true);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].start, 2.5);
  assert.equal(result.lines[1].start, 6.0);
  assert.ok(result.lines[0].end <= 6.0);
});

test('parseLyricsText strips Suno prompt tags and inline bracketed backing vocals cleanly', () => {
  const sunoRaw = `[Intro: Acoustic Guitar]
[Style: Afrobeats, 104 BPM]
[Verse 1: Soft Vocals]
Cross the bridge before midnight (yeah)
(Guitar Solo)
[Chorus] Lift your voice up high`;

  const result = parseLyricsText(sunoRaw, 30, 'fade');
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].section, 'verse');
  assert.equal(result.lines[0].text, 'Cross the bridge before midnight');
  assert.equal(result.lines[1].section, 'chorus');
  assert.equal(result.lines[1].text, 'Lift your voice up high');
});

test('parseLyricsText infers backing vocal role from parenthesized lines cleanly without keeping parentheses', () => {
  const lrc = `[00:01.00]Your Jireh
[00:01.50](Jireh)
[00:04.00]You are enough
[00:04.50](You are enough)`;

  const result = parseLyricsText(lrc, 12, 'fade');
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[0].vocalRole, 'lead');
  assert.equal(result.lines[1].vocalRole, 'backing');
  assert.equal(result.lines[1].text, 'Jireh');
  assert.equal(result.lines[2].vocalRole, 'lead');
  assert.equal(result.lines[3].vocalRole, 'backing');
  assert.equal(result.lines[3].text, 'You are enough');
});

test('CURATED_FONTS provides at least 40 categorized fonts including all required families', () => {
  assert.ok(CURATED_FONTS.length >= 40, `Expected >= 40 curated fonts, got ${CURATED_FONTS.length}`);
  const expectedCategories = [
    'Modern Sans Serif',
    'Elegant Serif',
    'Bold and Cinematic',
    'Handwriting and Script',
    'Minimalist',
    'Decorative Typography',
  ];
  assert.deepEqual([...FONT_CATEGORIES], expectedCategories);
  for (const cat of expectedCategories) {
    assert.ok(
      CURATED_FONTS.some((f) => f.category === cat),
      `Expected category "${cat}" to have curated fonts`
    );
  }
  const requiredFamilies = [
    'Inter',
    'Roboto',
    'Montserrat',
    'Poppins',
    'Open Sans',
    'Lato',
    'Playfair Display',
    'Cormorant Garamond',
    'Dancing Script',
    'Great Vibes',
    'Allura',
    'Sacramento',
    'Caveat',
    'Pacifico',
  ];
  const families = new Set(CURATED_FONTS.map((f) => f.family));
  for (const req of requiredFamilies) {
    assert.ok(families.has(req), `Missing required font family: ${req}`);
  }
});

test('countSyllables and parseLyricsText accurately support Swahili, Shona, French, English, and non-Latin scripts', () => {
  // Swahili & Shona open-syllable words
  assert.equal(countSyllables('mbele'), 2);
  assert.equal(countSyllables('asante'), 3);
  assert.equal(countSyllables('ndinotenda'), 4);
  assert.equal(countSyllables('mutsvene'), 3);

  // French accented words & elisions
  assert.equal(countSyllables('Célébrons'), 3);
  assert.equal(countSyllables('Jésus'), 2);
  assert.equal(countSyllables("L'amour"), 2);
  assert.equal(countSyllables('adoré'), 3);

  // Non-Latin scripts (Arabic, Amharic, Korean, Chinese)
  assert.ok(countSyllables('سبحان') >= 2);
  assert.equal(countSyllables('አሜን'), 3);
  assert.equal(countSyllables('사랑해'), 3);
  assert.equal(countSyllables('赞美'), 2);

  const multiLrc = `[00:01.00] Haleluya Bwana Yesu ametenda amani
[00:04.50] Ndinotenda Mwari wangu mutsvene
[00:08.00] Célébrons Jésus pour l'amour éternel
[00:11.50] سبحان الله العظيم`;

  const parsed = parseLyricsText(multiLrc, 18, 'karaoke');
  assert.equal(parsed.hasLrcTimestamps, true);
  assert.equal(parsed.lines.length, 4);
  assert.equal(parsed.lines[0].text, 'Haleluya Bwana Yesu ametenda amani');
  assert.equal(parsed.lines[1].text, 'Ndinotenda Mwari wangu mutsvene');
  assert.equal(parsed.lines[2].text, "Célébrons Jésus pour l'amour éternel");
  assert.equal(parsed.lines[3].text, 'سبحان الله العظيم');
  assert.equal(parsed.lines[2].words[3].text, "l'amour");

  const langCodes = new Set(LYRIC_LANGUAGES.map((l) => l.code));
  for (const requiredCode of ['auto', 'sw', 'sn', 'en', 'fr']) {
    assert.ok(langCodes.has(requiredCode), `Missing language preset: ${requiredCode}`);
  }
});

