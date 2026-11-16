import test from 'node:test';
import assert from 'node:assert/strict';
import { assignAutoEffects } from './autoEffects';
import { parseLyricsText } from './lyricsParser';

test('assignAutoEffects assigns uniform style specification and respects manual overrides', () => {
  const parsed = parseLyricsText(
    `[Verse 1]
Walking down the quiet road
[Chorus]
Lift the song up to the sky`,
    12
  );

  const customized = parsed.lines.map((line, idx) =>
    idx === 0 ? { ...line, effect: 'none' as const, effectOverride: true } : line
  );

  const result = assignAutoEffects(customized, 'dynamic-stage', true);
  assert.equal(result[0].effect, 'none');
  assert.equal(result[1].effect, 'karaoke');
});
