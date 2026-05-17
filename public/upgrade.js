// upgrade.js — wires the subscribe form to create-checkout-session.
//
// Reads { email, tier, cadence } from the form and posts to the Edge
// Function, which returns a Stripe Checkout URL we redirect to.
//
// Also toggles the visible price labels + agreement link as the user
// picks tier / cadence (the picker re-uses one form for both tiers).

(function () {
  'use strict';

  var SUPABASE_URL =
    window.GUILD_SUPABASE_URL ||
    'https://nigonhrurkscfjzgbmrr.supabase.co';

  var form = document.getElementById('upgrade-form');
  var emailInput = form.querySelector('input[name="email"]');
  var emailError = form.querySelector('[data-error-for="email"]');
  var formError = document.getElementById('form-error');
  var submitBtn = document.getElementById('submit-btn');

  var tierRadios = form.querySelectorAll('input[name="tier"]');
  var cadenceRadios = form.querySelectorAll('input[name="cadence"]');
  var consentBox = form.querySelector('input[name="consent"]');

  var priceWeeklyGuide = form.querySelector('[data-price-weekly-guide]');
  var priceAnnualGuide = form.querySelector('[data-price-annual-guide]');
  var priceWeeklyOp = form.querySelector('[data-price-weekly-op]');
  var priceAnnualOp = form.querySelector('[data-price-annual-op]');
  var agreementGuide = form.querySelector('[data-agreement-guide]');
  var agreementOperator = form.querySelector('[data-agreement-operator]');

  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  function getRadio(name) {
    for (var i = 0; i < form.length; i++) {
      var el = form[i];
      if (el.name === name && el.checked) return el.value;
    }
    return null;
  }

  function refreshLabels() {
    var cadence = getRadio('cadence');
    var weekly = cadence === 'weekly';
    priceWeeklyGuide.hidden = !weekly;
    priceAnnualGuide.hidden = weekly;
    priceWeeklyOp.hidden = !weekly;
    priceAnnualOp.hidden = weekly;

    var tier = getRadio('tier');
    if (tier === 'operator') {
      agreementGuide.hidden = true;
      agreementOperator.hidden = false;
    } else {
      agreementGuide.hidden = false;
      agreementOperator.hidden = true;
    }
  }

  tierRadios.forEach(function (r) { r.addEventListener('change', refreshLabels); });
  cadenceRadios.forEach(function (r) { r.addEventListener('change', refreshLabels); });
  refreshLabels();

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.classList.toggle('submit--busy', busy);
  }

  function clearErrors() {
    emailError.textContent = '';
    formError.textContent = '';
  }

  function validate() {
    clearErrors();
    var email = emailInput.value.trim();
    if (!email) {
      emailError.textContent = 'Email is required.';
      emailInput.focus();
      return null;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError.textContent = 'Enter a valid email address.';
      emailInput.focus();
      return null;
    }
    if (!consentBox.checked) {
      formError.textContent = 'Please accept the agreement to continue.';
      return null;
    }
    return {
      email: email,
      tier: getRadio('tier') || 'guide',
      cadence: getRadio('cadence') || 'weekly',
    };
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var payload = validate();
    if (!payload) return;

    setBusy(true);
    try {
      var res = await fetch(
        SUPABASE_URL + '/functions/v1/create-checkout-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: payload.email,
            tier: payload.tier,
            cadence: payload.cadence,
            success_url: window.location.origin + '/upgrade?status=success',
            cancel_url: window.location.origin + '/upgrade?status=cancelled',
          }),
        }
      );

      var data = null;
      try { data = await res.json(); } catch (_) { /* leave null */ }

      if (!res.ok || !data || !data.checkout_url) {
        formError.textContent =
          (data && data.error) ||
          'Could not start checkout. Please try again.';
        setBusy(false);
        return;
      }

      window.location.assign(data.checkout_url);
    } catch (err) {
      formError.textContent =
        'Network error. Check your connection and try again.';
      setBusy(false);
    }
  });

  var params = new URLSearchParams(window.location.search);
  var status = params.get('status');
  if (status === 'success') {
    formError.style.color = '#9ec7a8';
    formError.textContent =
      'Payment received. Your tier flips on within a minute — sign in to the app to confirm.';
  } else if (status === 'cancelled') {
    formError.textContent =
      'Checkout cancelled. Your account is unchanged.';
  }
})();
