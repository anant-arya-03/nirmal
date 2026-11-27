import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sanitizePhoto } from '../server/images.js';

test('JPEG evidence is decoded and re-encoded as a metadata-free PNG',()=>{
  const source=jpeg.encode({width:2,height:2,data:Buffer.alloc(16,255)},80).data;
  const result=PNG.sync.read(sanitizePhoto(`data:image/jpeg;base64,${source.toString('base64')}`));
  assert.equal(result.width,2);assert.equal(result.height,2);
});
test('large images are resized and invalid, mismatched, and excessive pixel inputs are rejected',()=>{
  const source=PNG.sync.write({width:1800,height:2,data:Buffer.alloc(1800*2*4,255)});
  assert.equal(PNG.sync.read(sanitizePhoto(`data:image/png;base64,${source.toString('base64')}`)).width,1600);
  const forged=Buffer.from(source);forged.writeUInt32BE(100000,16);
  assert.throws(()=>sanitizePhoto(`data:image/png;base64,${forged.toString('base64')}`));
  assert.throws(()=>sanitizePhoto('data:image/svg+xml;base64,PHN2Zy8+'));
  assert.throws(()=>sanitizePhoto(`data:image/jpeg;base64,${source.toString('base64')}`));
  assert.throws(()=>sanitizePhoto(`data:image/png;base64,${Buffer.alloc(2097153).toString('base64')}`));
});
