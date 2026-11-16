import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanLyricSegmentText,
  isNoVocalsTranscript,
  isOverlappingDuplicateSegment,
  normalizeAudioMimeType,
  parseFlexibleTimestamp,
  parseTranscriptToSegments,
  recoverSegmentsFromPartialJson,
  resolveSegmentTiming,
  safeParseJson,
} from './transcriptionParser.ts';

test('safeParseJson extracts JSON from fenced markdown blocks cleanly', () => {
  const input = '```json\n{"vocalsDetected": true, "segments": [{"text": "Hello world", "start": 0.5, "end": 2.0}]}\n```';
  const parsed = safeParseJson<{ vocalsDetected: boolean; segments: Array<{ text: string }> }>(input);
  assert.equal(parsed?.vocalsDetected, true);
  assert.equal(parsed?.segments[0].text, 'Hello world');
});

test('normalizeAudioMimeType maps browser MIME variants cleanly', () => {
  assert.equal(normalizeAudioMimeType('audio/mpeg'), 'audio/mp3');
  assert.equal(normalizeAudioMimeType('audio/x-m4a'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType('', 'track.mp3'), 'audio/mp3');
});

test('parseTranscriptToSegments parses section headers, LRC timestamps, and raw lyrics', () => {
  const raw = `[Verse]
Amazing grace how sweet the sound
[Chorus]
I once was lost but now am found`;
  const segs = parseTranscriptToSegments(raw, 12);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].section, 'verse');
  assert.equal(segs[1].section, 'chorus');
  assert.ok(segs[0].start < segs[0].end && segs[0].end <= segs[1].start + 0.15);
  assert.equal(isNoVocalsTranscript('NO_VOCALS'), true);
  assert.equal(isNoVocalsTranscript(raw), false);
});

test('recoverSegmentsFromPartialJson rescues complete segments from truncated JSON output', () => {
  const truncated = `{"vocalsDetected":true,"segments":[{"text":"[Verse] First line","section":"verse","start":0.4,"end":2.8},{"text":"[Chorus: Anthemic] Second line","section":"chorus","start":3.0,"end":5.4},{"text":"Cutoff li`;
  const recovered = recoverSegmentsFromPartialJson(truncated);
  assert.equal(recovered.length, 2);
  assert.equal(recovered[0].text, 'First line');
  assert.equal(recovered[1].text, 'Second line');
  assert.equal(recovered[1].section, 'chorus');
});

test('parseFlexibleTimestamp and resolveSegmentTiming parse MM:SS.cc clock strings accurately', () => {
  assert.equal(parseFlexibleTimestamp('01:23.45'), 83.45);
  assert.equal(parseFlexibleTimestamp('00:04.20'), 4.2);
  assert.equal(parseFlexibleTimestamp('01:02:03.50'), 3723.5);
  assert.equal(parseFlexibleTimestamp(12.34), 12.34);

  const resolved = resolveSegmentTiming(
    { startTime: '01:05.18', endTime: '01:09.42', start: 65, end: 70 },
    0,
    5,
    180
  );
  assert.equal(resolved.hasExplicitTiming, true);
  assert.equal(resolved.start, 65.18);
  assert.equal(resolved.end, 69.42);
});

test('cleanLyricSegmentText strips Suno structural & musical tags while preserving sung ad-libs', () => {
  assert.deepEqual(cleanLyricSegmentText('[Intro: Soft Piano]'), {
    text: '',
    detectedSection: 'intro',
  });
  assert.deepEqual(cleanLyricSegmentText('[Instrumental Break]'), {
    text: '',
    detectedSection: null,
  });
  assert.deepEqual(cleanLyricSegmentText('(Guitar Solo)'), {
    text: '',
    detectedSection: null,
  });
  assert.deepEqual(cleanLyricSegmentText('Style: Afrobeats, 105 BPM'), {
    text: '',
    detectedSection: null,
  });
  assert.deepEqual(cleanLyricSegmentText('[Chorus] Dancing in the rain (yeah)'), {
    text: 'Dancing in the rain (yeah)',
    detectedSection: 'chorus',
  });
  assert.deepEqual(cleanLyricSegmentText('Verse 1: Walking down the road'), {
    text: 'Walking down the road',
    detectedSection: 'verse',
  });
});

test('parseTranscriptToSegments strips mixed LRC timestamps + Suno tags cleanly', () => {
  const raw = `[00:02.00] [Intro: Warm Synth]
[00:08.50] [Chorus: Big Drums] Shine into the night
[00:14.00] (Instrumental Break)
[00:20.00] Hold on tight (oh yeah)`;
  const segs = parseTranscriptToSegments(raw, 30);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'Shine into the night');
  assert.equal(segs[0].section, 'chorus');
  assert.equal(segs[0].start, 8.5);
  assert.equal(segs[1].text, 'Hold on tight (oh yeah)');
  assert.equal(segs[1].start, 20);
});

test('isOverlappingDuplicateSegment deduplicates overlap seams cleanly', () => {
  const existing = [
    { text: 'Walking through the shadow of the valley', end: 103.8 },
  ];
  assert.equal(
    isOverlappingDuplicateSegment(
      existing,
      { text: 'Through the shadow of the valley', start: 104.1 },
      106.5
    ),
    true
  );
  assert.equal(
    isOverlappingDuplicateSegment(
      existing,
      { text: 'Brand new chorus starts right now', start: 105.0 },
      106.5
    ),
    false
  );
});

test('cleanLyricSegmentText and isOverlappingDuplicateSegment preserve ooooh/woooh vocalizations and repeated choruses', () => {
  assert.deepEqual(cleanLyricSegmentText('Ooooh, woooh'), {
    text: 'Ooooh, woooh',
    detectedSection: null,
  });
  assert.deepEqual(cleanLyricSegmentText('[Chorus] Ooooh praise His name (woooh)'), {
    text: 'Ooooh praise His name (woooh)',
    detectedSection: 'chorus',
  });

  // Genuine repeated vocalization 1.5s later inside overlap window must NOT be dropped
  const existingRepeat = [{ text: 'Ooooh', start: 51.0, end: 52.5 }];
  assert.equal(
    isOverlappingDuplicateSegment(existingRepeat, { text: 'Ooooh', start: 54.0 }, 56.5),
    false
  );

  // Distinct phrase whose start slightly precedes a padded previous line end must NOT be dropped
  const existingPadded = [{ text: 'Grace pours down like rain', start: 48.0, end: 52.8 }];
  assert.equal(
    isOverlappingDuplicateSegment(existingPadded, { text: 'Woooh', start: 52.3 }, 56.5),
    false
  );

  // Standalone [instrumental] tag explicitly authored should be preserved as [instrumental]
  assert.deepEqual(cleanLyricSegmentText('[instrumental]'), {
    text: '[instrumental]',
    detectedSection: null,
  });
});
