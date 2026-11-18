'use strict';
// A deliberately ephemeral demonstration. No accounts, storage, or API requests.
const saved = new Set();
const count = document.querySelector('#stash-count');
const items = document.querySelector('#stash-items');
const empty = document.querySelector('#stash-empty');
const summary = document.querySelector('#stash-summary');
const status = document.querySelector('#stash-status');
const reset = document.querySelector('#reset-stash');
const discoveries = new Map([...document.querySelectorAll('[data-save]')].map(button => {
  const card = button.closest('.discovery');
  return [button.dataset.save, {button, card, label: card.querySelector('.image-tag').textContent}];
}));
const shelfCards = new Map();
let cancelFindDemo = () => {};

function createStashCard(name) {
  const source = discoveries.get(name).card;
  const item = document.createElement('li');
  item.className = 'stash-tile';
  item.title = name;
  const media = document.createElement('div');
  media.className = 'stash-tile-media';
  const image = source.querySelector('img').cloneNode();
  image.alt = '';
  image.sizes = '(max-width: 760px) 20vw, 100px';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.remove = name;
  remove.className = 'stash-remove';
  remove.setAttribute('aria-label', `Remove ${name} from preview Stash`);
  remove.textContent = '×';
  media.append(image, remove);
  const details = document.createElement('div');
  details.className = 'stash-tile-details';
  const kind = document.createElement('span');
  kind.textContent = source.dataset.kind === 'place' ? 'PLACE / SAVED FOR SOMEDAY' : 'PRODUCT / SAVED FOR LATER';
  const title = document.createElement('h4');
  title.textContent = name;
  details.append(kind, title);
  item.append(media, details);
  return item;
}
function updateStash(message) {
  count.textContent = String(saved.size);
  empty.hidden = saved.size > 0;
  items.hidden = saved.size === 0;
  reset.hidden = saved.size === 0;
  summary.textContent = saved.size ? `${saved.size} good ${saved.size === 1 ? 'find' : 'finds'}, kept close.` : 'Products, places, and a few possibilities.';
  discoveries.forEach(({button, card, label}, name) => {
    const active = saved.has(name);
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? '×' : '+';
    button.setAttribute('aria-label', `${active ? 'Remove' : 'Stash'} ${name}${active ? ' from preview Stash' : ''}`);
    card.classList.toggle('is-saved', active);
    card.querySelector('.image-tag').textContent = active ? 'SAVED TO YOUR STASH' : label;
  });
  shelfCards.forEach((tile, name) => {
    if (!saved.has(name)) { tile.remove(); shelfCards.delete(name); }
  });
  saved.forEach(name => {
    if (!shelfCards.has(name)) {
      const tile = createStashCard(name);
      shelfCards.set(name, tile);
      items.append(tile);
    }
  });
  if (document.querySelector('.find-demo')?.dataset.phase === 'complete') {
    document.querySelectorAll('[data-extracted-name]').forEach(card => {
      card.querySelector('.extraction-card-state').textContent = saved.has(card.dataset.extractedName) ? 'Saved to Stash' : 'Removed';
    });
  }
  status.textContent = message;
}
discoveries.forEach(({button}, name) => {
  button.addEventListener('click', () => {
    if (saved.has(name)) saved.delete(name); else saved.add(name);
    updateStash(`${name} ${saved.has(name) ? 'added to' : 'removed from'} your preview Stash. ${saved.size} saved.`);
  });
});
function focusVisibleSave(preferredName) {
  const visible = card => !card.closest('[hidden]');
  const preferred = discoveries.get(preferredName);
  const target = preferred && visible(preferred.card) ? preferred.button : [...discoveries.values()].find(({card}) => visible(card))?.button;
  (target || document.querySelector('#find-demo-run'))?.focus({preventScroll: true});
}
items.addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const buttons = [...items.querySelectorAll('[data-remove]')];
  const index = buttons.indexOf(button);
  const name = button.dataset.remove;
  saved.delete(name);
  updateStash(`${name} removed from your preview Stash. ${saved.size} saved.`);
  const remaining = items.querySelectorAll('[data-remove]');
  if (remaining.length) remaining[Math.min(index, remaining.length - 1)].focus({preventScroll: true});
  else focusVisibleSave(name);
});
reset.addEventListener('click', () => {
  cancelFindDemo();
  saved.clear();
  updateStash('Preview Stash cleared.');
  focusVisibleSave();
});
function setupFindDemo() {
  const root = document.querySelector('.find-demo');
  const tabs = [...root.querySelectorAll('[data-find-mode]')];
  const panel = document.querySelector('#find-demo-panel');
  const run = document.querySelector('#find-demo-run');
  const cancel = document.querySelector('#find-demo-cancel');
  const viewStash = document.querySelector('#find-demo-view-stash');
  const extractionOutput = root.querySelector('.extraction-output');
  const progressTrack = root.querySelector('.find-progress-track');
  const feedback = document.querySelector('#find-demo-status');
  const visual = root.querySelector('.find-demo-visual');
  const image = document.querySelector('#find-source-image');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Prepared local examples, deliberately not a live extraction service.
  const examples = {
    url: {
      title: 'A video worth coming back to.',
      description: 'A room tour, a coffee stop. One sample video, a couple of good finds.',
      source: 'SAMPLE VIDEO / A SLOW WEEKEND', image: 'interior',
      alt: 'Sample room-tour frame with a reading chair; coffee appears in another sample frame',
      caption: 'From a shared video to products and places worth keeping.',
      action: 'Find in sample link', names: ['The reading chair', 'The coffee stop'],
    },
    gallery: {
      title: 'That screenshot you kept.',
      description: 'A little travel inspiration: somewhere to escape, and a camera to take along.',
      source: 'SAMPLE SCREENSHOT / THE SOMEDAY EDIT', image: 'coast',
      alt: 'Illustrative travel inspiration board with a sunlit villa and a camera photo',
      caption: 'From an image in your gallery to your next little discovery.',
      action: 'Find in sample screenshot', names: ['A sunlit hideaway', 'The everyday camera'],
    },
    camera: {
      title: 'Right there. Worth remembering.',
      description: 'Imagine spotting a beautiful chair. Start a Find from a photo of the moment.',
      source: 'SAMPLE CAMERA FRAME / A QUIET CORNER', image: 'interior',
      alt: 'Sample camera view of a room with a reading chair',
      caption: 'From a camera photo to a product you can come back to.',
      action: 'Find in sample photo', names: ['The reading chair'],
    },
  };
  let mode = 'url';
  let busy = false;
  let generation = 0;
  let timers = [];
  let flights = [];
  function clearFlights() {
    flights.forEach(({animation, node}) => { animation.cancel(); node.remove(); });
    flights = [];
  }
  function clearTimers() { timers.forEach(window.clearTimeout); timers = []; clearFlights(); }
  function runLabel(label) { run.childNodes[0].textContent = `${label} `; }
  function phase(name, message) {
    const percent = {idle: 0, reading: 12, identifying: 56, saving: 86, complete: 100}[name];
    const labels = {idle: 'A little curiosity goes a long way.', reading: 'Looking a little closer…', identifying: 'Good finds, coming into focus…', saving: 'Tucking them into your Stash…', complete: 'Found. Stashed. All yours.'};
    root.dataset.phase = name;
    root.style.setProperty('--find-progress', percent / 100);
    visual.setAttribute('aria-busy', String(name !== 'idle' && name !== 'complete'));
    progressTrack.setAttribute('aria-valuenow', String(percent));
    progressTrack.setAttribute('aria-valuetext', `${labels[name]} ${percent}%`);
    document.querySelector('#find-progress-label').textContent = labels[name];
    document.querySelector('#find-progress-value').textContent = `${percent}%`;
    extractionOutput.querySelectorAll('.extraction-card-state').forEach(label => {
      label.textContent = name === 'complete' ? 'Saved to Stash' : name === 'saving' ? 'Stashing…' : 'Identified';
    });
    feedback.textContent = message;
  }
  function prepareExtractionCards(names) {
    extractionOutput.replaceChildren();
    names.forEach((name, index) => {
      const source = discoveries.get(name).card;
      const card = document.createElement('div');
      card.className = 'extraction-card';
      card.dataset.extractedName = name;
      card.style.setProperty('--extract-order', index);
      const photo = source.querySelector('img').cloneNode();
      photo.alt = '';
      photo.sizes = '65px';
      const details = document.createElement('div');
      const kind = document.createElement('span');
      kind.className = 'extraction-kind';
      kind.textContent = source.dataset.kind === 'place' ? 'PLACE' : 'PRODUCT';
      const title = document.createElement('strong');
      title.textContent = name;
      const state = document.createElement('span');
      state.className = 'extraction-card-state';
      state.textContent = 'Identified';
      details.append(kind, title, state);
      card.append(photo, details);
      extractionOutput.append(card);
    });
  }
  function sendCardsToStash() {
    if (reducedMotion.matches) return;
    const target = document.querySelector('.stash-folio').getBoundingClientRect();
    const cards = [...extractionOutput.children];
    cards.forEach((card, index) => {
      const from = card.getBoundingClientRect();
      if (from.bottom < 0 || from.top > window.innerHeight) return;
      const node = card.cloneNode(true);
      node.classList.add('find-flying-card');
      node.removeAttribute('data-extracted-name');
      node.setAttribute('aria-hidden', 'true');
      Object.assign(node.style, {left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`});
      document.body.append(node);
      const x = target.left + target.width * (index + 1) / (cards.length + 1) - from.left - from.width / 2;
      const y = Math.min(window.innerHeight + 90, target.top + target.height / 2) - from.top - from.height / 2;
      const animation = node.animate([
        {transform: 'translate(0, 0) scale(1)', opacity: .8},
        {transform: `translate(${x * .2}px, -12px) scale(.8)`, opacity: .7, offset: .28},
        {transform: `translate(${x}px, ${y}px) scale(.2)`, opacity: 0},
      ], {duration: 680, delay: index * 80, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards'});
      flights.push({animation, node});
      animation.finished.then(() => node.remove(), () => node.remove());
    });
  }
  function choose(nextMode) {
    generation++;
    clearTimers();
    busy = false;
    mode = nextMode;
    const example = examples[mode];
    root.dataset.mode = mode;
    tabs.forEach(tab => {
      const selected = tab.dataset.findMode === mode;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `find-tab-${mode}`);
    document.querySelector('#find-sample-title').textContent = example.title;
    document.querySelector('#find-sample-description').textContent = example.description;
    document.querySelector('#find-source-label').textContent = example.source;
    document.querySelector('#find-scene-caption').textContent = example.caption;
    document.querySelector('#find-url-field').hidden = mode !== 'url';
    root.querySelector('.find-gallery-detail').hidden = mode !== 'gallery';
    image.src = `/home/media/${example.image}.jpg`;
    image.alt = example.alt;
    run.disabled = false;
    runLabel(example.action);
    cancel.hidden = true;
    viewStash.hidden = true;
    prepareExtractionCards(example.names);
    phase('idle', 'Prepared example selected. Start a Find to see how it works.');
  }
  function finish(id) {
    if (id !== generation || !busy) return;
    clearTimers();
    busy = false;
    const example = examples[mode];
    const names = example.names;
    names.forEach(name => saved.add(name));
    run.disabled = false;
    runLabel('Run this example again');
    cancel.hidden = true;
    viewStash.hidden = false;
    const label = `${names.length} demo ${names.length === 1 ? 'discovery' : 'discoveries'}`;
    updateStash('');
    phase('complete', `${label} found and saved. Remove any you don’t want, or try another way to Find.`);
  }
  run.addEventListener('click', () => {
    if (busy) return;
    const id = ++generation;
    clearTimers();
    busy = true;
    run.disabled = true;
    runLabel('Finding…');
    cancel.hidden = false;
    viewStash.hidden = true;
    phase('reading', 'Demo: reading the example’s visual context…');
    if (reducedMotion.matches) { finish(id); return; }
    const later = (delay, action) => timers.push(window.setTimeout(() => { if (id === generation) action(); }, delay));
    later(850, () => phase('identifying', 'Demo: products and places are coming into focus…'));
    later(1850, () => { phase('saving', 'Demo: saving your discoveries to the preview Stash…'); sendCardsToStash(); });
    later(2700, () => finish(id));
  });
  function cancelRun() {
    if (!busy) return;
    choose(mode);
    feedback.textContent = 'Demo cancelled. No new discoveries were saved.';
    run.focus({preventScroll: true});
  }
  cancel.addEventListener('click', cancelRun);
  cancelFindDemo = cancelRun;
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => choose(tab.dataset.findMode));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      choose(tabs[next].dataset.findMode);
      tabs[next].focus();
    });
  });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches && busy) finish(generation); });
  choose('url');
  updateStash('');
}
setupFindDemo();

document.querySelector('#year').textContent = String(new Date().getFullYear());

// Experiment switch: false restores the original postcard board. Compare the
// unchanged composition with ?postcards=static; no account/demo saves are affected.
const ENABLE_SCROLL_STASH_EXPERIMENT = true;
function setupScrollStash() {
  const board = document.querySelector('.discovery-canvas');
  const stage = document.querySelector('.postcard-stage');
  const cards = [...board.querySelectorAll('.canvas-card')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = ENABLE_SCROLL_STASH_EXPERIMENT && new URLSearchParams(window.location.search).get('postcards') !== 'static';
  if (!enabled) return;
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  const initialAngles = [-8, 5, 8, -7];
  const finalAngles = [-9, -3, 7, 2];
  let geometry = [];
  let top = 0;
  let distance = 0;
  let frame = 0;
  let visible = true;

  function clear() {
    document.documentElement.classList.remove('scroll-stash-enabled');
    board.classList.remove('is-gathering');
    board.style.removeProperty('--pocket-opacity');
    board.style.removeProperty('--board-note-opacity');
    board.style.removeProperty('--gather-copy-opacity');
    cards.forEach(card => card.style.removeProperty('transform'));
  }
  function render() {
    frame = 0;
    if (reducedMotion.matches || !visible) return;
    const progress = clamp((top - stage.getBoundingClientRect().top) / distance);
    board.classList.toggle('is-gathering', progress > 0);
    board.style.setProperty('--pocket-opacity', smooth(clamp((progress - .08) / .45)));
    board.style.setProperty('--board-note-opacity', 1 - clamp(progress * 3));
    // The closing line arrives only as the cards finish settling; reversing
    // the scroll immediately fades it away as the postcards open back out.
    board.style.setProperty('--gather-copy-opacity', smooth(clamp((progress - .84) / .16)));
    cards.forEach((card, index) => {
      if (progress === 0) {
        card.style.removeProperty('transform');
        return;
      }
      // Slightly stagger the four paths, then settle into a fan behind the pocket.
      const p = smooth(clamp((progress - index * .035) / (1 - index * .035)));
      const {x, y, scale} = geometry[index];
      const angle = initialAngles[index] + (finalAngles[index] - initialAngles[index]) * p;
      card.style.transform = `translate(${x * p}px, ${y * p}px) rotate(${angle}deg) scale(${1 + (scale - 1) * p})`;
    });
  }
  function schedule() {
    if (!frame && visible && !reducedMotion.matches) frame = window.requestAnimationFrame(render);
  }
  function measure() {
    if (reducedMotion.matches) { clear(); return; }
    document.documentElement.classList.add('scroll-stash-enabled');
    const height = board.offsetHeight;
    // Short viewports still get a fully visible board and an ordinary scroll exit.
    top = Math.max(12, Math.min(160, (window.innerHeight - height) / 2));
    distance = window.innerWidth <= 760 ? 180 : 260;
    stage.style.setProperty('--board-height', `${height}px`);
    stage.style.setProperty('--gather-distance', `${distance}px`);
    stage.style.setProperty('--board-top', `${top}px`);
    const targetWidth = window.innerWidth <= 760 ? 130 : 165;
    geometry = cards.map((card, index) => ({
      x: board.clientWidth / 2 + (index - 1.5) * 9 - (card.offsetLeft + card.offsetWidth / 2),
      y: height * .5 + 10 + index * 4 - (card.offsetTop + card.offsetHeight / 2),
      scale: Math.min(1, targetWidth / card.offsetWidth),
    }));
    schedule();
  }
  // All scroll writes are batched into one frame, and stop outside the hero.
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) schedule();
  });
  observer.observe(stage);
  window.addEventListener('scroll', schedule, {passive: true});
  window.addEventListener('resize', measure, {passive: true});
  reducedMotion.addEventListener('change', measure);
  measure();
}
setupScrollStash();
