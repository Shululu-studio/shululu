import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_VOCAL_LAYERS,
  DEFAULT_WATERMARK,
} from '../data/presets';
import { ProjectData } from '../types/editor';
import { normalizeLoadedProject } from './projectStorage';

test('normalizeLoadedProject backfills missing watermark, typography, vocalLayers, background, and lyrics on legacy projects', () => {
  const legacyProject = {
    id: 'legacy_proj_1',
    name: 'Old Saved Track',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    aspectRatio: '16:9',
    duration: 120,
    audioFileName: 'old-song.mp3',
    background: {
      type: 'solid',
      solidColor: '#121212',
    },
    typography: {
      fontFamily: 'Syne',
    },
  } as unknown as ProjectData;

  const normalized = normalizeLoadedProject(legacyProject);

  assert.ok(normalized.watermark, 'Expected watermark config to be populated');
  assert.equal(normalized.watermark.enabled, DEFAULT_WATERMARK.enabled);
  assert.equal(normalized.watermark.text, DEFAULT_WATERMARK.text);
  assert.equal(normalized.watermark.fontFamily, DEFAULT_WATERMARK.fontFamily);
  assert.equal(normalized.watermark.position, DEFAULT_WATERMARK.position);

  assert.ok(normalized.vocalLayers, 'Expected vocalLayers config to be populated');
  assert.equal(normalized.vocalLayers?.leadVisible, DEFAULT_VOCAL_LAYERS.leadVisible);
  assert.equal(normalized.vocalLayers?.backing.color, DEFAULT_VOCAL_LAYERS.backing.color);
  assert.equal(normalized.vocalLayers?.backing.fontScale, DEFAULT_VOCAL_LAYERS.backing.fontScale);
  assert.equal(normalized.vocalLayers?.choirVisible, DEFAULT_VOCAL_LAYERS.choirVisible);
  assert.equal(normalized.vocalLayers?.adlibVisible, DEFAULT_VOCAL_LAYERS.adlibVisible);

  assert.equal(normalized.background.solidColor, '#121212');
  assert.equal(normalized.background.blur, DEFAULT_BACKGROUND.blur);
  assert.equal(normalized.typography.fontFamily, 'Syne');
  assert.equal(normalized.typography.fontSize, DEFAULT_TYPOGRAPHY.fontSize);
  assert.deepEqual(normalized.lyrics, []);
});

test('normalizeLoadedProject preserves explicit watermark overrides while filling missing keys', () => {
  const partialProject = {
    id: 'partial_proj_2',
    name: 'Partial Watermark Track',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    aspectRatio: '9:16',
    duration: 45,
    audioFileName: null,
    lyrics: [],
    background: { ...DEFAULT_BACKGROUND },
    typography: { ...DEFAULT_TYPOGRAPHY },
    watermark: {
      enabled: false,
      text: 'Custom Brand',
    },
  } as unknown as ProjectData;

  const normalized = normalizeLoadedProject(partialProject);

  assert.equal(normalized.watermark.enabled, false);
  assert.equal(normalized.watermark.text, 'Custom Brand');
  assert.equal(normalized.watermark.fontFamily, DEFAULT_WATERMARK.fontFamily);
  assert.equal(normalized.watermark.strokeColor, DEFAULT_WATERMARK.strokeColor);
});

test('normalizeLoadedProject strips inline and outer bracketed backing vocals from legacy saved cues', () => {
  const legacySaved = {
    id: 'legacy_proj_brackets',
    name: 'Legacy Worship Track',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    aspectRatio: '16:9',
    duration: 30,
    audioFileName: null,
    background: { ...DEFAULT_BACKGROUND },
    typography: { ...DEFAULT_TYPOGRAPHY },
    watermark: { ...DEFAULT_WATERMARK },
    lyrics: [
      {
        id: 'l1',
        text: 'Your Jireh (Jireh)',
        section: 'chorus',
        vocalRole: 'lead',
        start: 1,
        end: 4,
        effect: 'fade',
        effectOverride: false,
        words: [],
      },
      {
        id: 'l2',
        text: '(You are enough)',
        section: 'chorus',
        vocalRole: 'backing',
        start: 1.5,
        end: 4.2,
        effect: 'fade',
        effectOverride: false,
        words: [],
      },
    ],
  } as unknown as ProjectData;

  const normalized = normalizeLoadedProject(legacySaved);
  assert.equal(normalized.lyrics[0].text, 'Your Jireh');
  assert.equal(normalized.lyrics[1].text, 'You are enough');
  assert.equal(normalized.lyrics[1].vocalRole, 'backing');
  assert.equal(normalized.vocalLayers?.backing.visible, false);

  const userConfigured = normalizeLoadedProject({
    ...legacySaved,
    vocalLayers: {
      ...DEFAULT_VOCAL_LAYERS,
      backingUserConfigured: true,
      backing: { ...DEFAULT_VOCAL_LAYERS.backing, visible: true },
    },
  } as unknown as ProjectData);
  assert.equal(userConfigured.vocalLayers?.backing.visible, true);
});
