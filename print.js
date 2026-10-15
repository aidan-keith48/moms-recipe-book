'use strict';

/* ==========================================================================
   Printable version — lays the whole book out as sequential sheets using
   the same page-building code as the live flipbook (book-core.js), sized
   to an exact sheet of paper so what you see is what prints.
   ========================================================================== */

// CSS px equivalents (96px/in) of each paper size. The page content (.rp,
// .cover-page, .back-cover-page) fills 100% of this, same as the live book —
// its own padding and decorative frame already keep everything off the edge.
const PAPER = {
  a4: { w: (210 / 25.4) * 96, h: (297 / 25.4) * 96 },
  letter: { w: 8.5 * 96, h: 11 * 96 },
};

const bookEl = document.getElementById('book');

function paperSizeFromQuery() {
  const q = new URLSearchParams(location.search).get('size');
  return q === 'letter' ? 'letter' : 'a4';
}

function setPageCss(size) {
  let style = document.getElementById('page-size-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'page-size-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${size === 'letter' ? 'letter' : 'A4'}; margin: 0; }`;
  document.body.className = 'size-' + size;
}

async function loadRecipes() {
  const res = await fetch('recipes.json');
  return sortRecipes(await res.json());
}

function render(size) {
  const paper = PAPER[size];
  const layout = { mode: 'portrait', pw: paper.w, ph: paper.h };

  bookEl.replaceChildren();
  bookEl.style.setProperty('--pw', layout.pw + 'px');
  bookEl.style.setProperty('--ph', layout.ph + 'px');

  const { pages } = buildBook(layout, window.__recipes);
  pages.forEach((p) => bookEl.appendChild(createPageEl(p)));
}

function wireSizeButtons() {
  const buttons = { a4: document.getElementById('size-a4'), letter: document.getElementById('size-letter') };
  const select = (size) => {
    setPageCss(size);
    render(size);
    buttons.a4.setAttribute('aria-pressed', String(size === 'a4'));
    buttons.letter.setAttribute('aria-pressed', String(size === 'letter'));
    try {
      const url = new URL(location.href);
      url.searchParams.set('size', size);
      history.replaceState(null, '', url);
    } catch (e) {
      /* ignore */
    }
  };
  buttons.a4.addEventListener('click', () => select('a4'));
  buttons.letter.addEventListener('click', () => select('letter'));
  document.getElementById('do-print').addEventListener('click', () => window.print());
  return select;
}

async function init() {
  const select = wireSizeButtons();
  try {
    window.__recipes = await loadRecipes();
  } catch (e) {
    bookEl.innerHTML = '<p class="loading-note">Sorry, the recipes could not be loaded.</p>';
    return;
  }
  await Promise.all([
    document.fonts.load('400 16px Lora'),
    document.fonts.load('600 16px Lora'),
    document.fonts.load('italic 400 16px Lora'),
    document.fonts.load('40px "Homemade Apple"'),
  ]).catch(() => {});
  select(paperSizeFromQuery());
}

init();
