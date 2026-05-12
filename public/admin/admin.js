// Guild admin dashboard — single-page surface for city admins.
//
// Auth: Supabase email + password sign-in. After auth, the script reads
//       the user's `guide_profiles.role` and gates the dashboard view
//       to admin / moderator only — non-staff sessions get signed out.
//
// Pending applications: SELECT from `guide_applications` where status =
// 'pending'. RLS already restricts this to admins, but the role check
// above is a defence-in-depth.
//
// Approve: POST to /functions/v1/approve-application with the user's
// session access token. Edge Function provisions the auth user, emails
// the temp password, and flips the application row to approved.
//
// Reject: POST to /functions/v1/reject-application with optional reason.
// Edge Function flips the row to rejected and emails the applicant.
//
// Anon key + URL come from inline <script> in index.html.

(function () {
  'use strict';

  var SUPABASE_URL = window.GUILD_SUPABASE_URL || '';
  var SUPABASE_ANON_KEY = window.GUILD_SUPABASE_ANON_KEY || '';

  // Resolve the Supabase SDK. The script tag uses esm.sh's ?bundle flag
  // which exposes a UMD-style global; we read it off the window object.
  var sb = null;

  // ── DOM refs ──────────────────────────────────────────────────────
  var loadingView = document.getElementById('loading-view');
  var signinView = document.getElementById('signin-view');
  var dashboardView = document.getElementById('dashboard-view');
  var signinForm = document.getElementById('signin-form');
  var signinError = document.getElementById('signin-error');
  var signinBtn = document.getElementById('signin-btn');
  var signOutBtn = document.getElementById('sign-out-btn');
  var greeting = document.getElementById('admin-greeting');
  var queueStatus = document.getElementById('queue-status');
  var listEl = document.getElementById('application-list');
  var tabsEl = document.querySelectorAll('.admin-tab');
  var rejectDialog = document.getElementById('reject-dialog');
  var rejectForm = document.getElementById('reject-form');
  var rejectCancel = document.getElementById('reject-cancel');
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  var currentStatus = 'pending';
  var currentSession = null;
  var pendingRejectId = null;

  function show(view) {
    [loadingView, signinView, dashboardView].forEach(function (el) {
      if (el) el.hidden = el !== view;
    });
    if (signOutBtn) signOutBtn.hidden = view !== dashboardView;
  }

  function setSignInError(msg) {
    signinError.textContent = msg || '';
  }

  // ── Boot ─────────────────────────────────────────────────────────
  function boot() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      loadingView.innerHTML =
        '<p>Admin not configured. Paste the Supabase anon key into ' +
        '<code>window.GUILD_SUPABASE_ANON_KEY</code> in index.html.</p>';
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      // SDK still loading; retry shortly.
      setTimeout(boot, 80);
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    sb.auth.getSession().then(function (res) {
      var sess = res && res.data && res.data.session;
      handleAuthChange(sess);
    });

    sb.auth.onAuthStateChange(function (_event, session) {
      handleAuthChange(session);
    });
  }

  function handleAuthChange(session) {
    currentSession = session || null;
    if (!currentSession) {
      show(signinView);
      return;
    }
    // Verify role before showing the dashboard.
    sb.from('guide_profiles')
      .select('role, full_name')
      .eq('user_id', currentSession.user.id)
      .maybeSingle()
      .then(function (res) {
        var p = res && res.data;
        if (!p || (p.role !== 'admin' && p.role !== 'moderator')) {
          setSignInError('This account is not a city admin.');
          sb.auth.signOut();
          show(signinView);
          return;
        }
        greeting.textContent = 'Signed in as ' + (p.full_name || currentSession.user.email);
        show(dashboardView);
        loadApplications();
      });
  }

  // ── Sign-in form ─────────────────────────────────────────────────
  signinForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setSignInError('');
    var email = signinForm.email.value.trim();
    var password = signinForm.password.value;
    if (!email || !password) {
      setSignInError('Email and password required.');
      return;
    }
    signinBtn.disabled = true;
    sb.auth
      .signInWithPassword({ email: email, password: password })
      .then(function (res) {
        if (res.error) {
          setSignInError(res.error.message || 'Sign in failed.');
        }
        // handleAuthChange via onAuthStateChange will take over on success.
      })
      .finally(function () {
        signinBtn.disabled = false;
      });
  });

  // ── Sign out ─────────────────────────────────────────────────────
  signOutBtn.addEventListener('click', function () {
    sb.auth.signOut();
  });

  // ── Tabs ─────────────────────────────────────────────────────────
  tabsEl.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var status = tab.dataset.status;
      if (!status || status === currentStatus) return;
      currentStatus = status;
      tabsEl.forEach(function (t) {
        var active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      loadApplications();
    });
  });

  // ── Applications query ───────────────────────────────────────────
  function loadApplications() {
    queueStatus.textContent = 'Loading…';
    listEl.setAttribute('aria-busy', 'true');
    listEl.innerHTML = '';

    sb.from('guide_applications')
      .select(
        'id, application_type, operator_name, first_name, last_name, email, ' +
          'city, years_guiding, website, previous_companies, tours_offered, ' +
          'specialties, additional_info, status, rejection_reason, created_at'
      )
      .eq('status', currentStatus)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(function (res) {
        listEl.setAttribute('aria-busy', 'false');
        if (res.error) {
          queueStatus.textContent = 'Could not load — ' + res.error.message;
          return;
        }
        var rows = res.data || [];
        if (rows.length === 0) {
          queueStatus.textContent = '';
          listEl.innerHTML =
            '<li class="admin-empty">No ' + currentStatus + ' applications.</li>';
          return;
        }
        queueStatus.textContent =
          rows.length + ' ' + currentStatus + ' application' + (rows.length === 1 ? '' : 's');
        rows.forEach(function (row) {
          listEl.appendChild(renderApplication(row));
        });
      });
  }

  // ── Render one application ───────────────────────────────────────
  function renderApplication(app) {
    var li = document.createElement('li');
    li.className = 'app-card';
    li.dataset.appId = app.id;

    var isOperator = app.application_type === 'operator';
    // For operators, the company is the primary identity. For guides,
    // it's the person's name. Each is displayed with a subtitle showing
    // the contact name (operators) or just the email (guides).
    var primaryName = isOperator
      ? (app.operator_name || app.email || 'Unnamed operator')
      : ([app.first_name, app.last_name].filter(Boolean).join(' ') || 'Unnamed');
    var contactSub = isOperator
      ? ([app.first_name, app.last_name].filter(Boolean).join(' ').trim() || app.email || '')
      : (app.email || '');

    var when = new Date(app.created_at);
    var whenLabel = when.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    li.innerHTML =
      '<div class="app-card__head">' +
      '<div>' +
      '<p class="app-card__name"></p>' +
      '<p class="app-card__email"></p>' +
      '</div>' +
      '<div class="app-card__head-right">' +
      '<span class="app-card__type"></span>' +
      '<p class="app-card__meta"></p>' +
      '</div>' +
      '</div>' +
      '<dl class="app-card__fields"></dl>' +
      '<div class="app-card__actions"></div>';

    li.querySelector('.app-card__name').textContent = primaryName;
    li.querySelector('.app-card__email').textContent = contactSub;
    var typeBadge = li.querySelector('.app-card__type');
    typeBadge.textContent = isOperator ? 'OPERATOR' : 'GUIDE';
    typeBadge.classList.add(isOperator
      ? 'app-card__type--operator'
      : 'app-card__type--guide');
    li.querySelector('.app-card__meta').textContent =
      (app.city || 'Unknown city') + ' · ' + whenLabel;

    var fields = li.querySelector('.app-card__fields');
    var rows;
    if (isOperator) {
      rows = [
        ['Operator', app.operator_name || '—'],
        ['Contact', [app.first_name, app.last_name].filter(Boolean).join(' ') || '—'],
        ['Operator email', app.email || '—'],
        ['Years operating', app.years_guiding != null ? String(app.years_guiding) : '—'],
        ['Website', app.website || '—'],
        ['Tour types', app.tours_offered || '—'],
        ['Specialism', app.specialties || '—'],
        ['About', app.additional_info || '—'],
      ];
    } else {
      rows = [
        ['Years guiding', app.years_guiding != null ? String(app.years_guiding) : '—'],
        ['Website', app.website || '—'],
        ['Companies', app.previous_companies || '—'],
        ['Tours', app.tours_offered || '—'],
        ['Specialties', app.specialties || '—'],
        ['Notes', app.additional_info || '—'],
      ];
    }
    rows.forEach(function (pair) {
      var dt = document.createElement('div');
      dt.className = 'app-card__field';
      dt.innerHTML =
        '<span class="app-card__label"></span>' +
        '<span class="app-card__value"></span>';
      dt.querySelector('.app-card__label').textContent = pair[0];
      dt.querySelector('.app-card__value').textContent = pair[1];
      fields.appendChild(dt);
    });

    var actions = li.querySelector('.app-card__actions');
    if (app.status === 'pending') {
      var approveBtn = makeBtn('Approve', 'app-card__btn--approve');
      approveBtn.addEventListener('click', function () {
        runApprove(app.id, approveBtn);
      });
      var rejectBtn = makeBtn('Reject…', 'app-card__btn--reject');
      rejectBtn.addEventListener('click', function () {
        openRejectDialog(app.id);
      });
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
    } else if (app.status === 'approved') {
      var span = document.createElement('span');
      span.className = 'app-card__status app-card__status--approved';
      span.textContent = 'Approved';
      actions.appendChild(span);
    } else if (app.status === 'rejected') {
      var rspan = document.createElement('span');
      rspan.className = 'app-card__status app-card__status--rejected';
      rspan.textContent = 'Rejected';
      actions.appendChild(rspan);
      if (app.rejection_reason) {
        var reason = document.createElement('p');
        reason.style.cssText =
          'margin: 10px 0 0 0; font-size: 12.5px; color: rgba(255,255,255,0.6); font-style: italic;';
        reason.textContent = '"' + app.rejection_reason + '"';
        actions.parentNode.insertBefore(reason, actions.nextSibling);
      }
    }

    return li;
  }

  function makeBtn(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'app-card__btn ' + cls;
    b.textContent = label;
    return b;
  }

  // ── Approve / Reject ─────────────────────────────────────────────
  function runApprove(applicationId, btn) {
    btn.disabled = true;
    btn.textContent = 'Approving…';
    invokeFunction('approve-application', { applicationId: applicationId })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Approval failed.');
        loadApplications();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Approve';
        queueStatus.textContent = 'Error: ' + (err.message || err);
      });
  }

  function openRejectDialog(applicationId) {
    pendingRejectId = applicationId;
    rejectForm.reset();
    if (typeof rejectDialog.showModal === 'function') {
      rejectDialog.showModal();
    } else {
      var reason = prompt('Reason (optional):') || '';
      runReject(applicationId, reason);
    }
  }

  rejectCancel.addEventListener('click', function () {
    rejectDialog.close();
    pendingRejectId = null;
  });

  rejectForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var reason = rejectForm.reason.value.trim();
    var id = pendingRejectId;
    rejectDialog.close();
    pendingRejectId = null;
    if (!id) return;
    runReject(id, reason);
  });

  function runReject(applicationId, reason) {
    queueStatus.textContent = 'Rejecting…';
    invokeFunction('reject-application', {
      applicationId: applicationId,
      reason: reason || null,
    })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Rejection failed.');
        loadApplications();
      })
      .catch(function (err) {
        queueStatus.textContent = 'Error: ' + (err.message || err);
      });
  }

  // ── Edge Function invoke (with admin JWT) ────────────────────────
  function invokeFunction(name, body) {
    if (!currentSession) {
      return Promise.resolve({ ok: false, error: 'Not signed in.' });
    }
    return fetch(SUPABASE_URL + '/functions/v1/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + currentSession.access_token,
      },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (r.ok) return { ok: true, data: data };
          return { ok: false, error: (data && data.error) || ('HTTP ' + r.status) };
        });
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  boot();
})();
