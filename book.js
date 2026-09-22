'use strict';

/* ==========================================================================
   Mom's Recipe Book — flipbook
   1. load recipes.json + fonts + cover photo
   2. work out how big one page can be on this screen
   3. flow every recipe into as many pages as it needs (nothing is ever cut off)
   4. hand the pages to StPageFlip
   The book is rebuilt if the screen changes size (rotating a phone, etc).
   ========================================================================== */

const COVER_PHOTO = 'assets/img/cover-photo.jpg';
const PAGE_RATIO = 0.72; // page width / page height on desktop spreads

const CATEGORY_LABELS = {
  baking: 'Baking',
  mains: 'Mains',
  snacks: 'Snacks & Drinks',
  reference: 'Reference',
};
const CATEGORY_ORDER = ['baking', 'mains', 'snacks', 'reference'];

const stage = document.getElementById('stage');
const slider = document.getElementById('slider');
const loadingEl = document.getElementById('loading');
const hintEl = document.getElementById('hint');
const prevBtn = document.getElementById('btn-prev');
const nextBtn = document.getElementById('btn-next');
const tocBtn = document.getElementById('btn-toc');

const isTouch = window.matchMedia('(pointer: coarse)').matches;

const state = {
  recipes: [],
  layout: null,
  pageFlip: null,
  bookEl: null,
  metas: [],
  starts: {},
  spreadCount: 0,
  currentKey: 'cover',
};

/* -------------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------------- */

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function icon(name, cls = '') {
  return `<img${cls ? ` class="${cls}"` : ''} src="assets/icons/${name}.svg" alt="">`;
}

function titleScale(title, hasHero) {
  const len = title.length;
  const s = len <= 12 ? 0.115 : len <= 20 ? 0.092 : len <= 30 ? 0.075 : 0.066;
  return hasHero ? s * 0.85 : s;
}

/* -------------------------------------------------------------------------
   Layout: how big is one page on this screen?
   ------------------------------------------------------------------------- */

function computeLayout() {
  const margin = stage.clientWidth < 600 ? 8 : 20;
  const vw = stage.clientWidth - margin * 2;
  const vh = stage.clientHeight - margin * 2;

  const landscape = vw >= 860 && vw / vh >= 1.3;
  if (landscape) {
    const ph = Math.floor(Math.min(vh, vw / (2 * PAGE_RATIO), 880));
    return { mode: 'landscape', pw: Math.floor(ph * PAGE_RATIO), ph };
  }

  // Single page. On a very short window (phone held sideways) keep the page
  // roughly upright instead of a wide, squat strip.
  const ph = Math.floor(Math.min(vh, 1240));
  const pw = Math.floor(Math.min(vw, 620, Math.max(ph * 0.85, 280)));
  return { mode: 'portrait', pw, ph, sideways: vw > vh * 1.2 };
}

function sameLayout(a, b) {
  return (
    a && b && a.mode === b.mode && Math.abs(a.pw - b.pw) < 4 && Math.abs(a.ph - b.ph) < 4
  );
}

/* -------------------------------------------------------------------------
   Content blocks ("atoms") -> HTML
   ------------------------------------------------------------------------- */

function renderBlock(a) {
  switch (a.t) {
    case 'header': {
      const r = a.recipe;
      const ribbon = r.subtitle
        ? `<div class="ribbon-wrap">${icon('ribbon-banner')}<span class="ribbon-text">${esc(
            r.subtitle.toUpperCase()
          )}</span></div>`
        : '';
      const hero = r.hero
        ? `<img class="rp-hero" src="${esc(r.hero)}" alt="${esc(r.title)} illustration">`
        : '';
      return `<div class="rp-header">
        <div class="rp-header-text">
          <div class="header-doodles">${icon('heart')}${icon('star')}${icon('sparkle')}</div>
          <h1 class="rp-title" style="--ts:${titleScale(r.title, !!r.hero)}">${esc(r.title)}</h1>
          ${ribbon}
        </div>${hero}</div>`;
    }
    case 'h2':
      return `<div class="rp-heading"><h2>${esc(a.text)}</h2><span class="rp-rule"></span></div>${
        a.extra || ''
      }`;
    case 'cont':
      return `<div class="rp-cont">${a.title ? `<span class="cont-title">${esc(a.title)}</span>` : ''}
        <div class="rp-heading"><h2>${esc(a.text)}<span class="cont-tag">continued</span></h2><span class="rp-rule"></span></div></div>`;
    case 'oven':
      return `<div class="callout dashed">${icon('oven')}<div>
        <span class="callout-label">Oven</span><br>
        <span class="callout-value">${esc(a.oven.temp)} · ${esc(a.oven.time)}</span></div></div>`;
    case 'bubble':
      return `<div class="speech-bubble">${esc(a.text)}</div>`;
    case 'note':
      return `<div class="nota-box">${icon('washi-tape', 'washi')}
        <span class="nota-label">${esc(a.label)}</span><p>${esc(a.text)}</p></div>`;
    case 'toc-title':
      return `<h1 class="toc-h1">Contents</h1>`;
    case 'toc-cat':
      return `<div class="toc-category">${esc(a.text)}</div>`;
    default:
      return '';
  }
}

function renderAtoms(atoms) {
  let html = '';
  let i = 0;
  while (i < atoms.length) {
    const t = atoms[i].t;
    if (t === 'li' || t === 'step' || t === 'toc-item') {
      const first = atoms[i];
      let items = '';
      while (i < atoms.length && atoms[i].t === t) {
        items += `<li>${atoms[i].html}</li>`;
        i++;
      }
      if (t === 'li') html += `<ul class="ingredients-list">${items}</ul>`;
      else if (t === 'step') html += `<ol class="method-list" start="${first.n}">${items}</ol>`;
      else html += `<ul class="toc-list">${items}</ul>`;
    } else {
      html += renderBlock(atoms[i]);
      i++;
    }
  }
  return html;
}

const HEADING_ATOMS = new Set(['h2', 'cont', 'toc-cat', 'toc-title']);

/* -------------------------------------------------------------------------
   Pagination: flow atoms into as many pages as they need
   ------------------------------------------------------------------------- */

function createMeasurer(layout) {
  const el = document.createElement('div');
  el.className = 'measure';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:${layout.pw}px;height:${layout.ph}px;`;
  el.style.setProperty('--pw', layout.pw + 'px');
  el.style.setProperty('--ph', layout.ph + 'px');
  el.innerHTML = '<div class="recipe-page rp"><div class="rp-body"></div></div>';
  document.body.appendChild(el);

  const rp = el.firstElementChild;
  const body = rp.firstElementChild;
  const cs = getComputedStyle(rp);
  const avail = layout.ph - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

  return {
    fits(atoms) {
      body.innerHTML = renderAtoms(atoms);
      return body.offsetHeight <= avail;
    },
    destroy() {
      el.remove();
    },
  };
}

function paginate(atoms, measurer, makeCont) {
  const pages = [];
  let cur = [];
  const hasContent = (list) => list.some((a) => a.t !== 'cont');

  for (const atom of atoms) {
    if (measurer.fits([...cur, atom]) || !hasContent(cur)) {
      cur.push(atom);
      continue;
    }
    // Page is full. Small blocks (oven, note...) travel with the item before
    // them, and a heading is never left stranded at the bottom.
    const carry = [];
    const last = cur[cur.length - 1];
    if (atom.keep && last && (last.t === 'li' || last.t === 'step') && cur.filter((a) => a.t === last.t).length > 1) {
      carry.unshift(cur.pop());
    }
    while (cur.length && HEADING_ATOMS.has(cur[cur.length - 1].t) && cur[cur.length - 1].t !== 'cont') {
      carry.unshift(cur.pop());
    }
    if (hasContent(cur)) {
      pages.push(cur);
      cur = [makeCont(), ...carry, atom];
    } else {
      cur = [...cur, ...carry, atom];
    }
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function recipeAtoms(recipe) {
  const left = [{ t: 'header', recipe }, { t: 'h2', text: 'Ingredients' }];
  for (const ing of recipe.ingredients) {
    const bullet = ing.icon ? icon(ing.icon) : '<span class="ingredient-dot"></span>';
    left.push({ t: 'li', html: `${bullet}${esc(ing.text)}` });
  }
  if (recipe.oven) left.push({ t: 'oven', oven: recipe.oven, keep: true });

  const methodHero = recipe.methodHero
    ? `<img class="method-hero" src="${esc(recipe.methodHero)}" alt="">`
    : '';
  const right = [{ t: 'h2', text: 'Method', extra: methodHero }];
  recipe.steps.forEach((step, i) => right.push({ t: 'step', n: i + 1, html: esc(step) }));
  if (recipe.doneness) right.push({ t: 'bubble', text: recipe.doneness, keep: true });
  if (recipe.note) {
    right.push({ t: 'note', label: recipe.noteLabel || "Mom's Tip:", text: recipe.note, keep: true });
  }
  return { left, right };
}

/* -------------------------------------------------------------------------
   Assemble the whole book
   ------------------------------------------------------------------------- */

function coverHtml() {
  return `<div class="cover-page">
    <div class="cover-photo">
      <img class="photo" src="${COVER_PHOTO}" alt="Mom, smiling in her kitchen">
      ${icon('washi-tape', 'tape')}
    </div>
    <h1>Mom's Recipes</h1>
    <p class="cover-subtitle">a little book of her favorites</p>
    <div class="cover-doodles">${icon('heart')}${icon('star')}${icon('sparkle')}</div>
  </div>`;
}

function backCoverHtml() {
  return `<div class="back-cover-page">
    <div class="farewell">
      <p>Her recipes were made with love.</p>
      <p>Her life was lived with even more.</p>
      <p>A love that will forever remain at our table.</p>
    </div>
    ${icon('heart')}
    <span class="credit">Created with love by Aidan &amp; Shanny</span>
  </div>`;
}

const fillerHtml = () => `<div class="rp-filler">${icon('heart')}${icon('star')}${icon('sparkle')}</div>`;

function buildBook(layout, recipes) {
  const landscape = layout.mode === 'landscape';
  const measurer = createMeasurer(layout);
  const pages = []; // { html, raw?, hard?, role, recipeId? }
  const starts = {};

  const filler = (recipeId) => ({ html: fillerHtml(), role: 'filler', recipeId });

  pages.push({ html: coverHtml(), raw: true, hard: true, role: 'cover' });

  // ---- contents
  const tocAtoms = [{ t: 'toc-title' }];
  const byCategory = new Map();
  for (const r of recipes) {
    const cat = r.category || 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(r);
  }
  const cats = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];
  for (const cat of cats) {
    tocAtoms.push({ t: 'toc-cat', text: CATEGORY_LABELS[cat] || cat });
    for (const r of byCategory.get(cat)) {
      tocAtoms.push({
        t: 'toc-item',
        html: `<a href="#${esc(r.id)}" data-recipe-link="${esc(r.id)}">${esc(r.title)}</a>`,
      });
    }
  }
  const tocPages = paginate(tocAtoms, measurer, () => ({ t: 'cont', title: '', text: 'Contents' }));
  tocPages.forEach((atoms) => pages.push({ html: renderAtoms(atoms), role: 'toc' }));
  // recipes must start on a left-hand page (odd index) in two-page mode
  if (landscape && tocPages.length % 2 === 1) pages.push({ ...filler(), role: 'toc' });

  // ---- recipes
  for (const recipe of recipes) {
    starts[recipe.id] = pages.length;
    const { left, right } = recipeAtoms(recipe);
    const makeLeftCont = () => ({ t: 'cont', title: recipe.title, text: 'Ingredients' });
    const makeRightCont = () => ({ t: 'cont', title: recipe.title, text: 'Method' });
    const leftPages = paginate(left, measurer, makeLeftCont);
    const rightPages = paginate(right, measurer, makeRightCont);
    const asPage = (atoms) => ({ html: renderAtoms(atoms), role: 'recipe', recipeId: recipe.id });

    if (landscape) {
      const n = Math.max(leftPages.length, rightPages.length);
      for (let i = 0; i < n; i++) {
        pages.push(leftPages[i] ? asPage(leftPages[i]) : filler(recipe.id));
        pages.push(rightPages[i] ? asPage(rightPages[i]) : filler(recipe.id));
      }
    } else {
      leftPages.forEach((p) => pages.push(asPage(p)));
      rightPages.forEach((p) => pages.push(asPage(p)));
    }
  }

  // ---- back cover (alone on the left when the book is closed)
  if (landscape && (pages.length + 1) % 2 === 1) pages.push(filler());
  pages.push({ html: backCoverHtml(), raw: true, hard: true, role: 'back' });

  measurer.destroy();
  return { pages, starts };
}

function createPageEl(p) {
  const div = document.createElement('div');
  div.className = 'page';
  if (p.hard) div.dataset.density = 'hard';
  div.innerHTML = p.raw
    ? p.html
    : `<div class="recipe-page rp"><div class="rp-body">${p.html}</div></div>`;
  return div;
}

/* -------------------------------------------------------------------------
   Mounting the book
   ------------------------------------------------------------------------- */

function applyShift(spread, animate) {
  const { layout, spreadCount } = state;
  let dir = 0;
  if (layout.mode === 'landscape') {
    if (spread === 0) dir = -1; // closed book: cover sits in the middle of the screen
    else if (spread === spreadCount - 1) dir = 1; // back cover
  }
  slider.classList.toggle('no-anim', !animate);
  slider.style.transform = dir ? `translateX(${(dir * layout.pw) / 2}px)` : '';
  if (!animate) {
    void slider.offsetWidth;
    slider.classList.remove('no-anim');
  }
}

function updateButtons(spread) {
  prevBtn.disabled = spread <= 0;
  nextBtn.disabled = spread >= state.spreadCount - 1;
}

function currentSpread() {
  return state.pageFlip.getPageCollection().getCurrentSpreadIndex();
}

function onFlipped(pageIndex) {
  const meta = state.metas[pageIndex] || {};
  const key = meta.recipeId || meta.role || 'cover';
  state.currentKey = key;
  try {
    const url = key === 'cover' ? location.pathname + location.search : '#' + key;
    history.replaceState(null, '', url);
  } catch (e) {
    /* history not available (e.g. sandboxed) */
  }
  const spread = currentSpread();
  applyShift(spread, true);
  updateButtons(spread);
  hintEl.classList.remove('show');
}

function startIndexFor(key) {
  if (key === 'back') return state.metas.length - 1;
  if (key === 'toc') return 1;
  if (state.starts[key] !== undefined) return state.starts[key];
  return 0;
}

function mount(startKey, { firstTime = false } = {}) {
  if (state.pageFlip) {
    try {
      state.pageFlip.destroy();
    } catch (e) {
      /* already gone */
    }
    state.pageFlip = null;
  }
  slider.replaceChildren();

  const layout = computeLayout();
  state.layout = layout;

  const { pages, starts } = buildBook(layout, state.recipes);
  state.metas = pages.map((p) => ({ role: p.role, recipeId: p.recipeId }));
  state.starts = starts;
  state.spreadCount = layout.mode === 'landscape' ? pages.length / 2 + 1 : pages.length;

  const bookEl = document.createElement('div');
  bookEl.id = 'book';
  bookEl.style.width = (layout.mode === 'landscape' ? layout.pw * 2 : layout.pw) + 'px';
  bookEl.style.height = layout.ph + 'px';
  bookEl.style.setProperty('--pw', layout.pw + 'px');
  bookEl.style.setProperty('--ph', layout.ph + 'px');
  if (!firstTime) bookEl.style.transition = 'none';
  slider.appendChild(bookEl);
  state.bookEl = bookEl;

  const pageEls = pages.map(createPageEl);
  pageEls.forEach((el) => bookEl.appendChild(el));

  const startIndex = startIndexFor(startKey);
  const pageFlip = new St.PageFlip(bookEl, {
    width: layout.pw,
    height: layout.ph,
    size: 'fixed',
    autoSize: false,
    showCover: true,
    usePortrait: true,
    startPage: startIndex,
    flippingTime: 850,
    maxShadowOpacity: 0.22,
    mobileScrollSupport: true,
    swipeDistance: 25,
    showPageCorners: !isTouch,
    startZIndex: 5,
  });
  pageFlip.loadFromHTML(pageEls);
  state.pageFlip = pageFlip;

  pageFlip.on('flip', (e) => onFlipped(e.data));
  pageFlip.on('changeState', (e) => {
    if (e.data === 'flipping') {
      // start sliding the book toward its next resting place as the page turns
      const calc = pageFlip.getFlipController().getCalculation();
      if (!calc) return;
      const forward = calc.getDirection() === 0;
      applyShift(currentSpread() + (forward ? 1 : -1), true);
    } else if (e.data === 'read') {
      applyShift(currentSpread(), true);
    }
  });

  const spread = currentSpread();
  applyShift(spread, false);
  updateButtons(spread);
  state.currentKey = startKey;

  if (layout.sideways && isTouch) {
    hintEl.textContent = 'Turn your phone upright for the best view';
    hintEl.classList.add('show');
    setTimeout(() => hintEl.classList.remove('show'), 5000);
  }

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bookEl.classList.add('ready');
      loadingEl.classList.add('done');
    })
  );
}

/* -------------------------------------------------------------------------
   Navigation
   ------------------------------------------------------------------------- */

function goToIndex(index) {
  if (state.pageFlip) state.pageFlip.flip(index);
}

function wireControls() {
  prevBtn.addEventListener('click', () => state.pageFlip && state.pageFlip.flipPrev());
  nextBtn.addEventListener('click', () => state.pageFlip && state.pageFlip.flipNext());
  tocBtn.addEventListener('click', () => goToIndex(1));

  document.addEventListener('keydown', (e) => {
    if (!state.pageFlip) return;
    if (e.key === 'ArrowLeft') state.pageFlip.flipPrev();
    if (e.key === 'ArrowRight') state.pageFlip.flipNext();
  });

  // Contents links (capture phase so StPageFlip never reads them as a page-turn)
  document.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest && e.target.closest('[data-recipe-link]');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const index = state.starts[link.dataset.recipeLink];
      if (index !== undefined) goToIndex(index);
    },
    true
  );

  // Phones. The book ignores gestures that begin on a link (and Contents pages
  // are almost all links), and the browser's synthetic "click" after a tap makes
  // the book turn a page on any tap. So on touch screens we handle it ourselves:
  //   swipe anywhere  -> turn the page
  //   tap outer edge  -> turn the page
  //   tap elsewhere   -> nothing (links and buttons still work)
  if (isTouch) {
    let t = null;
    stage.addEventListener(
      'touchstart',
      (e) => {
        const p = e.changedTouches[0];
        t = { x: p.clientX, y: p.clientY, time: Date.now(), onLink: !!e.target.closest('a, button') };
      },
      { passive: true }
    );
    stage.addEventListener(
      'touchend',
      (e) => {
        const start = t;
        t = null;
        if (!start || !state.pageFlip) return;
        const p = e.changedTouches[0];
        const dx = p.clientX - start.x;
        const dy = p.clientY - start.y;
        const elapsed = Date.now() - start.time;

        const swiped = Math.abs(dx) > 40 && Math.abs(dy) < Math.abs(dx) * 0.6 && elapsed < 700;
        if (swiped) {
          // Gestures starting on a link are ours; elsewhere the book already handled the swipe.
          if (start.onLink) (dx < 0 ? state.pageFlip.flipNext() : state.pageFlip.flipPrev());
          return;
        }

        const isTap = Math.hypot(dx, dy) < 10 && elapsed < 400;
        if (!isTap || start.onLink) return;
        if (e.cancelable) e.preventDefault(); // no synthetic click -> no accidental extra turn
        if (state.layout.mode !== 'portrait') return;
        const rect = state.bookEl.getBoundingClientRect();
        const rel = (p.clientX - rect.left) / rect.width;
        if (rel < 0.22) state.pageFlip.flipPrev();
        else if (rel > 0.78) state.pageFlip.flipNext();
      },
      { passive: false }
    );
  }

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!sameLayout(computeLayout(), state.layout)) mount(state.currentKey);
    }, 220);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

/* -------------------------------------------------------------------------
   Start-up
   ------------------------------------------------------------------------- */

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function preload() {
  const recipes = fetch('recipes.json').then((r) => r.json());
  const fonts = withTimeout(
    Promise.all([
      document.fonts.load('400 16px Lora'),
      document.fonts.load('600 16px Lora'),
      document.fonts.load('italic 400 16px Lora'),
      document.fonts.load('40px "Homemade Apple"'),
    ]).catch(() => {}),
    3500
  );
  const photo = new Image();
  photo.src = COVER_PHOTO;
  const photoReady = withTimeout(photo.decode().catch(() => {}), 3500);
  const [data] = await Promise.all([recipes, fonts, photoReady]);
  return data;
}

async function init() {
  wireControls();
  try {
    const recipes = await preload();
    // Pages follow the same order as the Contents: by category, then as listed in recipes.json
    const rank = (r) => {
      const i = CATEGORY_ORDER.indexOf(r.category);
      return i === -1 ? CATEGORY_ORDER.length : i;
    };
    state.recipes = recipes
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .map((x) => x.r);
  } catch (e) {
    loadingEl.textContent = 'Sorry, the recipes could not be loaded.';
    return;
  }

  const hash = decodeURIComponent(location.hash.replace('#', ''));
  const known = new Set(state.recipes.map((r) => r.id));
  const startKey = known.has(hash) ? hash : hash === 'toc' ? 'toc' : 'cover';
  mount(startKey, { firstTime: true });

  // If a web font arrives late the text metrics change, so lay the pages out again.
  let relayouts = 0;
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => {
      if (relayouts++ < 2) mount(state.currentKey);
    });
  }

  if (isTouch && startKey === 'cover') {
    let seen = false;
    try {
      seen = localStorage.getItem('hintSeen') === '1';
      localStorage.setItem('hintSeen', '1');
    } catch (e) {
      /* private mode */
    }
    if (!seen) {
      setTimeout(() => hintEl.classList.add('show'), 1400);
      setTimeout(() => hintEl.classList.remove('show'), 6000);
    }
  }
}

init();
