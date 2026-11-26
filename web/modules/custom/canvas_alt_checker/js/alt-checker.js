/**
 * @file
 * Image Alt Checker: a Drupal Canvas extension.
 *
 * Reads the live preview HTML from Canvas, finds every <img> and reports the
 * ones whose alt text is missing, empty or unhelpful, grouped by the Canvas
 * component instance they belong to.
 *
 * Talks to Canvas with the same postMessage protocol that the
 * @drupal-canvas/extensions npm package wraps, so no build step is needed.
 * The extension is served from this module (same origin as Drupal), which is
 * why messages are posted with window.location.origin as the target origin.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas protocol.
  // ---------------------------------------------------------------------------

  const ORIGIN = window.location.origin;

  function post(type) {
    window.parent.postMessage({ type: type }, ORIGIN);
  }

  /**
   * Subscribes to a Canvas data type; resolves once the first value arrives.
   *
   * Canvas sends the current value as soon as a subscription is registered,
   * then again whenever it changes.
   */
  function subscribe(dataType, callback) {
    const messageType = 'canvas:data:subscribe:' + dataType;
    return new Promise(function (resolve) {
      let first = true;
      window.addEventListener('message', function (event) {
        if (event.origin !== ORIGIN || !event.data || event.data.type !== messageType) {
          return;
        }
        callback(event.data.payload);
        if (first) {
          first = false;
          resolve();
        }
      });
      post(messageType);
    });
  }

  // ---------------------------------------------------------------------------
  // Analysis.
  // ---------------------------------------------------------------------------

  const START = /^\s*canvas-start-([0-9a-f-]+)\s*$/i;
  const END = /^\s*canvas-end-([0-9a-f-]+)\s*$/i;
  const FILENAME = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i;
  const GENERIC = new Set([
    'image', 'img', 'photo', 'picture', 'pic', 'graphic', 'banner',
    'placeholder', 'placeholder image', 'untitled', 'alt', 'alt text',
  ]);
  const MAX_ALT_LENGTH = 150;

  /**
   * Checks one image: does it have alt text, and is that text useful?
   *
   * An image counts as "present" when it has non-empty alt text, or when it
   * is explicitly decorative (alt="" plus role="presentation"/aria-hidden).
   * Everything else is "missing".
   *
   * @return {{status: 'present'|'missing', alt: string|null, note: string|null}}
   *   alt is the alt text (null when the attribute is absent); note is an
   *   optional quality hint.
   */
  function check(img) {
    const decorative =
      img.getAttribute('role') === 'presentation' ||
      img.getAttribute('role') === 'none' ||
      img.getAttribute('aria-hidden') === 'true';

    if (!img.hasAttribute('alt')) {
      return {
        status: 'missing',
        alt: null,
        note: decorative ? 'Marked decorative: add alt="" to make that explicit.' : null,
      };
    }

    const alt = img.getAttribute('alt').trim();
    if (alt === '') {
      return decorative
        ? { status: 'present', alt: '', note: 'Decorative image (empty alt on purpose).' }
        : { status: 'missing', alt: '', note: 'Alt is empty. Add a description, or mark the image decorative.' };
    }

    let note = null;
    if (GENERIC.has(alt.toLowerCase())) {
      note = 'Too generic: describe what the image shows.';
    }
    else if (FILENAME.test(alt)) {
      note = 'Looks like a file name, not a description.';
    }
    else if (alt.length > MAX_ALT_LENGTH) {
      note = alt.length + ' characters: keep it under ' + MAX_ALT_LENGTH + '.';
    }
    return { status: 'present', alt: alt, note: note };
  }

  /**
   * Finds all images and the innermost Canvas component each one sits in.
   *
   * Canvas wraps every component instance in
   * <!-- canvas-start-{uuid} --> … <!-- canvas-end-{uuid} -->.
   */
  function analyze(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const walker = doc.createTreeWalker(
      doc.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
    );
    const stack = [];
    const hints = {};
    let awaitingHint = null;
    const results = [];

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.COMMENT_NODE) {
        let m = START.exec(node.data);
        if (m) {
          stack.push(m[1]);
          awaitingHint = m[1];
          continue;
        }
        m = END.exec(node.data);
        if (m) {
          const i = stack.lastIndexOf(m[1]);
          if (i !== -1) stack.length = i;
        }
        continue;
      }

      // The first element after a start marker is the component's root; its
      // first class (e.g. "sp-card") is a readable hint for which component.
      if (awaitingHint) {
        hints[awaitingHint] = node.classList[0] || node.tagName.toLowerCase();
        awaitingHint = null;
      }

      if (node.tagName === 'IMG') {
        const uuid = stack.length ? stack[stack.length - 1] : null;
        results.push(Object.assign(
          { src: node.getAttribute('src') || '', uuid: uuid },
          check(node),
        ));
      }
    }

    results.forEach(function (r) {
      r.hint = r.uuid ? hints[r.uuid] : null;
    });
    return results;
  }

  // ---------------------------------------------------------------------------
  // Rendering. Values from the preview are only ever set via textContent or
  // validated URLs, never innerHTML.
  // ---------------------------------------------------------------------------

  const listEl = document.getElementById('ac-list');
  const summaryEl = document.getElementById('ac-summary');
  const filterEls = document.querySelectorAll('.ac-filter');

  let results = [];
  let selectedUuid;
  let filter = 'all';

  // ---------------------------------------------------------------------------
  // Editing alt text. The Canvas extension API is read-only, so alt text is
  // saved through this module's own endpoints, which update the Media item
  // (or other image field) that stores the image. The Drupal session cookie
  // authenticates the request; a CSRF token protects it.
  // ---------------------------------------------------------------------------

  // Drupal base path, e.g. "/" or "/subdir/", derived from this file's URL.
  const BASE = window.location.pathname.slice(0, window.location.pathname.indexOf('/modules/') + 1);
  const MAX_ALT = 512;

  // src -> {editable, alt, required, count, reason} | 'loading'.
  const info = {};
  // src -> alt saved here that the preview does not show yet.
  const saved = {};
  // Inline editor state; keyed by src, so it survives re-renders.
  let editing = null;
  let draft = '';
  let editError = '';
  let busy = false;
  let tokenPromise = null;

  function csrfToken() {
    tokenPromise = tokenPromise || fetch(BASE + 'session/token', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('Token request failed');
        return res.text();
      })
      .catch(function (e) {
        tokenPromise = null;
        throw e;
      });
    return tokenPromise;
  }

  function postJson(path, data) {
    return csrfToken().then(function (token) {
      return fetch(BASE + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(data),
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.message || 'Request failed (' + res.status + ').');
        return body;
      });
    });
  }

  /** Asks the server, once per src, whether and where its alt can be edited. */
  function lookupMissing() {
    const srcs = results
      .map(function (r) { return r.src; })
      .filter(function (src, i, all) { return src && !info[src] && all.indexOf(src) === i; });
    if (!srcs.length) return;
    srcs.forEach(function (src) { info[src] = 'loading'; });
    postJson('canvas-alt-checker/lookup', { srcs: srcs })
      .then(function (body) {
        srcs.forEach(function (src) {
          info[src] = (body.images && body.images[src]) ||
            { editable: false, reason: 'Could not check this image.' };
        });
      })
      .catch(function () {
        srcs.forEach(function (src) {
          info[src] = { editable: false, reason: 'Editing is not available (you may lack permission).' };
        });
      })
      .then(render);
  }

  /** Shows alt text saved here even before the preview re-renders. */
  function applySaved() {
    results.forEach(function (r) {
      if (!(r.src in saved)) return;
      if ((r.alt || '') === saved[r.src]) {
        // The preview has caught up.
        delete saved[r.src];
        return;
      }
      const probe = document.createElement('img');
      probe.setAttribute('alt', saved[r.src]);
      Object.assign(r, check(probe), { pending: true });
    });
  }

  function startEdit(src) {
    editing = src;
    const i = info[src];
    draft = src in saved ? saved[src] : (i && typeof i.alt === 'string' ? i.alt : '');
    editError = '';
    render();
  }

  function cancelEdit() {
    editing = null;
    editError = '';
    render();
  }

  function saveEdit() {
    if (busy || !editing) return;
    const src = editing;
    const value = draft.trim();
    const i = info[src];
    if (value === '' && i && i.required) {
      editError = 'Alt text is required for this image.';
      render();
      return;
    }
    busy = true;
    editError = '';
    render();
    postJson('canvas-alt-checker/save', { src: src, alt: value })
      .then(function (body) {
        saved[src] = body.alt;
        if (i && typeof i === 'object') i.alt = body.alt;
        editing = null;
        applySaved();
      })
      .catch(function (e) {
        editError = e.message;
      })
      .then(function () {
        busy = false;
        render();
      });
  }

  function renderActions(r, body) {
    const i = info[r.src];
    if (!i || i === 'loading') {
      body.appendChild(el('p', 'ac-meta', 'Checking whether alt can be edited…'));
      return;
    }
    if (!i.editable) {
      body.appendChild(el('p', 'ac-meta ac-reason', 'Can’t edit here: ' + i.reason));
      return;
    }

    if (editing !== r.src) {
      const button = el('button', 'ac-button', r.status === 'missing' ? 'Add alt text' : 'Edit alt text');
      button.type = 'button';
      button.addEventListener('click', function () { startEdit(r.src); });
      body.appendChild(button);
      return;
    }

    const form = el('form', 'ac-form');
    const id = 'ac-input-' + Math.abs(hash(r.src));
    const label = el('label', 'ac-label', 'Alt text');
    label.htmlFor = id;
    const input = el('textarea', 'ac-input');
    input.id = id;
    input.rows = 2;
    input.maxLength = MAX_ALT;
    input.value = draft;
    input.placeholder = 'Describe what the image shows';
    input.disabled = busy;
    const counter = el('span', 'ac-counter', draft.length + '/' + MAX_ALT);
    input.addEventListener('input', function () {
      draft = input.value;
      counter.textContent = draft.length + '/' + MAX_ALT;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEdit();
      }
      else if (e.key === 'Escape') {
        cancelEdit();
      }
    });

    const hint = [];
    if (i.required) hint.push('Required.');
    if (i.count > 1) hint.push('Updates this image in ' + i.count + ' places.');
    hint.push('Saved to the image’s Media item, so every page using it gets the new text.');

    const actions = el('div', 'ac-form-actions');
    const save = el('button', 'ac-button ac-button--primary', busy ? 'Saving…' : 'Save');
    save.type = 'submit';
    save.disabled = busy;
    const cancel = el('button', 'ac-button', 'Cancel');
    cancel.type = 'button';
    cancel.disabled = busy;
    cancel.addEventListener('click', cancelEdit);
    actions.append(save, cancel, counter);

    form.append(label, input, el('p', 'ac-meta', hint.join(' ')), actions);
    if (editError) {
      const err = el('p', 'ac-error', editError);
      err.setAttribute('role', 'alert');
      form.appendChild(err);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveEdit();
    });
    body.appendChild(form);
  }

  function hash(s) {
    let h = 0;
    for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
    return h;
  }

  function safeUrl(src) {
    try {
      const url = new URL(src, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function fileName(src) {
    const clean = src.split(/[?#]/)[0];
    return decodeURIComponent(clean.substring(clean.lastIndexOf('/') + 1)) || src;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    // Keep focus and caret in the alt input across re-renders.
    const active = document.activeElement;
    const caret = active && active.classList.contains('ac-input')
      ? [active.selectionStart, active.selectionEnd]
      : null;

    const counts = { all: results.length, missing: 0, present: 0 };
    results.forEach(function (r) { counts[r.status]++; });

    if (results.length === 0) {
      summaryEl.textContent = 'No images on this page.';
    }
    else {
      summaryEl.textContent =
        results.length + ' images · ' +
        counts.present + ' with alt · ' + counts.missing + ' without alt';
    }
    summaryEl.dataset.state = !results.length ? '' : counts.missing ? 'error' : 'ok';

    Object.keys(counts).forEach(function (key) {
      document.querySelector('[data-count="' + key + '"]').textContent = counts[key];
    });
    filterEls.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    });

    // Selected component first, then page order (missing ones are not moved,
    // so the list mirrors the page from top to bottom).
    const visible = results
      .filter(function (r) { return filter === 'all' || r.status === filter; })
      .map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) {
        const aSel = a.r.uuid && a.r.uuid === selectedUuid ? 0 : 1;
        const bSel = b.r.uuid && b.r.uuid === selectedUuid ? 0 : 1;
        return aSel - bSel || a.i - b.i;
      })
      .map(function (x) { return x.r; });

    listEl.replaceChildren();
    if (results.length && !visible.length) {
      listEl.appendChild(el('li', 'ac-empty',
        filter === 'missing' ? 'Every image has alt text.' : 'No image has alt text yet.'));
    }
    visible.forEach(function (r) {
      const li = el('li', 'ac-item ac-item--' + r.status + (r.note ? ' ac-item--note' : ''));
      if (r.uuid && r.uuid === selectedUuid) li.classList.add('ac-item--selected');

      const url = safeUrl(r.src);
      const thumb = el('div', 'ac-thumb');
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }
      li.appendChild(thumb);

      const body = el('div', 'ac-body');
      body.appendChild(el('span', 'ac-badge', r.status === 'present' ? '✓ Alt present' : '✗ Alt missing'));
      const altText = r.alt === null
        ? 'No alt attribute'
        : r.alt === '' ? 'alt="" (empty)' : '“' + r.alt + '”';
      body.appendChild(el('p', 'ac-message' + (r.alt ? '' : ' ac-message--none'), altText));
      if (r.note) body.appendChild(el('p', 'ac-note', r.note));
      if (r.pending) {
        body.appendChild(el('p', 'ac-saved', 'Saved. Reload the editor to see it in the preview.'));
      }
      body.appendChild(el('p', 'ac-meta', fileName(r.src)));
      const where = r.uuid
        ? (r.hint ? r.hint + ' · ' : '') + r.uuid.substring(0, 8) +
          (r.uuid === selectedUuid ? ' · selected' : '')
        : 'Outside editable content (template/region)';
      const whereEl = el('p', 'ac-meta', where);
      if (r.uuid) whereEl.title = r.uuid;
      body.appendChild(whereEl);
      renderActions(r, body);
      li.appendChild(body);

      listEl.appendChild(li);
    });

    const input = listEl.querySelector('.ac-input');
    if (input && (caret || editing)) {
      input.focus();
      const pos = caret || [input.value.length, input.value.length];
      input.setSelectionRange(pos[0], pos[1]);
    }
    else {
      const first = listEl.querySelector('.ac-item--selected');
      if (first) first.scrollIntoView({ block: 'nearest' });
    }
  }

  filterEls.forEach(function (button) {
    button.addEventListener('click', function () {
      filter = button.dataset.filter;
      render();
    });
  });

  // Subscribe one at a time: Canvas records subscriptions from a React
  // closure, so two back-to-back subscribe messages can overwrite each other.
  subscribe('previewHtml', function (html) {
    results = analyze(html);
    applySaved();
    render();
    lookupMissing();
  }).then(function () {
    return subscribe('selectedComponentUuid', function (uuid) {
      if (uuid === selectedUuid) return;
      selectedUuid = uuid;
      render();
    });
  });
})();
