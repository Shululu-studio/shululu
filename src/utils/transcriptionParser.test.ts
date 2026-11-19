import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignWordsToCleanText,
  cleanLyricSegmentText,
  filterVocalSegmentsForCleanPresentation,
  formatLyricForVocalRole,
  fuzzyWordMatch,
  inferVocalRoleFromText,
  isNoVocalsTranscript,
  isOverlappingDuplicateSegment,
  mergeSplitPhraseDuplicates,
  normalizeAudioMimeType,
  normalizeMultilingualToken,
  normalizeVocalRole,
  parseFlexibleTimestamp,
  parseTranscriptToSegments,
  recoverSegmentsFromPartialJson,
  repairWorshipVocabulary,
  resolveChunkOverlapSegment,
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
  const truncated = `{"vocalsDetected":true,"segments":[{"text":"[Verse] First line","section":"verse","start":0.4,"end":2.8,"words":[{"text":"[Verse]","start":0.4,"end":0.5},{"text":"First","start":0.5,"end":1.4},{"text":"line","start":1.4,"end":2.8}]},{"text":"[Chorus: Anthemic] Second line","section":"chorus","start":3.0,"end":5.4},{"text":"Cutoff li`;
  const recovered = recoverSegmentsFromPartialJson(truncated);
  assert.equal(recovered.length, 2);
  assert.equal(recovered[0].text, 'First line');
  assert.equal(recovered[0].words?.length, 2);
  assert.equal(recovered[0].words?.[0].text, 'First');
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
    text: 'Dancing in the rain',
    detectedSection: 'chorus',
  });
  assert.deepEqual(cleanLyricSegmentText('Your Jireh (Jireh) is enough [echo]'), {
    text: 'Your Jireh is enough',
    detectedSection: null,
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
  assert.equal(segs[1].text, 'Hold on tight');
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
    text: 'Ooooh praise His name',
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

test('alignWordsToCleanText preserves word timings after stripping structural tags', () => {
  const aligned = alignWordsToCleanText(
    'Dancing in the rain',
    [
      { text: '[Chorus]', start: 10.0, end: 10.1 },
      { text: 'Dancing', start: 10.2, end: 10.9 },
      { text: 'in', start: 10.92, end: 11.15 },
      { text: 'the', start: 11.16, end: 11.38 },
      { text: 'rain', start: 11.4, end: 12.2 },
    ],
    10.0,
    12.5
  );
  assert.ok(aligned);
  assert.equal(aligned.length, 4);
  assert.deepEqual(
    aligned.map((w) => w.text),
    ['Dancing', 'in', 'the', 'rain']
  );
  assert.equal(aligned[0].start, 10.2);
  assert.equal(aligned[3].end, 12.2);
});

test('resolveChunkOverlapSegment upgrades boundary-clipped segments when next chunk captures full words', () => {
  const existing = [
    { text: 'Walking through the', start: 53.1, end: 54.8 },
  ];
  const decision = resolveChunkOverlapSegment(
    existing,
    { text: 'Walking through the valley of light', start: 53.15, end: 56.2 },
    56.5
  );
  assert.equal(decision.action, 'replace');
  assert.equal(decision.replaceIndex, 0);

  const duplicate = resolveChunkOverlapSegment(
    existing,
    { text: 'Walking through the', start: 53.2, end: 54.8 },
    56.5
  );
  assert.equal(duplicate.action, 'skip');
});

test('repairWorshipVocabulary fixes common worship mishearings while cleanLyricSegmentText preserves sustained vowels', () => {
  assert.equal(repairWorshipVocabulary('My jirah and jehova'), 'My Jireh and Jehovah');
  assert.equal(repairWorshipVocabulary('Praise yahwe halelujah hosana'), 'Praise Yahweh Hallelujah Hosanna');
  assert.equal(repairWorshipVocabulary('Elohim and adonai reign'), 'Elohim and Adonai reign');

  assert.deepEqual(cleanLyricSegmentText('Eeeeeh Ooooooh Ahhhhh Mmmmm'), {
    text: 'Eeeeeh Ooooooh Ahhhhh Mmmmm',
    detectedSection: null,
  });
});

test('formatLyricForVocalRole strips parentheses for backing vocals while inferVocalRoleFromText detects legacy hints', () => {
  assert.equal(normalizeVocalRole('Backing Vocal'), 'backing');
  assert.equal(normalizeVocalRole('Choir'), 'choir');
  assert.equal(normalizeVocalRole('ad-lib'), 'adlib');
  assert.equal(normalizeVocalRole('Lead'), 'lead');

  assert.equal(inferVocalRoleFromText('(You are enough)'), 'backing');
  assert.equal(inferVocalRoleFromText('You are enough'), 'lead');

  assert.equal(formatLyricForVocalRole('Jireh', 'backing'), 'Jireh');
  assert.equal(formatLyricForVocalRole('(You are enough)', 'backing'), 'You are enough');
  assert.equal(formatLyricForVocalRole('(You are enough)', 'lead'), 'You are enough');
});

test('alignWordsToCleanText marks uncertain words and resolveChunkOverlapSegment preserves simultaneous distinct vocal roles', () => {
  const words = alignWordsToCleanText(
    'Your Jireh reigns',
    [
      { text: 'Your', start: 1.0, end: 1.4, confidence: 0.95 },
      { text: 'Jireh', start: 1.4, end: 2.0, confidence: 0.48 },
      { text: 'reigns', start: 2.0, end: 2.8, confidence: 0.9 },
    ],
    1.0,
    2.8,
    ['Jireh']
  );
  assert.ok(words);
  assert.equal(words[1].uncertain, true);
  assert.equal(words[0].uncertain, undefined);

  const existingLead = [{ text: 'Your Jireh', start: 53.0, end: 55.0, vocalRole: 'lead' as const }];
  const overlapDecision = resolveChunkOverlapSegment(
    existingLead,
    { text: '(Jireh)', start: 53.6, end: 55.2, vocalRole: 'backing' as const },
    56.5
  );
  assert.equal(overlapDecision.action, 'append');
});

test('alignWordsToCleanText skips bracketed inline backing words and reconciles split contractions', () => {
  const aligned = alignWordsToCleanText(
    "You're my Jireh",
    [
      { text: 'You', start: 1.0, end: 1.2 },
      { text: "'re", start: 1.2, end: 1.4 },
      { text: 'my', start: 1.45, end: 1.7 },
      { text: 'Jireh', start: 1.75, end: 2.3 },
      { text: '(oh', start: 2.35, end: 2.5 },
      { text: 'yeah)', start: 2.5, end: 2.8 },
    ],
    1.0,
    2.8
  );
  assert.ok(aligned);
  assert.deepEqual(
    aligned.map((w) => w.text),
    ["You're", 'my', 'Jireh']
  );
  assert.equal(aligned[0].start, 1.0);
  assert.equal(aligned[2].end, 2.3);
});

test('filterVocalSegmentsForCleanPresentation suppresses 1-2 word leader interjections over backing/choir and removes lower backing echoes', () => {
  // Case 1: Choir/backing singing main phrase while leader cuts in with "Come on" / "Sing"
  const interjectionFiltered = filterVocalSegmentsForCleanPresentation([
    { text: 'You are enough', start: 10.0, end: 14.0, vocalRole: 'backing' as const },
    { text: 'Come on', start: 11.2, end: 12.1, vocalRole: 'lead' as const },
    { text: 'Sing', start: 12.8, end: 13.4, vocalRole: 'adlib' as const },
  ]);
  assert.equal(interjectionFiltered.length, 1);
  assert.equal(interjectionFiltered[0].text, 'You are enough');
  assert.equal(interjectionFiltered[0].vocalRole, 'choir');

  // Case 2: Main Lead "Your Jireh" followed by lower Backing echo "Jireh" -> keep Lead, drop Backing echo
  const echoFiltered = filterVocalSegmentsForCleanPresentation([
    { text: 'Your Jireh', start: 20.0, end: 23.5, vocalRole: 'lead' as const },
    { text: 'Jireh', start: 21.1, end: 23.5, vocalRole: 'backing' as const },
  ]);
  assert.equal(echoFiltered.length, 1);
  assert.equal(echoFiltered[0].text, 'Your Jireh');
  assert.equal(echoFiltered[0].vocalRole, 'lead');

  // Case 3: Solo 1-word sung lyric with no overlapping choir/backing is preserved
  const soloKept = filterVocalSegmentsForCleanPresentation([
    { text: 'Hallelujah', start: 30.0, end: 32.8, vocalRole: 'lead' as const },
    { text: 'Forever You reign', start: 33.2, end: 36.0, vocalRole: 'lead' as const },
  ]);
  assert.equal(soloKept.length, 2);
  assert.equal(soloKept[0].text, 'Hallelujah');
});

test('mergeSplitPhraseDuplicates and filterVocalSegmentsForCleanPresentation merge split/misheard fragments like "amtenda" + "ametenda amani"', () => {
  assert.equal(fuzzyWordMatch('amtenda', 'ametenda'), true);
  assert.equal(fuzzyWordMatch('lord', 'word'), false);

  // Overlapping clipped opening fragment before full sentence -> merged into ONE cue spanning [minStart, maxEnd]
  const mergedOverlap = filterVocalSegmentsForCleanPresentation([
    {
      text: 'amtenda',
      start: 10.0,
      end: 10.65,
      vocalRole: 'lead' as const,
      words: [{ text: 'amtenda', start: 10.0, end: 10.65 }],
    },
    {
      text: 'ametenda amani',
      start: 10.4,
      end: 13.1,
      vocalRole: 'lead' as const,
      words: [
        { text: 'ametenda', start: 10.4, end: 11.75 },
        { text: 'amani', start: 11.8, end: 13.1 },
      ],
    },
  ]);
  assert.equal(mergedOverlap.length, 1);
  assert.equal(mergedOverlap[0].text, 'ametenda amani');
  assert.equal(mergedOverlap[0].start, 10.0);
  assert.equal(mergedOverlap[0].end, 13.1);
  assert.equal(mergedOverlap[0].words?.[0].start, 10.0);

  // Sequential clipped fragment with slight gap right before full sentence -> still merged cleanly
  const mergedGap = mergeSplitPhraseDuplicates([
    { text: 'amtenda', start: 20.0, end: 20.6, vocalRole: 'lead' as const },
    { text: 'ametenda amani', start: 20.9, end: 23.4, vocalRole: 'lead' as const },
  ]);
  assert.equal(mergedGap.length, 1);
  assert.equal(mergedGap[0].text, 'ametenda amani');
  assert.equal(mergedGap[0].start, 20.0);
  assert.equal(mergedGap[0].end, 23.4);

  // Overlapping bridge word split ("Bwana Yesu ametenda" + "ametenda amani") -> ONE clean sentence
  const mergedBridge = mergeSplitPhraseDuplicates([
    { text: 'Bwana Yesu ametenda', start: 30.0, end: 32.1, vocalRole: 'lead' as const },
    { text: 'ametenda amani', start: 31.95, end: 34.0, vocalRole: 'lead' as const },
  ]);
  assert.equal(mergedBridge.length, 1);
  assert.equal(mergedBridge[0].text, 'Bwana Yesu ametenda amani');
  assert.equal(mergedBridge[0].start, 30.0);
  assert.equal(mergedBridge[0].end, 34.0);

  // Cross-chunk overlap upgrade when chunk 1 ended on clipped "amtenda" and chunk 2 captured "ametenda amani"
  const crossChunk = resolveChunkOverlapSegment(
    [{ text: 'amtenda', start: 53.5, end: 54.8, vocalRole: 'lead' as const }],
    { text: 'ametenda amani', start: 53.55, end: 56.2, vocalRole: 'lead' as const },
    56.5
  );
  assert.equal(crossChunk.action, 'replace');
  assert.equal(crossChunk.replaceIndex, 0);

  // Genuine slow full-word repetition across distinct musical phrases stays two separate cues
  const genuineRepeat = mergeSplitPhraseDuplicates([
    { text: 'Hallelujah', start: 40.0, end: 42.6, vocalRole: 'lead' as const },
    { text: 'Hallelujah my King', start: 43.2, end: 46.5, vocalRole: 'lead' as const },
  ]);
  assert.equal(genuineRepeat.length, 2);
});

test('multilingual normalization, French contractions, Shona/Swahili/Arabic chunk deduplication, and Haleluya preservation work cleanly', () => {
  // Swahili "Haleluya" stays Haleluya while "halelujah" still normalizes to Hallelujah
  assert.equal(repairWorshipVocabulary('Haleluya Bwana Yesu'), 'Haleluya Bwana Yesu');
  assert.equal(repairWorshipVocabulary('halelujah amen'), 'Hallelujah amen');

  assert.equal(normalizeMultilingualToken('Célébrons'), 'celebrons');
  assert.equal(normalizeMultilingualToken("L'amour"), 'lamour');
  assert.equal(normalizeMultilingualToken('سبحان'), 'سبحان');

  // Reconcile split French apostrophe contractions ("L'", "amour" -> "L'amour") and flag uncertain accented words
  const frWords = alignWordsToCleanText(
    "L'amour de Jésus-Christ",
    [
      { text: "L'", start: 1.0, end: 1.18 },
      { text: 'amour', start: 1.18, end: 1.7 },
      { text: 'de', start: 1.72, end: 1.9 },
      { text: 'Jésus-Christ', start: 1.92, end: 2.8, confidence: 0.62 },
    ],
    1.0,
    2.8,
    ['Jésus-Christ']
  );
  assert.ok(frWords);
  assert.deepEqual(
    frWords.map((w) => w.text),
    ["L'amour", 'de', 'Jésus-Christ']
  );
  assert.equal(frWords[2].uncertain, true);

  // Shona split fragment merge ("ndino" / "ndinotenda" -> "Ndinotenda Mwari mutsvene")
  const snMerged = mergeSplitPhraseDuplicates([
    { text: 'ndino', start: 5.0, end: 5.45, vocalRole: 'lead' as const },
    { text: 'Ndinotenda Mwari mutsvene', start: 5.35, end: 8.1, vocalRole: 'lead' as const },
  ]);
  assert.equal(snMerged.length, 1);
  assert.equal(snMerged[0].text, 'Ndinotenda Mwari mutsvene');
  assert.equal(snMerged[0].start, 5.0);

  // Distinct non-Latin (Arabic) lines overlapping near seam must NOT falsely collide as empty strings
  assert.equal(
    isOverlappingDuplicateSegment(
      [{ text: 'سبحان الله', start: 51.0, end: 53.5 }],
      { text: 'الحمد لله', start: 53.2 },
      56.5
    ),
    false
  );
  assert.equal(
    isOverlappingDuplicateSegment(
      [{ text: 'Célébrons le Roi', start: 51.0, end: 53.5 }],
      { text: 'Célébrons le Roi', start: 53.2 },
      56.5
    ),
    true
  );

  const nonLatinUpgrade = resolveChunkOverlapSegment(
    [{ text: 'سبحان', start: 53.0, end: 54.1 }],
    { text: 'سبحان الله العظيم', start: 53.05, end: 56.0 },
    56.5
  );
  assert.equal(nonLatinUpgrade.action, 'replace');
});




