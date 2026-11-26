'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { createEditablePromoPptx, EDITABLE_IMPORT_LIMITS, MIME_TYPE } = require('./editable-pptx');

const fixture = () => ({ title: '【整合測試】ITRC 可編輯設計', slides: [
  { heading: '測試宣傳', body: '【ITRC整合測試】\n這是自動宣傳模板。\n僅供驗證，請勿正式發布。' },
  { heading: '測試資訊', body: '【ITRC整合測試】\n活動：測試活動\n日期、時間：待確認\n地點：待確認\n僅供驗證，請勿發布。' },
  { heading: '測試參與', body: '【ITRC整合測試】\n報名方式：待確認\n參與資訊：測試資料\n僅供驗證，請勿發布。' },
] });

function decodeText(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, entity =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]);
}

function namedText(xml, name) {
  const shape = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(match => match[0])
    .find(value => value.includes(`name="${name}"`));
  assert.ok(shape, `Missing native text shape ${name}`);
  const paragraphs = [...shape.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)];
  return paragraphs.map(([, paragraph]) => [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map(([, value]) => decodeText(value)).join('')).join('\n');
}

async function slideXml(zip, page) { return zip.file(`ppt/slides/slide${page}.xml`).async('string'); }

test('renderer emits exactly three portrait pages with native text and shapes, without media or external relationships', async () => {
  const input = fixture();
  const snapshot = structuredClone(input);
  const result = await createEditablePromoPptx(input);
  assert.ok(Buffer.isBuffer(result));
  assert.equal(MIME_TYPE, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.deepEqual(input, snapshot);
  const zip = await JSZip.loadAsync(result);
  assert.equal(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 3);
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /<p:sldSz cx="9875520" cy="12344400"/);
  assert.equal(Object.values(zip.files).filter(file => !file.dir && /^ppt\/(media|embeddings)\//.test(file.name)).length, 0);
  for (let page = 1; page <= 3; page++) {
    const xml = await slideXml(zip, page);
    assert.equal(namedText(xml, `ITRC heading ${page}`), input.slides[page - 1].heading);
    assert.equal(namedText(xml, `ITRC body ${page}`), input.slides[page - 1].body);
    assert.ok((xml.match(/<p:sp>/g) || []).length >= 10);
    assert.match(xml, /<a:prstGeom prst="rect"/);
    assert.match(xml, /<a:prstGeom prst="ellipse"/);
    assert.ok(!/<p:pic>|<p:oleObj|<a:hlinkClick/.test(xml));
  }
  for (const file of Object.values(zip.files).filter(file => !file.dir && file.name.endsWith('.rels'))) {
    assert.ok(!/TargetMode="External"/.test(await file.async('string')), file.name);
  }
});

test('approved literal text is XML escaped, whitespace is retained, and extra properties cannot inject options or links', async () => {
  const input = fixture();
  input.title = '【測試】<&>"\'';
  input.slides[0].heading = '<&>"\'測試';
  input.slides[0].body = ' 前後空白\nA&B <文字> "雙引號" \'單引號\' ';
  input.slides[1].body = 'https://example.invalid/approved-literal-text';
  input.slides[0].options = { hyperlink: { url: 'https://example.invalid/DO_NOT_RENDER' } };
  input.slides[0].image = 'DO_NOT_RENDER';
  input.event = { title: 'DO_NOT_RENDER', location: 'DO_NOT_RENDER' };
  const zip = await JSZip.loadAsync(await createEditablePromoPptx(input));
  const xml = await slideXml(zip, 1);
  assert.equal(namedText(xml, 'ITRC heading 1'), input.slides[0].heading);
  assert.equal(namedText(xml, 'ITRC body 1'), input.slides[0].body);
  assert.match(xml, /&lt;&amp;&gt;/);
  for (const file of Object.values(zip.files).filter(file => !file.dir && /\.(xml|rels)$/.test(file.name))) {
    const contents = await file.async('string');
    assert.ok(!contents.includes('DO_NOT_RENDER'));
    assert.ok(!contents.includes('TargetMode="External"'));
  }
});

test('character limits are enforced without truncation, with supplementary Unicode counted as characters', async () => {
  assert.deepEqual(EDITABLE_IMPORT_LIMITS, [{ heading: 8, body: 42 }, { heading: 8, body: 84 }, { heading: 8, body: 84 }]);
  assert.ok(Object.isFrozen(EDITABLE_IMPORT_LIMITS));
  assert.ok(EDITABLE_IMPORT_LIMITS.every(Object.isFrozen));
  const maximum = { title: '題'.repeat(50), slides: EDITABLE_IMPORT_LIMITS.map(limit =>
    ({ heading: '題'.repeat(limit.heading), body: '文'.repeat(limit.body) })) };
  const zip = await JSZip.loadAsync(await createEditablePromoPptx(maximum));
  for (let page = 1; page <= 3; page++) {
    const xml = await slideXml(zip, page);
    assert.equal(namedText(xml, `ITRC heading ${page}`), maximum.slides[page - 1].heading);
    assert.equal(namedText(xml, `ITRC body ${page}`), maximum.slides[page - 1].body);
    for (const field of ['heading', 'body']) {
      const tooLong = structuredClone(maximum); tooLong.slides[page - 1][field] += '多';
      await assert.rejects(createEditablePromoPptx(tooLong), TypeError);
    }
  }
  await assert.rejects(createEditablePromoPptx({ ...maximum, title: '題'.repeat(51) }), TypeError);
  const unicode = fixture(); unicode.slides[0].heading = '😀'.repeat(8);
  const unicodeXml = await slideXml(await JSZip.loadAsync(await createEditablePromoPptx(unicode)), 1);
  assert.equal(namedText(unicodeXml, 'ITRC heading 1'), unicode.slides[0].heading);
});

test('nonprimitive text, sparse or wrong-length slides, empty content and invalid XML characters are rejected', async () => {
  for (const invalid of [null, undefined, [], 'text']) await assert.rejects(createEditablePromoPptx(invalid), TypeError);
  for (const slides of [null, {}, [], fixture().slides.slice(0, 2), [...fixture().slides, fixture().slides[0]], new Array(3)]) {
    await assert.rejects(createEditablePromoPptx({ ...fixture(), slides }), TypeError);
  }
  for (const value of ['', ' \n\t', 42, true, {}, ['text'], new String('text'),
    { text: 'text', options: { hyperlink: { url: 'https://example.invalid/' } } }]) {
    const invalid = fixture(); invalid.slides[0].heading = value;
    await assert.rejects(createEditablePromoPptx(invalid), TypeError);
    invalid.slides[0].heading = '測試'; invalid.slides[0].body = value;
    await assert.rejects(createEditablePromoPptx(invalid), TypeError);
    await assert.rejects(createEditablePromoPptx({ ...fixture(), title: value }), TypeError);
  }
  for (const character of ['\0', '\u0001', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\ud800', '\udfff', '\ufffe', '\uffff']) {
    for (const field of ['heading', 'body']) {
      const invalid = fixture(); invalid.slides[0][field] = '測' + character + '試';
      await assert.rejects(createEditablePromoPptx(invalid), TypeError);
    }
    await assert.rejects(createEditablePromoPptx({ ...fixture(), title: '測' + character + '試' }), TypeError);
  }
});

test('excessive line breaks are rejected instead of clipping or silently changing approved copy', async () => {
  for (const field of ['heading', 'body']) {
    const invalid = fixture(); invalid.slides[0][field] = field === 'heading' ? '測\n試\n標\n題' : '文\n'.repeat(20);
    await assert.rejects(createEditablePromoPptx(invalid), TypeError);
  }
});
