import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { fail } from './security.js';

// Decode pixels, discard all source metadata, and emit a fresh PNG. No uploaded SVG or HTML is served.
export function sanitizePhoto(value) {
  if (typeof value !== 'string') throw fail('Choose a JPEG or PNG photo.');
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0 || Buffer.byteLength(match[2], 'base64') > 2 * 1024 * 1024) throw fail('Choose a JPEG or PNG image under 2 MB.');
  try {
    const input = Buffer.from(match[2], 'base64');
    let decoded;
    if (match[1] === 'png') {
      if (input.length < 33 || !input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || input.toString('ascii',12,16) !== 'IHDR') throw new Error('Invalid PNG header');
      const width = input.readUInt32BE(16), height = input.readUInt32BE(20);
      if (width < 1 || height < 1 || width * height > 12000000 || width > 12000 || height > 12000) throw new Error('Dimensions exceed limit');
      decoded = PNG.sync.read(input, { checkCRC: true });
    } else {
      if (input[0] !== 255 || input[1] !== 216) throw new Error('Invalid JPEG header');
      decoded = jpeg.decode(input, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 12, maxMemoryUsageInMB: 128 });
    }
    const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale)), height = Math.max(1, Math.round(decoded.height * scale));
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = (Math.min(decoded.height - 1, Math.floor(y / scale)) * decoded.width + Math.min(decoded.width - 1, Math.floor(x / scale))) * 4;
      const dest = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) pixels[dest + channel] = decoded.data[source + channel];
    }
    return PNG.sync.write({ width, height, data: pixels });
  } catch { throw fail('This image could not be decoded. Choose a valid JPEG or PNG under 12 megapixels.'); }
}
