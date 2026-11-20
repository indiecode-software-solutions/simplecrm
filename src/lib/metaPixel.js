/**
 * Meta Pixel (fbevents.js) tracking helper for simplecrm marketing & trial funnel.
 * Configured via VITE_META_PIXEL_ID in .env (and deployment environment variables).
 *
 * Tracked Events:
 *   - PageView              (Standard: initial load + SPA route changes)
 *   - StartTrialClick       (Custom: clicking Start Trial CTAs)
 *   - PricingClick          (Custom: clicking Pricing CTA)
 *   - FormStart             (Custom: first input inside #trial-form)
 *   - CompleteRegistration  (Standard: successful trial form submission)
 *   - TrialActivated        (Custom: workspace provisioned on enroll-trial)
 */

export const DEFAULT_META_PIXEL_ID = '1445678400486813';
export const DEFAULT_TEST_EVENT_CODE = 'TEST90352';

let pixelInitialized = typeof window !== 'undefined' && typeof window.fbq === 'function';
// Set initial path from index.html initial PageView to prevent double-firing on initial mount
let lastTrackedPath = typeof window !== 'undefined' ? window.location.pathname : null;

export function getTestEventCode() {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('test_event_code');
    if (code) {
      sessionStorage.setItem('meta_test_event_code', code);
      return code;
    }
  } catch {}
  try {
    const saved = sessionStorage.getItem('meta_test_event_code');
    if (saved) return saved;
  } catch {}
  try {
    const envCode = import.meta?.env?.VITE_META_TEST_EVENT_CODE;
    if (typeof envCode === 'string' && envCode.trim()) return envCode.trim();
  } catch {}
  return DEFAULT_TEST_EVENT_CODE;
}

function getMetaPixelId() {
  try {
    const raw = import.meta?.env?.VITE_META_PIXEL_ID;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {}
  return DEFAULT_META_PIXEL_ID;
}

function isMasterRoute(path) {
  const target = typeof path === 'string' ? path : (typeof window !== 'undefined' ? window.location.pathname : '');
  return target === '/master' || target.startsWith('/master/');
}

/**
 * Bootstraps Meta Pixel (fbevents.js) once if VITE_META_PIXEL_ID is configured.
 * Safe against React StrictMode double-invocations and ad-blockers.
 */
export function initMetaPixel() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (isMasterRoute()) return false;

  const pixelId = getMetaPixelId();
  if (!pixelId) return false;

  if (pixelInitialized) return true;

  try {
    if (!window.fbq) {
      /* Official Meta Pixel base loader */
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = true;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = true;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        if (s && s.parentNode) {
          s.parentNode.insertBefore(t, s);
        } else {
          b.head.appendChild(t);
        }
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }

    window.fbq('init', pixelId);
    pixelInitialized = true;
    return true;
  } catch {
    return false;
  }
}

function safeFbq(method, eventName, params = {}) {
  if (typeof window === 'undefined') return;
  if (isMasterRoute()) return;

  // Ensure initialized if VITE_META_PIXEL_ID is configured
  if (!pixelInitialized && getMetaPixelId()) {
    initMetaPixel();
  }

  try {
    if (typeof window.fbq !== 'function') return;

    const testCode = getTestEventCode();
    const eventParams = { ...params };
    const eventOptions = {};

    if (testCode) {
      eventParams.test_event_code = testCode;
      eventOptions.test_event_code = testCode;
    }

    if (Object.keys(eventOptions).length > 0) {
      window.fbq(method, eventName, eventParams, eventOptions);
    } else if (Object.keys(eventParams).length > 0) {
      window.fbq(method, eventName, eventParams);
    } else {
      window.fbq(method, eventName);
    }
  } catch {
    // Ignore ad-blocker or script load failures silently
  }
}

export function trackPageView(path) {
  if (typeof window === 'undefined') return;
  const resolvedPath = typeof path === 'string' && path ? path : window.location.pathname;
  if (isMasterRoute(resolvedPath)) return;

  // Dedupe back-to-back calls for the exact same route (e.g. React StrictMode double mount)
  if (lastTrackedPath === resolvedPath) return;
  lastTrackedPath = resolvedPath;

  safeFbq('track', 'PageView');
}

export function trackStartTrialClick(params = {}) {
  safeFbq('trackCustom', 'StartTrialClick', params);
}

export function trackPricingClick(params = {}) {
  safeFbq('trackCustom', 'PricingClick', params);
}

export function trackFormStart(params = {}) {
  safeFbq('trackCustom', 'FormStart', params);
}

export function trackCompleteRegistration(params = {}) {
  safeFbq('track', 'CompleteRegistration', params);
  // Also fire standard Lead event for Meta Ad campaign optimization
  safeFbq('track', 'Lead', params);
}

export function trackTrialActivated(params = {}) {
  safeFbq('trackCustom', 'TrialActivated', params);
  // Also fire standard StartTrial event for Meta Ad reporting
  safeFbq('track', 'StartTrial', params);
}
