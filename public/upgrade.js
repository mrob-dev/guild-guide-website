// upgrade.js — wires the Operator upgrade form to the create-checkout-session
// Supabase Edge Function. On success, redirects to the Stripe Checkout URL
// returned by the function. On failure, surfaces the error inline.
//
// The Edge Function ENDPOINT below must point at your deployed Supabase
// project. It's set via a tiny inline config block (window.GUILD_SUPABASE_URL)
// in upgrade.html — if you ever rotate the project ref, only that constant
// changes.

(function () {
  'use strict';

  // Inline-replaceable. Leave as the production project URL — local dev
  // can override by setting window.GUILD_SUPABASE_URL before this script.
  var SUPABASE_URL =
    window.GUILD_SUPABASE_URL ||
    'https://nigonhrurkscfjzgbmrr.supabase.co';

  var form = document.getElementById('upgrade-form');
  var emailInput = form.querySelector('input[name="email"]');
  var emailError = form.querySelector('[data-error-for="email"]');
  var formError = document.getElementById('form-error');
  var submitBtn = document.getElementById('submit-btn');

  // Year stamp in footer (matches apply.js convention).
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

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
    return { email: email };
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
            success_url: window.location.origin + '/upgrade?status=success',
            cancel_url: window.location.origin + '/upgrade?status=cancelled',
          }),
        }
      );

      var data = null;
      try {
        data = await res.json();
      } catch (_) {
        /* leave data = null */
      }

      if (!res.ok || !data || !data.checkout_url) {
        formError.textContent =
          (data && data.error) ||
          'Could not start checkout. Please try again.';
        setBusy(false);
        return;
      }

      // Hand off to Stripe.
      window.location.assign(data.checkout_url);
    } catch (err) {
      formError.textContent =
        'Network error. Check your connection and try again.';
      setBusy(false);
    }
  });

  // Surface success/cancelled flags from Stripe redirect-back.
  var params = new URLSearchParams(window.location.search);
  var status = params.get('status');
  if (status === 'success') {
    formError.style.color = '#9ec7a8';
    formError.textContent =
      'Payment received. Your account flips to Operator within a minute — sign in to the app to confirm.';
  } else if (status === 'cancelled') {
    formError.textContent =
      'Checkout cancelled. Your account is unchanged.';
  }
})();
