/** @format */

(() => {
  if (window.SiteI18n) return;

  const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'de'];
  const FALLBACK_LANGUAGE = 'fr';
  const STORAGE_KEY = 'preferredLanguage';

  const dictionaries = new Map();
  const loadingPromises = new Map();
  let currentLanguage = FALLBACK_LANGUAGE;
  let mutationObserver = null;
  const flatCache = new Map();
  const phraseKeyCache = new Map();
  const phraseKeyLooseCache = new Map();
  const textOriginalMap = new WeakMap();
  const attrOriginalMap = new WeakMap();
  const intlLocaleByLanguage = Object.freeze({
    fr: 'fr-FR',
    en: 'en-US',
    es: 'es-ES',
    de: 'de-DE',
  });
  const autoAttrRules = [
    { attr: 'placeholder', keyAttr: 'data-i18n-placeholder' },
    { attr: 'title', keyAttr: 'data-i18n-title' },
    { attr: 'aria-label', keyAttr: 'data-i18n-aria' },
    { attr: 'alt', keyAttr: 'data-i18n-alt' },
  ];
  const CLOSE_GLYPH = '\u00D7';
  const TIMES_ENTITY = '&' + 'times;';
  const CLOSE_GLYPH_SELECTOR = '.close-modal, .close-panel, .close-emoji';
  const CLOSE_GLYPH_VARIANTS = new Set([
    CLOSE_GLYPH,
    TIMES_ENTITY,
    '&#215;',
    '&#x00D7;',
    '&#x00d7;',
    '\\u00D7',
    '\\u00d7',
    'x',
    'X',
    '\u00C3\u2014',
  ]);
  const LEGACY_PUBLIC_ORIGINS = Object.freeze([
    'https://community-web.com',
  ]);

  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const flattenDict = (value, prefix = '', output = {}) => {
    if (!isObject(value)) return output;
    Object.entries(value).forEach(([key, nested]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (isObject(nested)) flattenDict(nested, fullKey, output);
      else output[fullKey] = nested;
    });
    return output;
  };

  const normalizeLookup = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeForLooseLookup = (value) =>
    normalizeLookup(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const safeGet = (obj, keyPath) =>
    String(keyPath || '')
      .split('.')
      .reduce((acc, key) => {
        if (!acc || !Object.prototype.hasOwnProperty.call(acc, key)) return undefined;
        return acc[key];
      }, obj);

  const interpolate = (value, params = {}) => {
    if (typeof value !== 'string') return value;
    return value.replace(/\{(\w+)\}/g, (_match, key) =>
      Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`,
    );
  };

  const replaceLegacyPublicOrigins = (value) => {
    if (typeof value !== 'string') return value;
    const currentOrigin = String(window.location?.origin || '').trim();
    if (!currentOrigin) return value;

    return LEGACY_PUBLIC_ORIGINS.reduce(
      (output, legacyOrigin) => output.split(legacyOrigin).join(currentOrigin),
      value,
    );
  };

  const detectInitialLanguage = () => {
    const stored = String(localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
    if (SUPPORTED_LANGUAGES.includes(stored)) return stored;
    const browser = String(navigator.language || FALLBACK_LANGUAGE).slice(0, 2).toLowerCase();
    return SUPPORTED_LANGUAGES.includes(browser) ? browser : FALLBACK_LANGUAGE;
  };

  const loadDictionary = async (lang) => {
    if (dictionaries.has(lang)) return dictionaries.get(lang);
    if (loadingPromises.has(lang)) return loadingPromises.get(lang);

    const task = fetch(`/i18n/${lang}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${lang}.json`);
        return response.json();
      })
      .then((payload) => {
        dictionaries.set(lang, payload);
        flatCache.delete(lang);
        phraseKeyCache.clear();
        phraseKeyLooseCache.clear();
        loadingPromises.delete(lang);
        return payload;
      })
      .catch((error) => {
        loadingPromises.delete(lang);
        throw error;
      });

    loadingPromises.set(lang, task);
    return task;
  };

  const getFlatDictionary = (lang) => {
    if (flatCache.has(lang)) return flatCache.get(lang);
    const dict = dictionaries.get(lang) || {};
    const flattened = flattenDict(dict);
    flatCache.set(lang, flattened);
    return flattened;
  };

  const buildPhraseKeyMaps = () => {
    const strictMap = new Map();
    const looseMap = new Map();

    SUPPORTED_LANGUAGES.forEach((lang) => {
      const flat = getFlatDictionary(lang);
      Object.entries(flat).forEach(([key, value]) => {
        if (typeof value !== 'string') return;
        const source = normalizeLookup(value);
        if (!source) return;

        if (!strictMap.has(source)) strictMap.set(source, key);

        const looseKey = normalizeForLooseLookup(source);
        if (looseKey && !looseMap.has(looseKey)) looseMap.set(looseKey, key);
      });
    });

    return { strictMap, looseMap };
  };

  const getPhraseKeyMap = () => {
    if (phraseKeyCache.has('all')) return phraseKeyCache.get('all');
    const { strictMap } = buildPhraseKeyMaps();
    phraseKeyCache.set('all', strictMap);
    return strictMap;
  };

  const getPhraseKeyLooseMap = () => {
    if (phraseKeyLooseCache.has('all')) return phraseKeyLooseCache.get('all');
    const { looseMap } = buildPhraseKeyMaps();
    phraseKeyLooseCache.set('all', looseMap);
    return looseMap;
  };

  const resolveTranslationKeyFromText = (value) => {
    const strictValue = normalizeLookup(value);
    if (!strictValue) return '';

    const strictMatch = getPhraseKeyMap().get(strictValue);
    if (strictMatch) return strictMatch;

    return getPhraseKeyLooseMap().get(normalizeForLooseLookup(strictValue)) || "";
  };

  const translatePlainText = (input) => {
    const value = replaceLegacyPublicOrigins(String(input ?? ''));
    if (!/[A-Za-z\u00C0-\u00FF]/.test(value)) return value;
    const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const leading = match?.[1] || '';
    const core = match?.[2] || value;
    const trailing = match?.[3] || '';
    const key = resolveTranslationKeyFromText(core);
    if (!key) return value;

    const translated =
      getFlatDictionary(currentLanguage)[key] ?? getFlatDictionary(FALLBACK_LANGUAGE)[key];
    if (typeof translated !== 'string' || translated === core) return value;

    return `${leading}${translated}${trailing}`;
  };

  const loadAllDictionaries = async () => {
    await Promise.all(SUPPORTED_LANGUAGES.map((lang) => loadDictionary(lang)));
  };

  const hasAnyI18nMarker = (element) =>
    element?.hasAttribute?.('data-i18n') ||
    element?.hasAttribute?.('data-i18n-html') ||
    element?.hasAttribute?.('data-i18n-placeholder') ||
    element?.hasAttribute?.('data-i18n-title') ||
    element?.hasAttribute?.('data-i18n-aria') ||
    element?.hasAttribute?.('data-i18n-value') ||
    element?.hasAttribute?.('data-i18n-alt');

  const normalizeCloseGlyphToken = (value) =>
    String(value || '')
      .replace(/\s+/g, '')
      .trim();

  const isCloseGlyphVariant = (value) => {
    const token = normalizeCloseGlyphToken(value);
    if (!token) return false;
    return CLOSE_GLYPH_VARIANTS.has(token);
  };

  const normalizeCloseGlyphs = (root = document) => {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const elements =
      root instanceof Element
        ? [root, ...root.querySelectorAll(CLOSE_GLYPH_SELECTOR)]
        : [...root.querySelectorAll(CLOSE_GLYPH_SELECTOR)];

    elements.forEach((element) => {
      if (!(element instanceof Element) || !element.matches(CLOSE_GLYPH_SELECTOR)) return;
      const textToken = normalizeCloseGlyphToken(element.textContent);
      const htmlToken = normalizeCloseGlyphToken(element.innerHTML);
      if (!textToken) {
        element.textContent = CLOSE_GLYPH;
        return;
      }
      if (textToken !== CLOSE_GLYPH && (isCloseGlyphVariant(textToken) || isCloseGlyphVariant(htmlToken))) {
        element.textContent = CLOSE_GLYPH;
      }
    });
  };

  const applyAutoTranslations = (root = document) => {
    if (!root) return;
    const doc = root.ownerDocument || document;

    const canTraverseText = typeof doc.createTreeWalker === 'function';
    if (canTraverseText) {
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = String(parent.tagName || '').toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'noscript') {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.matches?.(CLOSE_GLYPH_SELECTOR) || parent.closest?.(CLOSE_GLYPH_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('[data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
          if (hasAnyI18nMarker(parent) || parent.closest('[data-i18n],[data-i18n-html]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return /[A-Za-z\u00C0-\u00FF]/.test(String(node.nodeValue || ''))
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });

      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      textNodes.forEach((node) => {
        if (!textOriginalMap.has(node)) textOriginalMap.set(node, String(node.nodeValue || ''));
        const original = textOriginalMap.get(node) || '';
        const translated = translatePlainText(original);
        if (translated !== node.nodeValue) node.nodeValue = translated;
      });
    }

    if (typeof root.querySelectorAll !== 'function') return;

    const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
    elements.forEach((element) => {
      if (!(element instanceof Element)) return;
      if (element.closest('[data-i18n-skip]')) return;

      autoAttrRules.forEach(({ attr, keyAttr }) => {
        if (element.hasAttribute(keyAttr) || !element.hasAttribute(attr)) return;
        const originalAttrs = attrOriginalMap.get(element) || new Map();
        if (!originalAttrs.has(attr)) originalAttrs.set(attr, String(element.getAttribute(attr) || ''));
        attrOriginalMap.set(element, originalAttrs);
        const translated = translatePlainText(originalAttrs.get(attr));
        if (translated !== element.getAttribute(attr)) {
          element.setAttribute(attr, translated);
        }
      });
    });

    normalizeCloseGlyphs(root);
  };

  const t = (key, fallback = '', params = {}) => {
    const activeDict = dictionaries.get(currentLanguage) || {};
    const fallbackDict = dictionaries.get(FALLBACK_LANGUAGE) || {};
    const rawValue = safeGet(activeDict, key) ?? safeGet(fallbackDict, key) ?? (fallback || key);
    return interpolate(replaceLegacyPublicOrigins(String(rawValue)), params);
  };

  const applyTranslations = (root = document) => {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!el.hasAttribute('data-i18n-fallback-text')) {
        el.setAttribute('data-i18n-fallback-text', el.textContent || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-text') || '';
      el.textContent = t(key, fallback);
    });

    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (!el.hasAttribute('data-i18n-fallback-html')) {
        el.setAttribute('data-i18n-fallback-html', el.innerHTML || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-html') || '';
      el.innerHTML = t(key, fallback);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!el.hasAttribute('data-i18n-fallback-placeholder')) {
        el.setAttribute('data-i18n-fallback-placeholder', el.getAttribute('placeholder') || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-placeholder') || '';
      el.setAttribute('placeholder', t(key, fallback));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (!el.hasAttribute('data-i18n-fallback-title')) {
        el.setAttribute('data-i18n-fallback-title', el.getAttribute('title') || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-title') || '';
      el.setAttribute('title', t(key, fallback));
    });

    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (!el.hasAttribute('data-i18n-fallback-aria')) {
        el.setAttribute('data-i18n-fallback-aria', el.getAttribute('aria-label') || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-aria') || '';
      el.setAttribute('aria-label', t(key, fallback));
    });

    root.querySelectorAll('[data-i18n-value]').forEach((el) => {
      const key = el.getAttribute('data-i18n-value');
      if (!el.hasAttribute('data-i18n-fallback-value')) {
        el.setAttribute('data-i18n-fallback-value', el.getAttribute('value') || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-value') || '';
      el.setAttribute('value', t(key, fallback));
    });

    root.querySelectorAll('[data-i18n-alt]').forEach((el) => {
      const key = el.getAttribute('data-i18n-alt');
      if (!el.hasAttribute('data-i18n-fallback-alt')) {
        el.setAttribute('data-i18n-fallback-alt', el.getAttribute('alt') || '');
      }
      const fallback = el.getAttribute('data-i18n-fallback-alt') || '';
      el.setAttribute('alt', t(key, fallback));
    });

    normalizeCloseGlyphs(root);
  };

  const languageOptions = [
    { code: 'fr', fallback: 'Fran\u00e7ais' },
    { code: 'en', fallback: 'English' },
    { code: 'es', fallback: 'Espa\u00f1ol' },
    { code: 'de', fallback: 'Deutsch' },
  ];

  const getLanguageName = (lang) => {
    const option = languageOptions.find((item) => item.code === lang);
    return t(`shared.language.options.${lang}`, option?.fallback || lang.toUpperCase());
  };

  const getIntlLocale = () => intlLocaleByLanguage[currentLanguage] || 'fr-FR';

  const getLanguageHost = () =>
    document.querySelector('.site-footer .footer-bottom-content .legal-links');

  const closePanel = (wrapper) => {
    const panel = wrapper.querySelector('[data-language-panel]');
    const trigger = wrapper.querySelector('[data-language-trigger]');
    if (!panel || !trigger) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    wrapper.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  };

  const openPanel = (wrapper) => {
    const panel = wrapper.querySelector('[data-language-panel]');
    const trigger = wrapper.querySelector('[data-language-trigger]');
    if (!panel || !trigger) return;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  const refreshLanguageSelectorState = (wrapper) => {
    if (!wrapper) return;
    const currentValue = wrapper.querySelector('[data-language-current]');
    const nativeSelect = wrapper.querySelector('select[data-language-select]');
    if (currentValue) currentValue.textContent = getLanguageName(currentLanguage);
    if (nativeSelect) nativeSelect.value = currentLanguage;

    wrapper.querySelectorAll('.language-option').forEach((button) => {
      const active = button.dataset.lang === currentLanguage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
  };

  const bindLanguageSelector = (wrapper) => {
    if (!wrapper || wrapper.dataset.bound === 'true') return;

    const trigger = wrapper.querySelector('[data-language-trigger]');
    const panel = wrapper.querySelector('[data-language-panel]');
    const nativeSelect = wrapper.querySelector('select[data-language-select]');
    if (!trigger || !panel || !nativeSelect) return;

    const optionButtons = () => Array.from(wrapper.querySelectorAll('.language-option'));

    const commitLanguage = async (lang) => {
      const normalized = String(lang || '').toLowerCase();
      if (!SUPPORTED_LANGUAGES.includes(normalized)) return;
      await setLanguage(normalized);
    };

    trigger.addEventListener('click', () => {
      if (wrapper.classList.contains('is-open')) closePanel(wrapper);
      else openPanel(wrapper);
    });

    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (wrapper.classList.contains('is-open')) closePanel(wrapper);
        else openPanel(wrapper);
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openPanel(wrapper);
        const items = optionButtons();
        if (!items.length) return;
        (event.key === 'ArrowDown' ? items[0] : items[items.length - 1]).focus();
      }
    });

    panel.addEventListener('click', async (event) => {
      const option = event.target.closest('.language-option');
      if (!option) return;
      event.preventDefault();
      await commitLanguage(option.dataset.lang);
      closePanel(wrapper);
      trigger.focus();
    });

    panel.addEventListener('keydown', async (event) => {
      const items = optionButtons();
      const index = items.findIndex((item) => item === document.activeElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(wrapper);
        trigger.focus();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!items.length) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const start = index >= 0 ? index : 0;
        const next = (start + delta + items.length) % items.length;
        items[next].focus();
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        const option = document.activeElement?.closest('.language-option');
        if (!option) return;
        event.preventDefault();
        await commitLanguage(option.dataset.lang);
        closePanel(wrapper);
        trigger.focus();
      }
    });

    nativeSelect.addEventListener('change', async (event) => {
      await commitLanguage(event.target.value);
    });

    document.addEventListener('pointerdown', (event) => {
      if (!wrapper.classList.contains('is-open')) return;
      if (wrapper.contains(event.target)) return;
      closePanel(wrapper);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && wrapper.classList.contains('is-open')) {
        closePanel(wrapper);
      }
    });

    wrapper.dataset.bound = 'true';
    closePanel(wrapper);
  };

  const ensureLanguageSelector = () => {
    const host = getLanguageHost();
    if (!host) return;

    let wrapper = host.querySelector('.footer-language-selector');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'language-selector footer-language-selector';
      wrapper.setAttribute('data-i18n-skip', '');
      wrapper.innerHTML = `
        <i class="fas fa-globe" aria-hidden="true"></i>
        <div class="language-dropdown">
          <button
            type="button"
            class="language-trigger"
            data-language-trigger
            aria-haspopup="listbox"
            aria-expanded="false"
            data-i18n-aria="shared.language.aria"
            aria-label="${t('shared.language.aria', 'Sélectionner la langue')}"
          >
            <span class="language-label" data-i18n="shared.language.label">Langue</span>
            <span class="language-current" data-language-current>${getLanguageName(currentLanguage)}</span>
            <i class="fas fa-chevron-down language-chevron" aria-hidden="true"></i>
          </button>
          <div class="language-options-panel hidden" data-language-panel role="listbox">
            ${languageOptions
              .map(
                (option) => `
                  <button type="button" class="language-option" data-lang="${option.code}" role="option">
                    <span class="language-option-code">${option.code.toUpperCase()}</span>
                    <span class="language-option-name" data-i18n="shared.language.options.${option.code}">${option.fallback}</span>
                  </button>`,
              )
              .join('')}
          </div>
          <select class="language-select native-language-select" data-language-select aria-hidden="true" tabindex="-1">
            ${languageOptions
              .map(
                (option) => `<option value="${option.code}" data-i18n="shared.language.options.${option.code}">${option.fallback}</option>`,
              )
              .join('')}
          </select>
        </div>`;
      host.appendChild(wrapper);
    }

    if (host.lastElementChild !== wrapper) {
      host.appendChild(wrapper);
    }

    applyTranslations(wrapper);
    bindLanguageSelector(wrapper);
    refreshLanguageSelectorState(wrapper);
  };

  const emitLanguageChange = () => {
    document.dispatchEvent(
      new CustomEvent('site:language-changed', {
        detail: { language: currentLanguage },
      }),
    );
  };

  const setLanguage = async (lang) => {
    const normalized = SUPPORTED_LANGUAGES.includes(lang) ? lang : FALLBACK_LANGUAGE;
    currentLanguage = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);

    await loadAllDictionaries();

    document.documentElement.lang = normalized;
    ensureLanguageSelector();
    applyTranslations(document);
    applyAutoTranslations(document);
    emitLanguageChange();
  };

  const refreshLanguageSelector = () => {
    ensureLanguageSelector();
    applyTranslations(document);
    applyAutoTranslations(document);
  };

  const initMutationObserver = () => {
    if (mutationObserver || typeof MutationObserver === 'undefined' || !document.body) return;
    mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            applyTranslations(node);
            applyAutoTranslations(node);
          }
        });
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  const init = async () => {
    currentLanguage = detectInitialLanguage();
    await loadAllDictionaries();

    document.documentElement.lang = currentLanguage;
    ensureLanguageSelector();
    applyTranslations(document);
    applyAutoTranslations(document);
    initMutationObserver();
    emitLanguageChange();
  };

  window.SiteI18n = Object.freeze({
    t,
    translateText: (value, params) => interpolate(translatePlainText(String(value || '')), params || {}),
    getLanguage: () => currentLanguage,
    getIntlLocale,
    setLanguage,
    applyTranslations,
    applyAutoTranslations,
    refreshLanguageSelector,
    init,
  });

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('SiteI18n init failed:', error);
    });
  });
})();
