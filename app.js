/* =====================================================================
   app.js - screens, camera scanning, product lookup, and drawing results.
   The food-safety logic itself is in rules.js.
   ===================================================================== */
(function () {
  'use strict';

  const R = window.Rules;
  const API = 'https://world.openfoodfacts.org/api/v2/product/';
  // Only ask the database for the fields we use (faster)
  const FIELDS = [
    'code', 'product_name', 'product_name_en', 'brands', 'image_front_small_url', 'image_front_url',
    'ingredients_text', 'ingredients_text_en', 'allergens_tags', 'traces_tags',
    'ingredients_analysis_tags', 'labels_tags', 'nutriments', 'lang',
  ].join(',');
  const HISTORY_MAX = 50;

  const $ = id => document.getElementById(id);

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  // ---------------------------------------------------------------
  // Saving to the phone (localStorage). Wrapped in try/catch because
  // private browsing can block storage.
  // ---------------------------------------------------------------
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
  }

  // The storage keys keep the app's old name (SafeBite) so saved data still loads.
  let profile = load('safebite-profile', {});
  profile = { allergies: profile.allergies || [], diets: profile.diets || [] };

  // Make text safe to put inside HTML
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Format carb gram quantities in JetBrains Mono
  function formatReason(s) {
    return esc(s).replace(/(\d+(?:\.\d+)?\s*g\b)/g, '<span class="mono">$1</span>');
  }

  // ---------------------------------------------------------------
  // Screens (bottom tabs)
  // ---------------------------------------------------------------
  function showView(name) {
    ['scan', 'history', 'settings'].forEach(v => {
      $('view-' + v).hidden = v !== name;
      $('tab-' + v).classList.toggle('active', v === name);
      if (v === name) $('tab-' + v).setAttribute('aria-current', 'page');
      else $('tab-' + v).removeAttribute('aria-current');
    });
    if (name !== 'scan') stopScan();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
    if (name === 'scan') updateProfileHint();
    window.scrollTo(0, 0);
  }
  // Any element with data-go="settings" etc. switches screens when tapped
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); showView(go.dataset.go); }
  });

  function updateProfileHint() {
    $('profileHint').hidden = profile.allergies.length + profile.diets.length > 0;
  }

  // ---------------------------------------------------------------
  // Camera barcode scanning (html5-qrcode library)
  // ---------------------------------------------------------------
  let scanner = null;

  async function startScan() {
    cancelLookups();
    if (typeof Html5Qrcode === 'undefined') {
      alert('The scanner could not load. Check your internet, or type the barcode number instead.');
      return;
    }
    $('result').innerHTML = '';
    $('scanBtn').hidden = true;
    $('stopBtn').hidden = false;
    $('reader').hidden = false;
    const formats = [
      Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
    ];
    scanner = new Html5Qrcode('reader', {
      formatsToSupport: formats,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    // Enable ZXing TRY_HARDER so 1D barcodes don't have to be dead-center
    const decoders = [scanner.qrcode && scanner.qrcode.primaryDecoder, scanner.qrcode && scanner.qrcode.secondaryDecoder];
    decoders.forEach(d => {
      if (d && d.hints && typeof d.hints.entries === 'function') {
        for (const [k, v] of d.hints.entries()) {
          if (v === false) d.hints.set(k, true);
        }
      }
    });
    // Keep full camera resolution in the scan canvas instead of downscaling to 280x150 CSS pixels
    scanner.foreverScan = function ( scanConfig, onSuccess, onError ) {
      if (!this.shouldScan || !this.renderedCamera || !this.qrRegion) return;
      const video = this.renderedCamera.getSurface();
      if (video.videoWidth && video.clientWidth) {
        const scaleX = video.videoWidth / video.clientWidth;
        const scaleY = video.videoHeight / video.clientHeight;
        const srcW = Math.max(1, Math.round(this.qrRegion.width * scaleX));
        const srcH = Math.max(1, Math.round(this.qrRegion.height * scaleY));
        const srcX = Math.round(this.qrRegion.x * scaleX);
        const srcY = Math.round(this.qrRegion.y * scaleY);
        if (this.canvasElement.width !== srcW) this.canvasElement.width = srcW;
        if (this.canvasElement.height !== srcH) this.canvasElement.height = srcH;
        this.context.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      }
      const next = () => {
        this.foreverScanTimeout = setTimeout(() => this.foreverScan(scanConfig, onSuccess, onError), this.getTimeoutFps(scanConfig.fps));
      };
      this.scanContext(onSuccess, onError).finally(next);
    };

    let found = false;   // the scanner can report the same barcode several times
    const makeConfig = facingMode => ({
      fps: 12,
      disableFlip: true,
      qrbox: (w, h) => ({ width: Math.min(320, Math.floor(w * 0.88)), height: Math.min(170, Math.floor(h * 0.65)) }),
      formatsToSupport: formats,
      videoConstraints: {
        facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    const onDecode = code => {                               // found a barcode
      if (found || lookupsRunning) return;
      found = true;
      stopScan();
      lookup(code);
    };
    try {
      await scanner.start({ facingMode: 'environment' }, makeConfig('environment'), onDecode, () => {});
    } catch (e) {
      try {
        await scanner.start({ facingMode: 'user' }, makeConfig('user'), onDecode, () => {});
      } catch (e2) {
        stopScan();
        alert('Could not open the camera. Allow camera access (the page must be https), or type the barcode number.');
      }
    }
  }

  async function stopScan() {
    if (scanner) {
      try { await scanner.stop(); } catch (e) {}
      try { scanner.clear(); } catch (e) {}
      scanner = null;
    }
    $('reader').hidden = true;
    $('scanBtn').hidden = false;
    $('stopBtn').hidden = true;
  }

  // ---------------------------------------------------------------
  // Looking up a product in Open Food Facts
  // ---------------------------------------------------------------
  // Only the newest lookup may draw a result; older ones are ignored when they finish.
  let lookupSeq = 0;
  let lookupsRunning = 0;
  function cancelLookups() { lookupSeq++; }

  async function lookup(raw) {
    const seq = ++lookupSeq;
    const code = String(raw || '').replace(/\D/g, '');   // keep digits only
    if (code.length < 6) {
      showNotFound(code, 'Please type the numbers under the barcode (usually 8 to 13 digits).');
      return;
    }
    $('result').innerHTML =
      '<div class="sheet"><div class="sheet-section"><p>Looking up <span class="mono">' + esc(code) + '</span>...</p></div></div>';

    let data = null;
    lookupsRunning++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);   // give up after 12 seconds
      const res = await fetch(API + code + '.json?fields=' + FIELDS, { signal: ctrl.signal });
      clearTimeout(timer);
      data = await res.json().catch(() => null);
      if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (seq !== lookupSeq) return;
      showNotFound(code, "Couldn't reach the food database. Check your internet connection and try again.", 'wifi-off');
      return;
    } finally {
      lookupsRunning--;
    }
    if (seq !== lookupSeq) return;   // a newer lookup has started since

    if (!data || data.status !== 1 || !data.product) {
      showNotFound(code, "This product isn't in the Open Food Facts database yet. " +
        'Try scanning again, or type the number if the scan was blurry.');
      return;
    }

    const product = slim(data.product, code);
    addToHistory(product);
    renderResult(product);
  }

  // Keep only the fields we need (so history stays small)
  function slim(p, code) {
    return {
      code: p.code || code,
      name: p.product_name_en || p.product_name || 'Unknown product',
      brands: p.brands || '',
      image: p.image_front_small_url || p.image_front_url || '',
      ingredients_text: p.ingredients_text || '',
      ingredients_text_en: p.ingredients_text_en || '',
      allergens_tags: p.allergens_tags || [],
      traces_tags: p.traces_tags || [],
      ingredients_analysis_tags: p.ingredients_analysis_tags || [],
      labels_tags: p.labels_tags || [],
      lang: p.lang || '',
      nutriments: { carbohydrates_100g: p.nutriments ? p.nutriments.carbohydrates_100g : undefined },
    };
  }

  // Friendly "not found" / error sheet, with manual entry and try-again
  function showNotFound(code, message, icon) {
    $('result').innerHTML = `
      <div class="sheet">
        <div class="sheet-section">
          <div class="status-card unknown" role="status">
            <span class="status-icon"><i data-lucide="${icon || 'search-x'}" aria-hidden="true"></i></span>
            <div>
              <div class="status-title">We couldn't find that</div>
              <p>${esc(message)}</p>
            </div>
          </div>
          ${code ? `<p class="muted" style="margin-top: 12px;">Barcode: <span class="mono">${esc(code)}</span></p>` : ''}
          <label class="field-label" for="retryInput">Barcode number</label>
          <div class="row">
            <input id="retryInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Type barcode number" value="${esc(code)}">
            <button class="btn btn-check" id="retryLookup">Check</button>
          </div>
          <button class="btn btn-secondary" id="retryScan"><i data-lucide="scan-barcode" aria-hidden="true"></i> Try scanning again</button>
        </div>
      </div>`;
    refreshIcons();
    $('retryLookup').onclick = () => lookup($('retryInput').value);
    $('retryInput').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(e.target.value); });
    $('retryScan').onclick = startScan;
  }

  // ---------------------------------------------------------------
  // Drawing the result screen
  // ---------------------------------------------------------------
  // One status system for the whole app: color + icon + plain words, never color alone
  const STATUS = {
    safe:    { icon: 'circle-check',   title: 'Safe for you',        short: 'Safe' },
    unsafe:  { icon: 'circle-x',       title: 'Not safe for you',    short: 'Not safe' },
    caution: { icon: 'triangle-alert', title: 'Check the label',     short: 'Caution' },
    unknown: { icon: 'circle-help',    title: 'Not enough info',     short: 'Unknown' },
    none:    { icon: 'user-round-cog', title: 'Set up your profile', short: 'No profile' },
  };
  // Allergen and diet results mapped onto that status system
  const ALLERGEN_STATUS = {
    contains: { level: 'unsafe',  word: 'Contains' },
    traces:   { level: 'caution', word: 'May contain' },
    clear:    { level: 'safe',    word: 'Not found' },
    unknown:  { level: 'unknown', word: 'Not enough info' },
  };
  const DIET_STATUS = {
    yes:     { level: 'safe',    word: 'Yes' },
    no:      { level: 'unsafe',  word: 'No' },
    unknown: { level: 'unknown', word: 'Not enough info' },
  };

  function pill(level, word) {
    return `<span class="pill ${level}"><i data-lucide="${STATUS[level].icon}" aria-hidden="true"></i>${esc(word)}</span>`;
  }

  // One row in the allergen or diet list
  function checkRow(label, reason, st, isMine) {
    return `<li class="check-row">
        <div class="check-main">
          <span class="check-name">${esc(label)}${isMine ? '<span class="mine-note">(yours)</span>' : ''}</span>
          <span class="check-reason">${formatReason(reason)}</span>
        </div>
        ${pill(st.level, st.word)}
      </li>`;
  }

  function renderResult(p) {
    const al = R.analyzeAllergens(p);
    const diets = R.analyzeDiets(p, al);
    const v = R.verdict(al, diets, profile);
    const text = R.ingredientsText(p);
    const b = STATUS[v.level];

    // 1) Big status verdict (largest element on the screen)
    const reasons = v.level === 'none'
      ? `<p>Pick your allergies and diets in <a href="#" data-go="settings">Settings</a> to get a personal check.</p>`
      : `<ul>${v.reasons.map(r => `<li>${formatReason(r)}</li>`).join('')}</ul>`;
    let html = `<div class="status-card big ${v.level}" role="status">
        <div class="status-head">
          <span class="status-icon"><i data-lucide="${b.icon}" aria-hidden="true"></i></span>
          <div class="status-title">${b.title}</div>
        </div>
        <div class="status-body">${reasons}</div>
      </div>`;

    // 2) Unified product sheet (Yuka + Nutrition-Facts hierarchy: product header, allergens, diets, ingredients)
    html += `<div class="sheet">`;

    html += `<div class="sheet-section product">
        ${p.image ? `<img src="${esc(p.image)}" alt="Photo of ${esc(p.name)}">`
                  : '<div class="noimg"><i data-lucide="package" aria-hidden="true"></i></div>'}
        <div class="product-info">
          <h2 class="name">${esc(p.name)}</h2>
          ${p.brands ? `<div class="brand">${esc(p.brands)}</div>` : ''}
          <span class="barcode"><span class="sr-only">Barcode </span>${esc(p.code)}</span>
        </div>
      </div>`;

    // 3) Allergens: your allergies first, then anything else found, the rest tucked away
    const isMine = a => profile.allergies.includes(a.id);
    const found = a => ['contains', 'traces'].includes(al[a.id].status);
    const mine = R.ALLERGENS.filter(isMine);
    const other = R.ALLERGENS.filter(a => !isMine(a) && found(a));
    const rest = R.ALLERGENS.filter(a => !isMine(a) && !found(a));
    const allergenRow = a => checkRow(cap(a.name), al[a.id].reason, ALLERGEN_STATUS[al[a.id].status], isMine(a));
    html += `<div class="sheet-section"><h2>Allergens</h2>`;
    if (mine.length || other.length) {
      html += `<ul class="checks">${[...mine, ...other].map(allergenRow).join('')}</ul>`;
    }
    if (rest.length) {
      const anyUnknown = rest.some(a => al[a.id].status === 'unknown');
      html += `<details class="more">
          <summary>${mine.length || other.length ? 'Other allergens' : 'All allergens'} (${rest.length}):
            ${anyUnknown ? 'not enough info' : 'none found'}</summary>
          <ul class="checks">${rest.map(allergenRow).join('')}</ul>
        </details>`;
    }
    html += `</div>`;

    // 4) Diets: your diets first
    const dietMine = d => profile.diets.includes(d.id);
    const dietOrder = [...R.DIETS.filter(dietMine), ...R.DIETS.filter(d => !dietMine(d))];
    html += `<div class="sheet-section"><h2>Diets</h2><ul class="checks">`;
    html += dietOrder.map(d => checkRow(d.label, diets[d.id].reason, DIET_STATUS[diets[d.id].status], dietMine(d))).join('');
    html += `</ul></div>`;

    // 5) Full ingredients, with allergen words highlighted
    html += `<div class="sheet-section"><h2>Ingredients</h2>`;
    if (text) {
      html += `<p class="ingredients">${highlight(text, R.allergenMatches(p, al))}</p>`;
    } else {
      html += `<p class="muted icon-line"><i data-lucide="circle-help" aria-hidden="true"></i> No ingredient list in the database. Read the package label.</p>`;
    }
    html += `</div></div>`;

    // 6) Disclaimer + next scan
    html += `<div class="result-footer">
        <p class="disclaimer"><i data-lucide="info" aria-hidden="true"></i>
          <span>Always read the package label before eating. Data comes from volunteers and can be incomplete.</span></p>
        <button class="btn btn-primary btn-big" id="scanAgain"><i data-lucide="scan-barcode" aria-hidden="true"></i> Scan another barcode</button>
      </div>`;

    $('result').innerHTML = `<div class="fade-in">${html}</div>`;
    refreshIcons();
    $('scanAgain').onclick = () => { window.scrollTo(0, 0); startScan(); };
    $('result').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // Wrap the [start, end] ranges of `text` in <mark>, escaping everything
  function highlight(text, ranges) {
    let out = '', pos = 0;
    ranges.forEach(([a, b]) => {
      out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
      pos = b;
    });
    return out + esc(text.slice(pos));
  }

  // ---------------------------------------------------------------
  // History (last 50 products, saved on the phone)
  // ---------------------------------------------------------------
  function addToHistory(product) {
    let h = load('safebite-history', []);
    h = h.filter(x => x.code !== product.code);   // no duplicates: move to top
    h.unshift(product);
    save('safebite-history', h.slice(0, HISTORY_MAX));
  }

  function renderHistory() {
    const h = load('safebite-history', []);
    const ul = $('historyList');
    if (!h.length) { ul.innerHTML = '<li class="empty muted">No scans yet.</li>'; return; }
    ul.innerHTML = h.map((p, i) => {
      // Re-check with the CURRENT profile, so colors update if settings change
      const al = R.analyzeAllergens(p);
      const v = R.verdict(al, R.analyzeDiets(p, al), profile);
      return `<li><button class="history-item" data-i="${i}">
          ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span class="noimg"><i data-lucide="package" aria-hidden="true"></i></span>'}
          <span class="info"><b>${esc(p.name)}</b><span class="muted">${esc(p.brands)}</span></span>
          ${pill(v.level, STATUS[v.level].short)}
        </button></li>`;
    }).join('');
    refreshIcons();
    ul.querySelectorAll('[data-i]').forEach(li => {
      li.onclick = () => {
        const p = h[Number(li.dataset.i)];
        cancelLookups();
        showView('scan');
        renderResult(p);
      };
    });
  }

  $('clearHistoryBtn').onclick = () => {
    if (confirm('Clear all scan history?')) { save('safebite-history', []); renderHistory(); }
  };

  // ---------------------------------------------------------------
  // Settings (allergies + diets)
  // ---------------------------------------------------------------
  function renderSettings() {
    drawChips($('allergyChips'), R.ALLERGENS, 'allergies', a => cap(a.name));
    drawChips($('dietChips'), R.DIETS, 'diets', d => d.label);
    refreshIcons();
  }

  function drawChips(box, items, key, labelFn) {
    box.innerHTML = '';
    items.forEach(item => {
      const b = document.createElement('button');
      const on = profile[key].includes(item.id);
      b.className = 'chip' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.innerHTML = `<span class="chip-box">${on ? '<i data-lucide="check" aria-hidden="true"></i>' : ''}</span>${esc(labelFn(item))}`;
      b.onclick = () => {
        profile[key] = on ? profile[key].filter(x => x !== item.id) : [...profile[key], item.id];
        save('safebite-profile', profile);
        renderSettings();
      };
      box.appendChild(b);
    });
  }

  // ---------------------------------------------------------------
  // Start up
  // ---------------------------------------------------------------
  $('scanBtn').onclick = startScan;
  $('stopBtn').onclick = stopScan;
  $('lookupBtn').onclick = () => lookup($('codeInput').value);
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(e.target.value); });
  updateProfileHint();
  refreshIcons();
})();
