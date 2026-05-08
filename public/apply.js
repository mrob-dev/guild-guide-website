// apply.js — handles the public application form on /apply.
// Posts directly to the public submit-application Edge Function.
// No framework, no build step.

const ENDPOINT =
  'https://nigonhrurkscfjzgbmrr.supabase.co/functions/v1/submit-application';

// Same regex as the server-side check in submit-application/index.ts so
// client- and server-side validation stay in lock-step.
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const form = document.getElementById('apply-form');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const success = document.getElementById('success');
const turnstileMount = document.getElementById('turnstile-mount');

// Turnstile is only loaded if a site key was configured in apply.html.
// When unset, we fall back to honeypot-only protection.
let turnstileWidgetId = null;
const TURNSTILE_SITE_KEY = (window.GUILD_TURNSTILE_SITE_KEY || '').trim();

function loadTurnstile() {
  if (!TURNSTILE_SITE_KEY || !turnstileMount) return;
  // Inject the Cloudflare script once.
  if (!document.querySelector('script[data-turnstile]')) {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.dataset.turnstile = '1';
    s.onload = renderTurnstile;
    document.head.appendChild(s);
  } else {
    renderTurnstile();
  }
}

function renderTurnstile() {
  if (!window.turnstile || !turnstileMount) return;
  turnstileWidgetId = window.turnstile.render(turnstileMount, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: 'dark',
    appearance: 'always',
  });
}

function readTurnstileToken() {
  if (!TURNSTILE_SITE_KEY || !window.turnstile || turnstileWidgetId == null) return null;
  return window.turnstile.getResponse(turnstileWidgetId) || null;
}

function resetTurnstile() {
  if (window.turnstile && turnstileWidgetId != null) {
    window.turnstile.reset(turnstileWidgetId);
  }
}

loadTurnstile();

function setError(name, message) {
  const el = form.querySelector(`[data-error-for="${name}"]`);
  if (el) el.textContent = message ?? '';
  const input = form.elements.namedItem(name);
  if (input) input.classList.toggle('is-invalid', Boolean(message));
}

function clearErrors() {
  formError.textContent = '';
  form
    .querySelectorAll('[data-error-for]')
    .forEach((el) => (el.textContent = ''));
  form
    .querySelectorAll('.is-invalid')
    .forEach((el) => el.classList.remove('is-invalid'));
}

function validate(values) {
  let ok = true;
  if (!values.email) {
    setError('email', 'Email is required.');
    ok = false;
  } else if (!EMAIL_RE.test(values.email)) {
    setError('email', 'Please enter a valid email address.');
    ok = false;
  }
  if (!values.city) {
    formError.textContent = 'Please tell us your base city.';
    ok = false;
  }
  return ok;
}

function readForm() {
  const data = new FormData(form);
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  const get = (k) => trim(data.get(k)) || undefined;

  return {
    email: get('email'),
    firstName: get('firstName'),
    lastName: get('lastName'),
    city: get('city'),
    yearsGuiding: data.get('yearsGuiding')
      ? Number(data.get('yearsGuiding'))
      : undefined,
    website: get('website'),
    previousCompanies: get('previousCompanies'),
    toursOffered: get('toursOffered'),
    specialties: get('specialties'),
    additionalInfo: get('additionalInfo'),
    // Honeypot — must be empty if a human submitted the form.
    _hp: data.get('hp_company'),
  };
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.classList.toggle('is-loading', loading);
}

async function submit(payload) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON body — fall through to status check */
  }
  if (!response.ok) {
    const msg =
      (data && data.error) ||
      `Something went wrong (HTTP ${response.status}). Please try again.`;
    throw new Error(msg);
  }
  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const values = readForm();

  // Bot signature: drop silently with a fake-success UX so the bot
  // doesn't learn what tripped them up.
  if (values._hp) {
    form.hidden = true;
    success.hidden = false;
    return;
  }

  if (!validate(values)) return;

  // Attach Turnstile token if configured. Server treats this as required
  // when its TURNSTILE_SECRET_KEY env var is set.
  if (TURNSTILE_SITE_KEY) {
    const token = readTurnstileToken();
    if (!token) {
      formError.textContent = 'Please complete the verification challenge.';
      return;
    }
    values.cfTurnstileToken = token;
  }

  // Strip honeypot before sending.
  delete values._hp;
  // Strip undefined keys so the wire payload stays small.
  Object.keys(values).forEach((k) => values[k] === undefined && delete values[k]);

  setLoading(true);
  try {
    await submit(values);
    setLoading(false);
    form.hidden = true;
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    formError.textContent = err.message;
    resetTurnstile();
    setLoading(false);
  }
});

// Live email validation feedback as the user types.
form.elements.email.addEventListener('blur', (e) => {
  const v = e.target.value.trim();
  if (v && !EMAIL_RE.test(v)) {
    setError('email', 'That doesn’t look like a valid email.');
  } else {
    setError('email', null);
  }
});
