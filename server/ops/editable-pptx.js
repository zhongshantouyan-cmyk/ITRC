'use strict';

const PptxGenJS = require('pptxgenjs');

const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EDITABLE_IMPORT_LIMITS = Object.freeze([
  Object.freeze({ heading: 8, body: 42 }),
  Object.freeze({ heading: 8, body: 84 }),
  Object.freeze({ heading: 8, body: 84 }),
]);
const FONT_FACE = 'Noto Sans CJK TC';
const COLORS = Object.freeze({
  cream: 'FFF9E4', green: '4F7059', red: 'BD4D43', brown: '795332',
  yellow: 'FFD43B', gold: 'D6AF28',
});
const BODY_LAYOUTS = Object.freeze([
  Object.freeze({ x: 2.20, y: 5.30, w: 6.40, h: 2.40, fontSize: 23.76, align: 'center' }),
  Object.freeze({ x: 2.13, y: 8.70, w: 6.54, h: 2.40, fontSize: 20.88, align: 'left' }),
  Object.freeze({ x: 2.10, y: 9.33, w: 6.60, h: 1.80, fontSize: 24.48, align: 'center' }),
]);

function checkedText(value, maximum, field) {
  if (typeof value !== 'string' || value.length > maximum * 2 || !value.trim() || Array.from(value).length > maximum) {
    throw new TypeError(`Invalid ${field}: expected nonempty text within the character limit.`);
  }
  // XML 1.0 permits TAB, LF and CR, but not other C0 controls, lone UTF-16
  // surrogates, U+FFFE or U+FFFF. Validate without normalizing approved copy.
  for (const character of value) {
    const code = character.codePointAt(0);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
        (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) {
      throw new TypeError(`Invalid ${field}: unsupported text character.`);
    }
  }
  return value;
}

function fittingFontSize(text, layout, minimum) {
  // Count every code point as a full-width glyph, deliberately overestimating
  // Latin text. Reject excessive line breaks instead of clipping, truncating,
  // hiding text, or shrinking it below a readable size.
  for (let size = layout.fontSize; size >= minimum; size -= 0.5) {
    const columns = Math.max(1, Math.floor(layout.w * 72 / size));
    const lines = text.split(/\r\n|[\r\n\u2028\u2029]/).reduce((count, line) =>
      count + Math.max(1, Math.ceil(Array.from(line.replace(/\t/g, '    ')).length / columns)), 0);
    if (lines * size * 1.3 <= layout.h * 72) return size;
  }
  throw new TypeError('Approved text has too many lines for the editable layout.');
}

function shape(slide, type, color, x, y, w, h, options = {}) {
  slide.addShape(type, { x, y, w, h, fill: { color }, line: { color, transparency: 100 }, ...options });
}

function text(slide, value, layout, options = {}) {
  // The first argument is always a validated primitive string, never user runs
  // or options. PptxGenJS owns all XML escaping; no user XML is interpolated.
  slide.addText(value, {
    ...layout, fontFace: FONT_FACE, color: COLORS.brown, bold: true,
    lang: 'zh-TW', margin: 0, breakLine: false, paraSpaceAfter: 0,
    paraSpaceBefore: 0, lineSpacingMultiple: 1.2, valign: 'top',
    ...options,
  });
}

function ribbon(slide, shapes, y) {
  shape(slide, shapes.rect, COLORS.gold, 1.82, y + 0.07, 0.38, 0.58);
  shape(slide, shapes.rect, COLORS.gold, 8.60, y + 0.07, 0.38, 0.58);
  shape(slide, shapes.rect, COLORS.yellow, 2.12, y, 6.56, 0.65);
}

function frame(slide, shapes, page) {
  const outerColor = page === 1 ? COLORS.red : COLORS.green;
  slide.background = { color: outerColor };
  shape(slide, shapes.rect, COLORS.cream, 0.75, 1.08, 9.30, 11.30);
  // Native circles form the stamp edge; no picture or flattened background.
  for (let i = 0; i < 11; i++) {
    const x = 0.75 + i * 0.93 - 0.27;
    shape(slide, shapes.ellipse, outerColor, x, 0.81, 0.54, 0.54);
    shape(slide, shapes.ellipse, outerColor, x, 12.11, 0.54, 0.54);
  }
  for (let i = 1; i < 14; i++) {
    const y = 1.08 + i * (11.30 / 14) - 0.27;
    shape(slide, shapes.ellipse, outerColor, 0.48, y, 0.54, 0.54);
    shape(slide, shapes.ellipse, outerColor, 9.78, y, 0.54, 0.54);
  }
  slide.addShape(shapes.rect, { x: 1.80, y: 2.10, w: 7.20, h: 9.30,
    fill: { color: COLORS.cream, transparency: 100 }, line: { color: COLORS.brown, width: 1.6 } });
  text(slide, '@NSYSU_ITRC', { x: 1.0, y: 0.39, w: 8.80, h: 0.40, fontSize: 19.5, align: 'center' },
    { color: COLORS.cream });
  text(slide, '— 投資交易研究社 —', { x: 1.0, y: 12.73, w: 8.80, h: 0.35, fontSize: 17.3, align: 'center' },
    { color: COLORS.cream, bold: false });
  for (const [index, color] of [COLORS.yellow, COLORS.green, COLORS.red].entries()) {
    shape(slide, shapes.ellipse, color, 4.61 + index * 0.67, 11.84, 0.36, 0.36);
    shape(slide, shapes.rect, color, 4.76 + index * 0.67, 12.15, 0.06, 0.20);
  }
  shape(slide, shapes.star4, COLORS.yellow, 2.39, 2.60, 0.32, 0.32);
  shape(slide, shapes.star4, COLORS.yellow, 8.05, page === 0 ? 2.99 : 5.63, 0.35, 0.35);
}

function decorations(slide, shapes, page) {
  if (page === 0) {
    text(slide, 'ITRC', { x: 3.90, y: 2.48, w: 3.0, h: 0.42, fontSize: 24, align: 'center' },
      { color: COLORS.green });
    ribbon(slide, shapes, 4.35);
    shape(slide, shapes.roundRect, COLORS.red, 2.12, 7.98, 2.53, 0.57);
    slide.addShape(shapes.line, { x: 2.14, y: 8.87, w: 6.52, h: 0, line: { color: COLORS.brown, width: 0.8 } });
    shape(slide, shapes.roundRect, COLORS.green, 2.12, 9.16, 6.46, 0.57);
  } else {
    const colors = page === 1 ? [COLORS.green, COLORS.red, COLORS.green] : [COLORS.red, COLORS.green, COLORS.red];
    colors.forEach((color, index) => shape(slide, shapes.roundRect, color, 2.10, 6.16 + index * 0.73, 1.24, 0.53));
    ribbon(slide, shapes, page === 1 ? 5.12 : 8.55);
    if (page === 1) slide.addShape(shapes.line, { x: 2.14, y: 8.43, w: 6.52, h: 0,
      line: { color: COLORS.brown, width: 0.8 } });
  }
}

async function createEditablePromoPptx(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid editable design input.');
  const title = checkedText(input.title, 50, 'title');
  if (!Array.isArray(input.slides) || input.slides.length !== 3) throw new TypeError('Exactly three approved slides are required.');
  // Snapshot every primitive before asynchronous work. Extra input properties
  // never become presentation content, links, images, or library options.
  const approved = EDITABLE_IMPORT_LIMITS.map((limit, page) => {
    const item = input.slides[page];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid approved slide.');
    const heading = checkedText(item.heading, limit.heading, 'heading');
    const body = checkedText(item.body, limit.body, 'body');
    const headingLayout = { x: 2.14, y: 3.13, w: 6.52, h: 1.08, fontSize: page === 0 ? 56.88 : 46.80, align: 'center' };
    return { heading, body,
      headingLayout: { ...headingLayout, fontSize: fittingFontSize(heading, headingLayout, 36) },
      bodyLayout: { ...BODY_LAYOUTS[page], fontSize: fittingFontSize(body, BODY_LAYOUTS[page], 18) } };
  });

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'ITRC_PORTRAIT_4_5', width: 10.8, height: 13.5 });
  pptx.layout = 'ITRC_PORTRAIT_4_5';
  pptx.author = 'ITRC';
  pptx.subject = 'ITRC editable promotional design';
  pptx.title = title;
  pptx.company = 'ITRC';
  pptx.lang = 'zh-TW';
  pptx.theme = { headFontFace: FONT_FACE, bodyFontFace: FONT_FACE, lang: 'zh-TW' };
  approved.forEach((item, page) => {
    const slide = pptx.addSlide();
    frame(slide, pptx.ShapeType, page);
    decorations(slide, pptx.ShapeType, page);
    text(slide, item.heading, item.headingLayout,
      { color: page === 0 ? COLORS.red : COLORS.green, objectName: `ITRC heading ${page + 1}` });
    text(slide, item.body, item.bodyLayout, { objectName: `ITRC body ${page + 1}` });
  });
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer', compression: true }));
}

module.exports = { createEditablePromoPptx, EDITABLE_IMPORT_LIMITS, MIME_TYPE };
