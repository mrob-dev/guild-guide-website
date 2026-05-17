// Guild admin dashboard — single-page surface for city admins.
//
// Auth: Supabase email + password sign-in. After auth, the script reads
//       the user's `guide_profiles.role` and gates the dashboard view
//       to admin / moderator only — non-staff sessions get signed out.
//
// Views: Overview / Applications / Users / Activity.
//   * Overview / Users / Activity load via SECURITY DEFINER RPCs added in
//     migration 0041_admin_dashboard.sql. Each RPC re-checks is_admin().
//   * Applications still queries guide_applications directly — RLS on
//     that table already restricts SELECT to admins.
//
// Approve: POST to /functions/v1/approve-application with the user's
// session access token. Edge Function provisions the auth user, emails
// the temp password, and flips the application row to approved.
//
// Reject: POST to /functions/v1/reject-application with optional reason.

(function () {
  'use strict';

  var SUPABASE_URL = window.GUILD_SUPABASE_URL || '';
  var SUPABASE_ANON_KEY = window.GUILD_SUPABASE_ANON_KEY || '';

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
  var navBtns = document.querySelectorAll('.admin-nav__btn');
  var rejectDialog = document.getElementById('reject-dialog');
  var rejectForm = document.getElementById('reject-form');
  var rejectCancel = document.getElementById('reject-cancel');
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Overview refs
  var overviewStatus = document.getElementById('overview-status');
  var metricsGrid = document.getElementById('metrics-grid');
  var overviewGenerated = document.getElementById('overview-generated');

  // Users refs
  var usersFilter = document.getElementById('users-filter');
  var usersStatus = document.getElementById('users-status');
  var usersTbody = document.querySelector('#users-table tbody');

  // Activity refs
  var activityStatus = document.getElementById('activity-status');
  var activityFeed = document.getElementById('activity-feed');

  var currentStatus = 'pending';
  var currentView = 'overview';
  var currentSession = null;
  var pendingRejectId = null;
  var usersDebounceHandle = null;

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
        switchView('overview');
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
        if (res.error) setSignInError(res.error.message || 'Sign in failed.');
      })
      .finally(function () { signinBtn.disabled = false; });
  });

  signOutBtn.addEventListener('click', function () { sb.auth.signOut(); });

  // ── View switcher ─────────────────────────────────────────────────
  navBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var v = btn.dataset.view;
      if (!v || v === currentView) return;
      switchView(v);
    });
  });

  function switchView(view) {
    currentView = view;
    navBtns.forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    ['overview', 'applications', 'users', 'activity'].forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (el) el.hidden = v !== view;
    });
    if (view === 'overview') loadMetrics();
    if (view === 'applications') loadApplications();
    if (view === 'users') loadUsers();
    if (view === 'activity') loadActivity();
  }

  // ── Overview: metrics ─────────────────────────────────────────────
  function loadMetrics() {
    overviewStatus.textContent = 'Loading metrics…';
    metricsGrid.innerHTML = '';
    sb.rpc('admin_metrics').then(function (res) {
      if (res.error) {
        overviewStatus.textContent = 'Could not load metrics — ' + res.error.message;
        return;
      }
      overviewStatus.textContent = '';
      renderMetrics(res.data || {});
    });
  }

  function renderMetrics(m) {
    var profiles = m.profiles || {};
    var activity = m.activity || {};
    var apps = m.apps || {};
    var msgs = m.msgs || {};
    var forum = m.forum || {};
    var jobs = m.jobs || {};

    // Group: cards in three rows — Members, Activity, Engagement.
    var groups = [
      {
        title: 'Members',
        cards: [
          { value: profiles.total, label: 'Total profiles' },
          { value: profiles.approved, label: 'Approved' },
          { value: profiles.pending, label: 'Pending', tone: 'warn' },
          { value: profiles.suspended, label: 'Suspended', tone: 'err' },
          { value: profiles.operators, label: 'Operators', tone: 'gold' },
          { value: profiles.paid_guides, label: 'Paid guides', tone: 'teal' },
        ],
      },
      {
        title: 'Activity (last sign-in)',
        cards: [
          { value: activity.dau, label: 'Active · 24h' },
          { value: activity.wau, label: 'Active · 7d' },
          { value: activity.mau, label: 'Active · 30d' },
          { value: activity.never_signed_in, label: 'Never signed in', tone: 'warn' },
        ],
      },
      {
        title: 'Applications',
        cards: [
          { value: apps.app_pending, label: 'Pending', tone: 'warn' },
          { value: apps.app_approved, label: 'Approved' },
          { value: apps.app_rejected, label: 'Rejected', tone: 'err' },
          { value: apps.app_last_week, label: 'Last 7 days' },
          { value: apps.app_last_month, label: 'Last 30 days' },
        ],
      },
      {
        title: 'Engagement',
        cards: [
          { value: msgs.msg_24h, label: 'Messages · 24h' },
          { value: msgs.msg_7d, label: 'Messages · 7d' },
          { value: msgs.msg_authors_7d, label: 'Senders · 7d' },
          { value: forum.posts_7d, label: 'Forum threads · 7d' },
          { value: jobs.jobs_active, label: 'Active job posts', tone: 'teal' },
          { value: jobs.jobs_7d, label: 'Job posts · 7d' },
        ],
      },
    ];

    var html = '';
    groups.forEach(function (g) {
      html += '<div class="metrics-group"><p class="metrics-group__title">' + g.title + '</p><div class="metrics-row">';
      g.cards.forEach(function (c) {
        html += '<div class="metric-card metric-card--' + (c.tone || 'neutral') + '">' +
          '<p class="metric-card__value">' + fmtNum(c.value) + '</p>' +
          '<p class="metric-card__label">' + escapeHtml(c.label) + '</p>' +
        '</div>';
      });
      html += '</div></div>';
    });
    metricsGrid.innerHTML = html;

    if (m.generated_at) {
      overviewGenerated.textContent = 'Generated ' + new Date(m.generated_at).toLocaleString();
    }
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return '—';
    n = Number(n);
    if (!isFinite(n)) return '—';
    if (n >= 1000) return n.toLocaleString();
    return String(n);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    var t = new Date(d);
    if (isNaN(t.getTime())) return '—';
    return t.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function fmtRelative(d) {
    if (!d) return '—';
    var t = new Date(d).getTime();
    if (isNaN(t)) return '—';
    var diff = (Date.now() - t) / 1000;
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd ago';
    if (diff < 30 * 86400) return Math.floor(diff / (7 * 86400)) + 'w ago';
    return Math.floor(diff / (30 * 86400)) + 'mo ago';
  }

  // ── Users ─────────────────────────────────────────────────────────
  function loadUsers() {
    usersStatus.textContent = 'Loading users…';
    usersTbody.innerHTML = '';

    var fd = new FormData(usersFilter);
    var q = (fd.get('q') || '').toString().trim();
    var role = (fd.get('role') || '').toString();
    var status = (fd.get('status') || '').toString();

    sb.rpc('admin_user_list', {
      p_search: q || null,
      p_role:   role || null,
      p_status: status || null,
      p_limit:  100,
      p_offset: 0,
    }).then(function (res) {
      if (res.error) {
        usersStatus.textContent = 'Could not load — ' + res.error.message;
        return;
      }
      var rows = res.data || [];
      if (rows.length === 0) {
        usersStatus.textContent = 'No users match.';
        return;
      }
      usersStatus.textContent = rows.length + (rows.length === 100 ? '+ ' : ' ') + 'user' + (rows.length === 1 ? '' : 's');
      usersTbody.innerHTML = rows.map(renderUserRow).join('');
    });
  }

  function renderUserRow(r) {
    var tier = r.role === 'admin' ? 'Admin'
      : r.role === 'moderator' ? 'Moderator'
      : r.is_operator ? 'Operator'
      : r.is_paid_guide ? 'Paid guide'
      : 'Guide';
    var tierClass = tier.toLowerCase().replace(/\s+/g, '-');

    var statusClass = 'pill-' + (r.approval_status || 'unknown');
    return '<tr>' +
      '<td>' + escapeHtml(r.full_name || '—') + '</td>' +
      '<td class="mono">' + escapeHtml(r.email || '—') + '</td>' +
      '<td>' + escapeHtml(r.base_city || '—') + '</td>' +
      '<td><span class="user-tier user-tier--' + tierClass + '">' + tier + '</span></td>' +
      '<td><span class="user-status ' + statusClass + '">' + escapeHtml(r.approval_status || '—') + '</span></td>' +
      '<td title="' + escapeHtml(fmtDateTime(r.last_sign_in_at)) + '">' + escapeHtml(fmtRelative(r.last_sign_in_at)) + '</td>' +
      '<td title="' + escapeHtml(fmtDateTime(r.last_message_at)) + '">' + escapeHtml(fmtRelative(r.last_message_at)) + '</td>' +
      '<td class="num">' + escapeHtml(String(r.message_count || 0)) + '</td>' +
    '</tr>';
  }

  if (usersFilter) {
    usersFilter.addEventListener('input', function () {
      if (usersDebounceHandle) clearTimeout(usersDebounceHandle);
      usersDebounceHandle = setTimeout(loadUsers, 250);
    });
    usersFilter.addEventListener('change', loadUsers);
    usersFilter.addEventListener('submit', function (ev) {
      ev.preventDefault();
      loadUsers();
    });
  }

  // ── Activity feed ─────────────────────────────────────────────────
  function loadActivity() {
    activityStatus.textContent = 'Loading…';
    activityFeed.setAttribute('aria-busy', 'true');
    activityFeed.innerHTML = '';

    sb.rpc('admin_recent_activity', { p_limit: 80 }).then(function (res) {
      activityFeed.setAttribute('aria-busy', 'false');
      if (res.error) {
        activityStatus.textContent = 'Could not load — ' + res.error.message;
        return;
      }
      var rows = res.data || [];
      activityStatus.textContent = rows.length === 0 ? 'No activity yet.' : '';
      activityFeed.innerHTML = rows.map(renderActivityRow).join('');
    });
  }

  function renderActivityRow(r) {
    var kind = r.kind || 'event';
    var dotClass = 'activity-dot activity-dot--' + kind.replace(/_/g, '-');
    var kindLabel = kind.replace(/_/g, ' ');
    return '<li class="activity-item">' +
      '<span class="' + dotClass + '" aria-hidden="true"></span>' +
      '<div class="activity-item__body">' +
        '<p class="activity-item__head">' +
          '<span class="activity-item__kind">' + escapeHtml(kindLabel) + '</span>' +
          '<span class="activity-item__time" title="' + escapeHtml(fmtDateTime(r.occurred_at)) + '">' +
            escapeHtml(fmtRelative(r.occurred_at)) +
          '</span>' +
        '</p>' +
        '<p class="activity-item__actor">' + escapeHtml(r.actor || '—') + '</p>' +
        (r.detail ? '<p class="activity-item__detail">' + escapeHtml(r.detail) + '</p>' : '') +
      '</div>' +
    '</li>';
  }

  // ── Applications ──────────────────────────────────────────────────
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

  function renderApplication(app) {
    var li = document.createElement('li');
    li.className = 'app-card';
    li.dataset.appId = app.id;

    var isOperator = app.application_type === 'operator';
    var primaryName = isOperator
      ? (app.operator_name || app.email || 'Unnamed operator')
      : ([app.first_name, app.last_name].filter(Boolean).join(' ') || 'Unnamed');
    var contactSub = isOperator
      ? ([app.first_name, app.last_name].filter(Boolean).join(' ').trim() || app.email || '')
      : (app.email || '');

    var whenLabel = fmtDateTime(app.created_at);

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
