import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOCAL_LAYERS } from '../data/presets';
import {
  filterAndDeduplicateActiveSamples,
  fitSampleRowsForBudget,
  getActiveLyricsAtTime,
  getInstrumentalSampleAtTime,
  getResolutionForAspect,
  normalizeLyricComparisonText,
  resolveVocalLayerLayout,
  stripDisplayBrackets,
} from './lyricRenderer';
import { parseLyricsText } from './lyricsParser';

test('getResolutionForAspect computes accurate 720p and 1080p dimensions', () => {
  assert.deepEqual(getResolutionForAspect('16:9', 1080), { width: 1920, height: 1080 });
  assert.deepEqual(getResolutionForAspect('16:9', 720), { width: 1280, height: 720 });
  assert.deepEqual(getResolutionForAspect('9:16', 1080), { width: 1080, height: 1920 });
  assert.deepEqual(getResolutionForAspect('1:1', 720), { width: 720, height: 720 });
});

test('getActiveLyricsAtTime interpolates progress and fade envelopes accurately', () => {
  const { lines } = parseLyricsText('[00:02.00]Hold this steady flame', 10, 'slide-up');
  assert.equal(getActiveLyricsAtTime(lines, 1.0).length, 0);
  assert.equal(getActiveLyricsAtTime(lines, 1.5).length, 0);

  const atStart = getActiveLyricsAtTime(lines, 2.0);
  assert.equal(atStart.length, 1);
  assert.ok(atStart[0].alpha >= 0.7, `Expected crisp alpha at line.start, got ${atStart[0].alpha}`);

  const mid = getActiveLyricsAtTime(lines, 3.5);
  assert.equal(mid.length, 1);
  assert.ok(mid[0].alpha > 0.8);
  assert.equal(mid[0].offsetY, 0);
});

test('getActiveLyricsAtTime never stacks two touching or crossfade lines at once', () => {
  const { lines } = parseLyricsText('[00:02.00]First line\n[00:04.00]Second line', 8, 'line-crossfade');
  lines[0].end = 4.0;
  for (let t = 1.8; t <= 4.5; t += 0.02) {
    const active = getActiveLyricsAtTime(lines, t);
    assert.ok(active.length <= 1, `Expected <= 1 line at t=${t.toFixed(2)}, got ${active.length}`);
  }
});

test('getInstrumentalSampleAtTime returns null as [instrumental] tag has been removed', () => {
  const { lines } = parseLyricsText(
    '[00:04.00]First verse begins\n[00:06.20]Quick breath line\n[00:12.00]Final chorus line',
    18,
    'fade'
  );
  const peaks = Array.from({ length: 100 }, () => 0.35);

  assert.equal(
    getInstrumentalSampleAtTime(lines, 2.0, { duration: 18, hasAudio: true, waveformPeaks: peaks }),
    null
  );
  assert.equal(
    getInstrumentalSampleAtTime(lines, 10.0, { duration: 18, hasAudio: true, waveformPeaks: peaks }),
    null
  );
  assert.equal(
    getInstrumentalSampleAtTime([], 5.0, { duration: 18, hasAudio: true, waveformPeaks: peaks }),
    null
  );
});

test('getActiveLyricsAtTime hides small lower backing lyrics by default and respects explicit override', () => {
  const { lines } = parseLyricsText(
    '[00:01.00]Your Jireh\n[00:01.40](Jireh)',
    8,
    'fade'
  );
  lines[0].vocalRole = 'lead';
  lines[0].end = 4.0;
  lines[1].vocalRole = 'backing';
  lines[1].end = 4.2;

  // By default, lower small-font backing vocals are hidden
  const defaultActive = getActiveLyricsAtTime(lines, 2.2);
  assert.equal(defaultActive.length, 1);
  assert.equal(defaultActive[0].line.text, 'Your Jireh');

  // If backing visibility is explicitly enabled, both display cleanly without parentheses
  const explicitBacking = getActiveLyricsAtTime(lines, 2.2, {
    ...DEFAULT_VOCAL_LAYERS,
    backing: { ...DEFAULT_VOCAL_LAYERS.backing, visible: true },
  });
  assert.equal(explicitBacking.length, 2);
  assert.equal(explicitBacking[0].line.text, 'Your Jireh');
  assert.equal(explicitBacking[1].line.text, 'Jireh');
});

test('getActiveLyricsAtTime suppresses 1-2 word leader interjections over choir/backing vocals and duplicate unison lines', () => {
  const { lines } = parseLyricsText(
    '[00:01.00]You are enough\n[00:01.40]Come on\n[00:01.50]Amen',
    8,
    'fade'
  );
  lines[0].vocalRole = 'choir';
  lines[0].end = 4.5;
  lines[1].vocalRole = 'lead';
  lines[1].end = 2.6;
  lines[2].vocalRole = 'adlib';
  lines[2].end = 2.5;

  const active = getActiveLyricsAtTime(lines, 2.0, DEFAULT_VOCAL_LAYERS);
  assert.equal(active.length, 1, '1-2 word interjections over choir vocals must not be displayed');
  assert.equal(active[0].line.vocalRole, 'choir');
  assert.equal(active[0].line.text, 'You are enough');

  // Unison duplicate check when backing is explicitly turned on
  const unisonLines = parseLyricsText(
    '[00:01.00]You are enough\n[00:01.10]You are enough',
    8,
    'fade'
  ).lines;
  unisonLines[0].vocalRole = 'lead';
  unisonLines[0].end = 4.5;
  unisonLines[1].vocalRole = 'backing';
  unisonLines[1].end = 4.5;

  const deduped = getActiveLyricsAtTime(unisonLines, 2.5, {
    ...DEFAULT_VOCAL_LAYERS,
    backing: { ...DEFAULT_VOCAL_LAYERS.backing, visible: true },
  });
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].line.vocalRole, 'lead');
});

test('getActiveLyricsAtTime keeps lyric strongly visible through final sustained pronunciation tail', () => {
  const { lines } = parseLyricsText('[00:01.00]Ooooooh Hallelujah', 6, 'fade');
  lines[0].end = 4.5;
  const nearEnd = getActiveLyricsAtTime(lines, 4.35);
  assert.equal(nearEnd.length, 1);
  assert.ok(
    nearEnd[0].alpha >= 0.75,
    `Expected sustained note tail near end (4.35/4.50s) to remain highly visible, got alpha=${nearEnd[0].alpha}`
  );
});

test('resolveVocalLayerLayout prevents text collisions across multi-line Lead, Backing, and Ad-lib layers', () => {
  const placed = resolveVocalLayerLayout(
    [
      {
        id: 'lead_1',
        role: 'lead',
        desiredX: 960,
        desiredY: 540,
        boxWidth: 900,
        boxHeight: 164, // 2-line Lead lyric
        align: 'center',
      },
      {
        id: 'backing_1',
        role: 'backing',
        desiredX: 960,
        desiredY: 580, // Collides with bottom half of Lead
        boxWidth: 520,
        boxHeight: 60,
        align: 'center',
      },
      {
        id: 'adlib_1',
        role: 'adlib',
        desiredX: 960,
        desiredY: 520, // Collides with top half of Lead
        boxWidth: 320,
        boxHeight: 54,
        align: 'center',
      },
    ],
    1920,
    1080,
    true
  );

  assert.equal(placed.length, 3);
  const lead = placed.find((b) => b.id === 'lead_1')!;
  const backing = placed.find((b) => b.id === 'backing_1')!;
  const adlib = placed.find((b) => b.id === 'adlib_1')!;

  // Backing pushed cleanly below Lead, Ad-lib pushed cleanly above Lead
  assert.ok(backing.top >= lead.bottom + 12, `Expected Backing top (${backing.top}) below Lead bottom (${lead.bottom})`);
  assert.ok(adlib.bottom <= lead.top - 12, `Expected Ad-lib bottom (${adlib.bottom}) above Lead top (${lead.top})`);
  // All layers stay inside watermark-safe bottom boundary
  assert.ok(backing.bottom <= 1080 * 0.84, `Expected Backing bottom (${backing.bottom}) above watermark zone`);

  // Horizontally separated Backing preserves its desired vertical anchor without unnecessary shift
  const sideBySide = resolveVocalLayerLayout(
    [
      {
        id: 'lead_side',
        role: 'lead',
        desiredX: 500,
        desiredY: 540,
        boxWidth: 400,
        boxHeight: 90,
        align: 'center',
      },
      {
        id: 'backing_side',
        role: 'backing',
        desiredX: 1420,
        desiredY: 540,
        boxWidth: 360,
        boxHeight: 60,
        align: 'center',
      },
    ],
    1920,
    1080,
    true
  );
  assert.equal(sideBySide[1].anchorY, 540);
});

test('stripDisplayBrackets removes inline and outer brackets without losing lead lyrics', () => {
  assert.equal(stripDisplayBrackets('Your Jireh (Jireh)'), 'Your Jireh');
  assert.equal(stripDisplayBrackets('(You are enough)'), 'You are enough');
  assert.equal(stripDisplayBrackets('We lift Your name [choir] high'), 'We lift Your name high');
  assert.equal(stripDisplayBrackets('[instrumental]'), '[instrumental]');
});

test('getActiveLyricsAtTime never lets next sentence pre-roll cut off previous sentence before it ends', () => {
  const { lines } = parseLyricsText(
    '[00:01.00]Words spoken in sentence one\n[00:04.10]Now sentence two begins',
    10,
    'fade'
  );
  lines[0].end = 4.0;
  lines[1].end = 7.0;

  // At 3.85s (within 0.32s of line 1 start), sentence one is still finishing and MUST stay active!
  const beforeEnd = getActiveLyricsAtTime(lines, 3.85);
  assert.equal(beforeEnd.length, 1);
  assert.equal(beforeEnd[0].line.text, 'Words spoken in sentence one');

  const atSwitch = getActiveLyricsAtTime(lines, 4.1);
  assert.equal(atSwitch.length, 1);
  assert.equal(atSwitch[0].line.text, 'Now sentence two begins');
});

test('filterAndDeduplicateActiveSamples and fitSampleRowsForBudget enforce strictly max 2 lines on preview', () => {
  const { lines } = parseLyricsText(
    '[00:01.00]Lead line sings bright\n[00:01.10]Choir lifts His name\n[00:01.20]Praise His holy name',
    8,
    'fade'
  );
  lines[0].vocalRole = 'lead';
  lines[0].end = 5.0;
  lines[1].vocalRole = 'choir';
  lines[1].end = 5.0;
  lines[2].vocalRole = 'adlib';
  lines[2].end = 5.0;

  const active = filterAndDeduplicateActiveSamples(
    lines.map((line) => ({
      line,
      progress: 0.5,
      alpha: 1,
      offsetY: 0,
      scale: 1,
      letterSpacingDelta: 0,
    }))
  );
  assert.equal(active.length, 2, 'Simultaneous layers must be capped at 2');

  // Mock CanvasRenderingContext2D monospace width (10px per char at 64px, scaled proportionally)
  let currentSize = 64;
  const mockCtx = {
    save() {},
    restore() {},
    set font(val: string) {
      const m = val.match(/(\d+(?:\.\d+)?)px/);
      if (m) currentSize = Number(m[1]);
    },
    get font() {
      return `${currentSize}px sans-serif`;
    },
    measureText(txt: string) {
      return { width: txt.length * (currentSize * 0.52) };
    },
  } as unknown as CanvasRenderingContext2D;

  const longLine = parseLyricsText(
    '[00:01.00]You are more than enough for every season of my life and all my days forevermore',
    8,
    'fade'
  ).lines[0];

  const fitted = fitSampleRowsForBudget(
    mockCtx,
    longLine,
    {
      role: 'lead',
      fontSize: 64,
      fontWeight: 600,
      fontStylePrefix: '',
      letterSpacing: 0.5,
      strokeWidth: 0,
      lineHeight: 82,
      color: '#FFFFFF',
      highlightColor: '#F59E0B',
      roleAlpha: 1,
      desiredAnchorX: 960,
      desiredAnchorY: 540,
      ensureContrastShadow: false,
    },
    'Inter',
    1200,
    2,
    0.52
  );
  assert.ok(fitted.rows.length <= 2, `Expected max 2 rows, got ${fitted.rows.length}`);
});

test('getActiveLyricsAtTime keeps full alpha through exact line.end before fading in release window', () => {
  const { lines } = parseLyricsText('[00:01.00]Ametenda amani\n[00:05.00]Bwana Yesu asifiwe', 9, 'fade');
  lines[0].end = 3.8;
  lines[1].end = 8.0;

  // Right at exact pronunciation end (3.80s) and 3.75s, alpha must be 1.0 (not prematurely faded!)
  const atEnd = getActiveLyricsAtTime(lines, 3.8);
  assert.equal(atEnd.length, 1);
  assert.equal(atEnd[0].line.text, 'Ametenda amani');
  assert.equal(atEnd[0].alpha, 1, `Expected full opacity at line.end=3.80s, got alpha=${atEnd[0].alpha}`);

  // Gently releases cleanly after line.end without colliding into line 1's entrance at ~4.68s
  const duringRelease = getActiveLyricsAtTime(lines, 3.92);
  assert.equal(duringRelease.length, 1);
  assert.ok(duringRelease[0].alpha > 0 && duringRelease[0].alpha < 1);
});

test('normalizeLyricComparisonText and filterAndDeduplicateActiveSamples preserve French accents and distinct non-Latin lines', () => {
  assert.equal(normalizeLyricComparisonText('Célébrons Jésus-Christ!'), 'célébrons jésus christ');
  assert.equal(normalizeLyricComparisonText('سبحان الله'), 'سبحان الله');
  assert.notEqual(
    normalizeLyricComparisonText('سبحان الله'),
    normalizeLyricComparisonText('الحمد لله')
  );

  const arabicLead = parseLyricsText('[00:01.00] سبحان الله العظيم', 8, 'fade').lines[0];
  arabicLead.vocalRole = 'lead';
  arabicLead.end = 5.0;
  const arabicChoir = parseLyricsText('[00:01.10] الحمد لله رب العالمين', 8, 'fade').lines[0];
  arabicChoir.vocalRole = 'choir';
  arabicChoir.end = 5.0;

  const active = filterAndDeduplicateActiveSamples([
    { line: arabicLead, progress: 0.4, alpha: 1, offsetY: 0, scale: 1, letterSpacingDelta: 0 },
    { line: arabicChoir, progress: 0.4, alpha: 1, offsetY: 0, scale: 1, letterSpacingDelta: 0 },
  ]);
  assert.equal(active.length, 2, 'Distinct non-Latin lead and choir phrases must both stay visible');
});


