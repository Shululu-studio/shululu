function decodeTextBytes(bytes: Uint8Array, encodingByte: number): string {
  if (bytes.length === 0) return '';
  try {
    if (encodingByte === 0) {
      return new TextDecoder('latin1').decode(bytes).replace(/\0/g, '').trim();
    }
    if (encodingByte === 1 || encodingByte === 2) {
      // UTF-16 with or without BOM
      let isLittleEndian = true;
      let offset = 0;
      if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
          isLittleEndian = true;
          offset = 2;
        } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
          isLittleEndian = false;
          offset = 2;
        } else if (encodingByte === 2) {
          isLittleEndian = false;
        }
      }
      const decoder = new TextDecoder(isLittleEndian ? 'utf-16le' : 'utf-16be');
      return decoder.decode(bytes.subarray(offset)).replace(/\0/g, '').trim();
    }
    return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\0/g, '').trim();
  }
}

function skipNullTerminated(bytes: Uint8Array, start: number, encodingByte: number): number {
  const isUtf16 = encodingByte === 1 || encodingByte === 2;
  if (isUtf16) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
    }
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0) return i + 1;
  }
  return bytes.length;
}

function readSynchsafeInt(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
}

function readUint32BE(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/**
 * Extracts genuine embedded USLT (unsynchronised lyrics) or SYLT (synchronised lyrics)
 * from an MP3 ID3v2 header if present. Returns null when no embedded lyrics exist.
 */
export function extractId3LyricsFromBuffer(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10) return null;
  // Check "ID3" magic
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }

  const versionMajor = bytes[3];
  const flags = bytes[5];
  const tagSize = readSynchsafeInt(bytes[6], bytes[7], bytes[8], bytes[9]);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);

  let pos = 10;
  // Skip extended header if present
  if ((flags & 0x40) !== 0 && pos + 4 <= tagEnd) {
    const extSize =
      versionMajor === 4
        ? readSynchsafeInt(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3])
        : readUint32BE(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    pos += Math.max(4, extSize);
  }

  if (versionMajor < 3 || versionMajor > 4) return null;

  while (pos + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      bytes[pos],
      bytes[pos + 1],
      bytes[pos + 2],
      bytes[pos + 3]
    );
    if (frameId === '\0\0\0\0' || !/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize =
      versionMajor === 4
        ? readSynchsafeInt(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
        : readUint32BE(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);

    pos += 10;
    if (frameSize <= 0 || pos + frameSize > tagEnd) break;

    const payload = bytes.subarray(pos, pos + frameSize);
    pos += frameSize;

    if (frameId === 'USLT' && payload.length > 4) {
      const encoding = payload[0];
      // bytes 1..3 = 3-letter language code, followed by null-terminated content descriptor
      const lyricsStart = skipNullTerminated(payload, 4, encoding);
      const text = decodeTextBytes(payload.subarray(lyricsStart), encoding);
      if (text.length >= 4) return text;
    }

    if (frameId === 'TXXX' && payload.length > 2) {
      const encoding = payload[0];
      const descEnd = skipNullTerminated(payload, 1, encoding);
      const desc = decodeTextBytes(payload.subarray(1, descEnd), encoding).toLowerCase();
      if (desc.includes('lyric')) {
        const text = decodeTextBytes(payload.subarray(descEnd), encoding);
        if (text.length >= 4) return text;
      }
    }
  }

  return null;
}

export async function extractId3LyricsFromBlob(blob: Blob | null): Promise<string | null> {
  if (!blob) return null;
  try {
    // Only inspect the first 512KB (ID3v2 header sits at offset 0)
    const slice = blob.slice(0, Math.min(blob.size, 512 * 1024));
    const buf = await slice.arrayBuffer();
    return extractId3LyricsFromBuffer(buf);
  } catch {
    return null;
  }
}
