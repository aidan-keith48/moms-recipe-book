'use strict';

/* ==========================================================================
   Mom's Recipe Book — flipbook
   1. load recipes.json + fonts + cover photo
   2. work out how big one page can be on this screen
   3. ask book-core.js to flow every recipe into pages that fit
   4. hand the pages to StPageFlip
   The book is rebuilt if the screen changes size (rotating a phone, etc).
   ========================================================================== */

const PAGE_RATIO = 0.72; // page width / page height on desktop spreads

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
    state.recipes = sortRecipes(recipes);
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
