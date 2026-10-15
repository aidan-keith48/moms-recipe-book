'use strict';

/* ==========================================================================
   Mom's Recipe Book — shared core
   Builds the page content (cover, contents, each recipe's pages) from
   recipes.json, flowing text so nothing is ever cut off. Used by both the
   interactive flipbook (book.js) and the printable version (print.js), so a
   layout fix here fixes both.
   ========================================================================== */

const COVER_PHOTO = 'assets/img/cover-photo.jpg';

const CATEGORY_LABELS = {
  baking: 'Baking',
  mains: 'Mains',
  snacks: 'Snacks & Drinks',
  reference: 'Reference',
};
const CATEGORY_ORDER = ['baking', 'mains', 'snacks', 'reference'];

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

// Pages follow the same order as the Contents: by category, then as listed in recipes.json
function sortRecipes(recipes) {
  const rank = (r) => {
    const i = CATEGORY_ORDER.indexOf(r.category);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return recipes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
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
   Covers
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
    <a class="cover-print-link" href="print.html" target="_blank" rel="noopener">Printable version (PDF) →</a>
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

/* -------------------------------------------------------------------------
   Assemble the whole book
   layout: { mode: 'landscape' | 'portrait', pw, ph }. 'landscape' pairs pages
   into left/right spreads (with filler pages to keep each recipe's spread
   aligned); 'portrait' is a plain sequential run of single pages — exactly
   what the printable version wants too.
   ------------------------------------------------------------------------- */

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
  if (p.role) div.dataset.role = p.role;
  if (p.recipeId) div.dataset.recipe = p.recipeId;
  div.innerHTML = p.raw
    ? p.html
    : `<div class="recipe-page rp"><div class="rp-body">${p.html}</div></div>`;
  return div;
}
