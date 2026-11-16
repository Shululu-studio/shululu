import test from 'node:test';
import assert from 'node:assert/strict';
import { extractId3LyricsFromBuffer } from './id3Lyrics.ts';

test('extractId3LyricsFromBuffer extracts embedded ID3v2.3 USLT lyrics frame', () => {
  const lyrics = 'Line one of the song\nLine two of the chorus';
  const textBytes = Buffer.from(lyrics, 'utf8');
  // USLT payload: encoding(0x03 UTF-8) + lang('eng') + desc('\0') + text
  const payload = Buffer.concat([Buffer.from([0x03]), Buffer.from('eng', 'ascii'), Buffer.from([0x00]), textBytes]);
  const frameHeader = Buffer.alloc(10);
  frameHeader.write('USLT', 0, 'ascii');
  frameHeader.writeUInt32BE(payload.length, 4);

  const tagBodySize = frameHeader.length + payload.length;
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'ascii');
  header[3] = 3; // ID3v2.3
  header[4] = 0;
  header[5] = 0;
  // synchsafe 28-bit size
  header[6] = (tagBodySize >> 21) & 0x7f;
  header[7] = (tagBodySize >> 14) & 0x7f;
  header[8] = (tagBodySize >> 7) & 0x7f;
  header[9] = tagBodySize & 0x7f;

  const full = Buffer.concat([header, frameHeader, payload]);
  const ab = full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
  assert.equal(extractId3LyricsFromBuffer(ab), lyrics);
});

test('extractId3LyricsFromBuffer returns null for non-ID3 audio data', () => {
  const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ');
  const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
  assert.equal(extractId3LyricsFromBuffer(ab), null);
});
