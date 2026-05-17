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
const submitLabel = submitBtn?.querySelector('.submit-label');
const formError = document.getElementById('form-error');
const success = document.getElementById('success');
const turnstileMount = document.getElementById('turnstile-mount');
const tabs = document.querySelectorAll('.apply-tab');
const panes = document.querySelectorAll('.apply-pane');
const successTitle = success?.querySelector('.success-title');
const successBody = success?.querySelector('.success-body');

// ── Tab switching ─────────────────────────────────────────────────
// The form starts in 'guide' mode; clicking the Operator tab swaps
// the visible field set and changes the submit-button label so the
// CTA reads as intended (Apply as guide vs Apply as operator).
function setTab(tab) {
  form.dataset.tab = tab;
  tabs.forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  panes.forEach((p) => {
    p.hidden = p.dataset.pane !== tab;
  });
  if (submitLabel) {
    submitLabel.textContent = tab === 'operator'
      ? 'Send operator application'
      : 'Send application';
  }
  // Toggle the operator-authority consent row + the agreement link in
  // the consent block to match the active tab.
  const opRows = document.querySelectorAll('[data-operator-only]');
  opRows.forEach((el) => {
    el.hidden = tab !== 'operator';
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.required = tab === 'operator';
      if (tab !== 'operator') cb.checked = false;
    }
  });
  const guideAg = document.querySelector('[data-agreement-guide]');
  const opAg = document.querySelector('[data-agreement-operator]');
  if (guideAg) guideAg.hidden = tab === 'operator';
  if (opAg) opAg.hidden = tab !== 'operator';

  // Clear errors when switching — they're scoped to the previously-
  // visible fields and would otherwise read as orphan.
  clearErrors();
}

tabs.forEach((b) => {
  b.addEventListener('click', () => {
    const t = b.dataset.tab;
    if (t && t !== form.dataset.tab) setTab(t);
  });
});

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
  // For operators, the operatorName-derived error key is 'operatorName'
  // / 'operatorEmail'; for guides it's 'email'. We unify on `email` in
  // the payload but display errors against the visible field's name.
  const isOperator = values.applicationType === 'operator';
  const emailFieldName = isOperator ? 'operatorEmail' : 'email';
  if (!values.email) {
    setError(emailFieldName, 'Email is required.');
    ok = false;
  } else if (!EMAIL_RE.test(values.email)) {
    setError(emailFieldName, 'Please enter a valid email address.');
    ok = false;
  }
  if (isOperator && !values.operatorName) {
    setError('operatorName', 'Operator name is required.');
    ok = false;
  }
  if (!values.city) {
    formError.textContent = 'Please tell us your base city.';
    ok = false;
  }
  // Consent — every box must be ticked. The HTML required attribute
  // catches this for the standard form-submit path, but a JS-triggered
  // submission could bypass it, so re-check here.
  const c = values.consent || {};
  const consentMissing = [];
  if (!c.confirmedAge18) consentMissing.push('age 18+ confirmation');
  if (!c.identityDeclaration) consentMissing.push('identity declaration');
  if (isOperator && !c.operatorAuthority) consentMissing.push('authorised representative declaration');
  if (!c.dataProcessing) consentMissing.push('data processing consent');
  if (!c.terms) consentMissing.push('terms / membership agreement');
  if (consentMissing.length > 0) {
    formError.textContent = `Please confirm: ${consentMissing.join(', ')}.`;
    ok = false;
  }
  return ok;
}

function readForm() {
  const data = new FormData(form);
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  const get = (k) => trim(data.get(k)) || undefined;
  const num = (k) => (data.get(k) ? Number(data.get(k)) : undefined);
  const bool = (k) => data.get(k) === 'on';

  const tab = form.dataset.tab === 'operator' ? 'operator' : 'guide';

  // Capture the consent record + the actual on-screen wording so the
  // server can store it for evidentiary purposes (matches legal-
  // hardening from migration 0042). textOf() reads the visible <span>
  // adjacent to each checkbox so future copy changes flow through to
  // the audit record automatically.
  const textOf = (name) => {
    const cb = form.elements.namedItem(name);
    if (!cb) return '';
    const span = cb.parentElement?.querySelector('span');
    return (span?.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const consent = {
    terms: bool('consent_terms'),
    privacy: bool('consent_terms'),         // terms checkbox covers both per copy
    acceptableUse: bool('consent_terms'),   // same
    dataProcessing: bool('consent_data'),
    identityDeclaration: bool('consent_identity'),
    operatorAuthority: bool('consent_authority'),
    confirmedAge18: bool('consent_age'),
    text: {
      age: textOf('consent_age'),
      identity: textOf('consent_identity'),
      authority: textOf('consent_authority'),
      data: textOf('consent_data'),
      terms: textOf('consent_terms'),
    },
  };

  if (tab === 'operator') {
    return {
      applicationType: 'operator',
      operatorName: get('operatorName'),
      email: get('operatorEmail'),
      firstName: get('operatorFirstName'),
      lastName: get('operatorLastName'),
      city: get('operatorCity'),
      yearsGuiding: num('operatorYears'),
      website: get('operatorWebsite'),
      toursOffered: get('operatorTours'),
      specialties: get('operatorSpecialties'),
      additionalInfo: get('operatorAbout'),
      consent,
      _hp: data.get('hp_company'),
    };
  }

  return {
    applicationType: 'guide',
    email: get('email'),
    firstName: get('firstName'),
    lastName: get('lastName'),
    city: get('city'),
    yearsGuiding: num('yearsGuiding'),
    website: get('website'),
    previousCompanies: get('previousCompanies'),
    toursOffered: get('toursOffered'),
    specialties: get('specialties'),
    additionalInfo: get('additionalInfo'),
    consent,
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
    // Tailor the success copy to the application type so operators see
    // the Stripe-upgrade-next-step expectation set immediately.
    if (values.applicationType === 'operator' && successTitle && successBody) {
      successTitle.textContent = 'Operator application received.';
      successBody.innerHTML =
        'A city admin will review and reply by email. On approval you\'ll ' +
        'receive a temporary password plus a link to ' +
        '<a class="link" href="/upgrade">guild.guide/upgrade</a> to start ' +
        'your Stripe subscription (€5/week or €200/year). The first 30 ' +
        'days are free at no charge; cancel any time during the trial.';
    } else if (successBody) {
      successBody.innerHTML =
        'A city admin will review and reply by email. On approval you\'ll ' +
        'receive a temporary password plus a link to subscribe — €1/week ' +
        'or €40/year, and the first 30 days are free.';
    }
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    formError.textContent = err.message;
    resetTurnstile();
    setLoading(false);
  }
});

// Live email validation feedback on the operator email field (the
// guide email already has its own listener below).
const opEmail = form.elements.operatorEmail;
if (opEmail) {
  opEmail.addEventListener('blur', (e) => {
    const v = e.target.value.trim();
    if (v && !EMAIL_RE.test(v)) {
      setError('operatorEmail', 'That doesn\'t look like a valid email.');
    } else {
      setError('operatorEmail', null);
    }
  });
}

// Live email validation feedback as the user types.
form.elements.email.addEventListener('blur', (e) => {
  const v = e.target.value.trim();
  if (v && !EMAIL_RE.test(v)) {
    setError('email', 'That doesn’t look like a valid email.');
  } else {
    setError('email', null);
  }
});
