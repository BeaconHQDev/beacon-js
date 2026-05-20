/**
 * Beacon SDK — frontend error tracking
 * https://beaconhq.dev
 *
 * Usage:
 *   <script src="beacon.js"></script>
 *   <script>
 *     Beacon.init({ dsn: 'https://pub_KEY@beaconhq.dev/PROJECT_ID' })
 *   </script>
 *
 * DSN format: https://pub_KEY@host/projectId
 */
;(function (global) {
  'use strict'

  // ── State ────────────────────────────────────────────────────────────────────

  var _ingestUrl = null
  var _perfUrl = null
  var _feedbackUrl = null
  var _analyticsUrl = null
  var _analyticsEnabled = false
  var _analyticsSessionId = null
  var _pageStartTime = null
  var _release = null
  var _environment = 'production'
  var _maxBreadcrumbs = 50
  var _user = {}
  var _extra = {}
  var _tags = {}
  var _breadcrumbs = []
  var _initialized = false
  var _replayEnabled = false
  var _replayUrl = null
  var _replaySessionId = null
  var _replayEvents = []
  var _replayFlushTimer = null
  var _hasInteracted = false

  // ── DSN parsing ──────────────────────────────────────────────────────────────

  function parseDsn(dsn) {
    // https://pub_KEY@host/projectId
    var match = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(.+)$/)
    if (!match) throw new Error('[Beacon] Invalid DSN: ' + dsn)
    var key = match[1]
    var host = match[2]
    var projectId = match[3]
    // Route ingest traffic to relay. api.beaconhq.dev DSNs (legacy) are transparently upgraded.
    var ingestHost = (host === 'api.beaconhq.dev' || host === 'beaconhq.dev')
      ? 'relay.beaconhq.dev'
      : host
    var base = 'https://' + ingestHost
    var qs = '?key=' + encodeURIComponent(key) + '&project=' + encodeURIComponent(projectId)
    return {
      ingest: base + '/api/ingest' + qs,
      perf: base + '/api/perf' + qs,
      feedback: base + '/api/feedback' + qs,
      replay: base + '/api/replay' + qs,
      analytics: base + '/api/analytics' + qs,
    }
  }

  // ── Breadcrumbs ──────────────────────────────────────────────────────────────

  function addBreadcrumb(crumb) {
    crumb.timestamp = new Date().toISOString()
    _breadcrumbs.push(crumb)
    if (_breadcrumbs.length > _maxBreadcrumbs) {
      _breadcrumbs.shift()
    }
  }

  // ── Stack parsing ────────────────────────────────────────────────────────────

  function parseStack(errorOrStack) {
    var stack = typeof errorOrStack === 'string' ? errorOrStack : (errorOrStack && errorOrStack.stack) || ''
    if (!stack) return []
    var frames = []
    var lines = stack.split('\n')
    var re = /^\s*at (?:(.*?) \()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(re)
      if (!m) continue
      frames.push({
        function: m[1] || '<anonymous>',
        file: m[2] || '',
        line: m[3] ? parseInt(m[3], 10) : null,
        col: m[4] ? parseInt(m[4], 10) : null,
      })
    }
    return frames
  }

  // ── Transport ────────────────────────────────────────────────────────────────

  function send(payload) {
    if (!_ingestUrl) return
    var json = JSON.stringify(payload)
    // Use fetch with credentials: 'omit' — ingest is API-key auth only (no cookies needed).
    // keepalive: true survives page unload the same way sendBeacon does, without the
    // browser-mandated credentials:include that sendBeacon carries (incompatible with CORS *).
    fetch(_ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: true,
      credentials: 'omit',
    }).catch(function () {})
  }

  // ── Core capture ─────────────────────────────────────────────────────────────

  function buildPayload(type, message, level, stack, extra) {
    return {
      type: type,
      level: level,
      message: message,
      stack: stack,
      stack_frames: parseStack(stack),
      url: global.location ? global.location.href : null,
      user_agent: navigator.userAgent || null,
      user_id_ext: _user.id || null,
      user_email: _user.email || null,
      user_name: _user.name || null,
      release: _release,
      environment: _environment,
      sdk_version: '1.0.0',
      tags: merge({}, _tags),
      extra: merge(merge({}, _extra), extra || {}),
      breadcrumbs: _breadcrumbs.slice(),
    }
  }

  function merge(target, source) {
    for (var k in source) {
      if (Object.prototype.hasOwnProperty.call(source, k)) target[k] = source[k]
    }
    return target
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  var Beacon = {}

  Beacon.init = function (opts) {
    opts = opts || {}
    if (!opts.dsn) throw new Error('[Beacon] opts.dsn is required')
    var urls = parseDsn(opts.dsn)
    _ingestUrl = urls.ingest
    _perfUrl = urls.perf
    _feedbackUrl = urls.feedback
    _replayUrl = urls.replay
    _analyticsUrl = urls.analytics
    _release = opts.release || null
    _environment = opts.environment || 'production'
    _maxBreadcrumbs = opts.maxBreadcrumbs != null ? opts.maxBreadcrumbs : 50
    _replayEnabled = !!opts.replay
    _analyticsEnabled = !!opts.analytics
    _initialized = true
    instrument()
    if (_replayEnabled) instrumentReplay()
    if (_analyticsEnabled) instrumentAnalytics()
  }

  Beacon.setUser = function (user) {
    _user = user || {}
  }

  Beacon.setExtra = function (key, value) {
    _extra[key] = value
  }

  Beacon.setTag = function (key, value) {
    _tags[key] = value
  }

  Beacon.captureError = function (error, extraContext) {
    if (!_initialized) return
    var message = (error && error.message) || String(error)
    var type = (error && error.name) || 'Error'
    var stack = (error && error.stack) || ''
    send(buildPayload(type, message, 'error', stack, extraContext))
  }

  Beacon.captureMessage = function (message, level) {
    if (!_initialized) return
    send(buildPayload('Message', message, level || 'info', '', null))
  }

  /** Vue 3 plugin — call Beacon.install(app) or app.use(Beacon) */
  Beacon.install = function (app) {
    app.config.errorHandler = function (err, _vm, info) {
      if (err instanceof Error) {
        Beacon.setExtra('vue_info', info)
        Beacon.captureError(err)
      }
      console.error('[Vue]', err)
    }
  }

  // ── Auto-instrumentation ─────────────────────────────────────────────────────

  function instrument() {
    instrumentGlobalErrors()
    instrumentConsole()
    instrumentNavigation()
    instrumentXhr()
    instrumentFetch()
    instrumentWebVitals()
  }

  function instrumentGlobalErrors() {
    var prevOnError = global.onerror
    global.onerror = function (message, source, lineno, colno, error) {
      addBreadcrumb({ category: 'error', message: message, level: 'error' })
      if (error) {
        Beacon.captureError(error)
      } else {
        send(buildPayload('Error', message, 'error', source + ':' + lineno + ':' + colno, null))
      }
      if (typeof prevOnError === 'function') prevOnError.apply(global, arguments)
      return false
    }

    var prevOnUnhandled = global.onunhandledrejection
    global.onunhandledrejection = function (event) {
      var reason = event && event.reason
      addBreadcrumb({ category: 'promise', message: 'Unhandled rejection', level: 'error' })
      if (reason instanceof Error) {
        Beacon.captureError(reason)
      } else {
        send(buildPayload('UnhandledRejection', String(reason), 'error', '', null))
      }
      if (typeof prevOnUnhandled === 'function') prevOnUnhandled.call(global, event)
    }
  }

  function instrumentConsole() {
    var levels = ['log', 'info', 'warn', 'error', 'debug']
    levels.forEach(function (level) {
      var orig = console[level]
      if (typeof orig !== 'function') return
      console[level] = function () {
        var args = Array.prototype.slice.call(arguments)
        addBreadcrumb({
          category: 'console',
          level: level === 'log' ? 'debug' : level,
          message: args
            .map(function (a) {
              try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch (e) { return '[object]' }
            })
            .join(' '),
        })
        return orig.apply(console, args)
      }
    })
  }

  function instrumentNavigation() {
    function recordNav(url) {
      addBreadcrumb({ category: 'navigation', level: 'info', message: url })
    }

    var origPush = history.pushState
    history.pushState = function () {
      origPush.apply(history, arguments)
      recordNav(arguments[2] || global.location.href)
    }

    var origReplace = history.replaceState
    history.replaceState = function () {
      origReplace.apply(history, arguments)
      recordNav(arguments[2] || global.location.href)
    }

    global.addEventListener('popstate', function () {
      recordNav(global.location.href)
    })
  }

  function instrumentXhr() {
    if (!global.XMLHttpRequest) return
    var origOpen = XMLHttpRequest.prototype.open
    var origSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function (method, url) {
      this._beaconMethod = method
      this._beaconUrl = url
      return origOpen.apply(this, arguments)
    }

    XMLHttpRequest.prototype.send = function () {
      var self = this
      var method = self._beaconMethod
      var url = self._beaconUrl
      var origOnReadyStateChange = self.onreadystatechange

      self.onreadystatechange = function () {
        if (self.readyState === 4) {
          addBreadcrumb({
            category: 'http',
            level: self.status >= 400 ? 'error' : 'info',
            message: method + ' ' + url + ' → ' + self.status,
            data: { method: method, url: url, status: self.status },
          })
        }
        if (typeof origOnReadyStateChange === 'function') {
          origOnReadyStateChange.apply(self, arguments)
        }
      }

      return origSend.apply(self, arguments)
    }
  }

  function instrumentFetch() {
    if (!global.fetch) return
    var origFetch = global.fetch
    global.fetch = function (input, init) {
      var method = (init && init.method) || 'GET'
      var url = typeof input === 'string' ? input : (input && input.url) || ''
      return origFetch.apply(global, arguments).then(
        function (response) {
          addBreadcrumb({
            category: 'http',
            level: response.status >= 400 ? 'error' : 'info',
            message: method + ' ' + url + ' → ' + response.status,
            data: { method: method, url: url, status: response.status },
          })
          return response
        },
        function (err) {
          addBreadcrumb({
            category: 'http',
            level: 'error',
            message: method + ' ' + url + ' → network error',
            data: { method: method, url: url, error: String(err) },
          })
          throw err
        }
      )
    }
  }

  // ── Perf / Feedback transport ────────────────────────────────────────────────

  function sendTo(url, payload) {
    if (!url) return
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
    }).catch(function () {})
  }

  // ── Web Vitals ───────────────────────────────────────────────────────────────

  function instrumentWebVitals() {
    if (typeof PerformanceObserver === 'undefined') return

    function reportMetric(name, value, rating) {
      sendTo(_perfUrl, {
        name: name,
        value: value,
        rating: rating || null,
        url: global.location ? global.location.href : null,
        user_agent: navigator.userAgent || null,
        user_id_ext: _user.id || null,
        environment: _environment,
        release: _release,
        occurred_at: new Date().toISOString(),
      })
    }

    function rateVital(name, value) {
      if (name === 'LCP') return value < 2500 ? 'good' : value < 4000 ? 'needs-improvement' : 'poor'
      if (name === 'FID' || name === 'INP') return value < 100 ? 'good' : value < 300 ? 'needs-improvement' : 'poor'
      if (name === 'CLS') return value < 0.1 ? 'good' : value < 0.25 ? 'needs-improvement' : 'poor'
      if (name === 'TTFB') return value < 800 ? 'good' : value < 1800 ? 'needs-improvement' : 'poor'
      if (name === 'FCP') return value < 1800 ? 'good' : value < 3000 ? 'needs-improvement' : 'poor'
      return null
    }

    // LCP
    try {
      var lcpObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries()
        var last = entries[entries.length - 1]
        if (last) reportMetric('LCP', last.startTime, rateVital('LCP', last.startTime))
      })
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true })
    } catch (e) {}

    // FID
    try {
      var fidObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries()
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i]
          reportMetric('FID', e.processingStart - e.startTime, rateVital('FID', e.processingStart - e.startTime))
        }
      })
      fidObs.observe({ type: 'first-input', buffered: true })
    } catch (e) {}

    // CLS
    try {
      var clsValue = 0
      var clsObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries()
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].hadRecentInput) clsValue += entries[i].value
        }
      })
      clsObs.observe({ type: 'layout-shift', buffered: true })
      global.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          reportMetric('CLS', clsValue, rateVital('CLS', clsValue))
        }
      })
    } catch (e) {}

    // TTFB + FCP via navigation/paint
    try {
      var navObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries()
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (entry.entryType === 'navigation' && entry.responseStart) {
            reportMetric('TTFB', entry.responseStart, rateVital('TTFB', entry.responseStart))
          }
          if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') {
            reportMetric('FCP', entry.startTime, rateVital('FCP', entry.startTime))
          }
        }
      })
      navObs.observe({ type: 'navigation', buffered: true })
      navObs.observe({ type: 'paint', buffered: true })
    } catch (e) {}
  }

  // ── Session Replay ───────────────────────────────────────────────────────────

  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  function instrumentReplay() {
    if (typeof MutationObserver === 'undefined') return
    _replaySessionId = generateId()

    function flushReplay() {
      if (!_replayEvents.length || !_replayUrl) return
      var payload = {
        session_id: _replaySessionId,
        url: global.location ? global.location.href : null,
        user_id_ext: _user.id || null,
        user_email: _user.email || null,
        user_name: _user.name || null,
        started_at: new Date().toISOString(),
        events: _replayEvents.splice(0),
      }
      sendTo(_replayUrl, payload)
    }

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        _replayEvents.push({
          type: 'dom',
          data: JSON.stringify({ target: m.target.nodeName, type: m.type }),
          occurred_at: new Date().toISOString(),
        })
      })
      if (_replayFlushTimer) clearTimeout(_replayFlushTimer)
      _replayFlushTimer = setTimeout(flushReplay, 5000)
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: false })
    }

    global.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushReplay()
    })
  }

  // ── New public API methods ────────────────────────────────────────────────────

  /**
   * Capture user feedback via a lightweight modal dialog.
   * @param {object} opts  - { eventId, issueId }
   */
  Beacon.showFeedbackDialog = function (opts) {
    opts = opts || {}
    var overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;'

    var box = document.createElement('div')
    box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 28px 24px;width:380px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.18);'
    box.innerHTML = '<p style="font-size:16px;font-weight:600;color:#17171c;margin:0 0 6px;">Send Feedback</p>' +
      '<p style="font-size:13px;color:#75758a;margin:0 0 16px;">Tell us what happened.</p>' +
      '<input id="_bName" placeholder="Your name (optional)" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d9d9dd;border-radius:8px;font-size:13px;font-family:inherit;margin-bottom:10px;">' +
      '<input id="_bEmail" placeholder="Email (optional)" type="email" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d9d9dd;border-radius:8px;font-size:13px;font-family:inherit;margin-bottom:10px;">' +
      '<textarea id="_bComments" placeholder="What happened?" rows="4" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d9d9dd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;margin-bottom:14px;"></textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button id="_bCancel" style="padding:8px 16px;border:1px solid #d9d9dd;border-radius:8px;background:#fff;font-size:13px;font-family:inherit;cursor:pointer;">Cancel</button>' +
        '<button id="_bSubmit" style="padding:8px 18px;border:none;border-radius:8px;background:#1863dc;color:#fff;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;">Submit</button>' +
      '</div>'

    overlay.appendChild(box)
    document.body.appendChild(overlay)

    document.getElementById('_bCancel').onclick = function () { document.body.removeChild(overlay) }
    overlay.onclick = function (e) { if (e.target === overlay) document.body.removeChild(overlay) }

    document.getElementById('_bSubmit').onclick = function () {
      var comments = document.getElementById('_bComments').value.trim()
      if (!comments) return
      sendTo(_feedbackUrl, {
        name: document.getElementById('_bName').value || null,
        email: document.getElementById('_bEmail').value || null,
        comments: comments,
        url: global.location ? global.location.href : null,
        error_event_id: opts.eventId || null,
        issue_id: opts.issueId || null,
      })
      document.body.removeChild(overlay)
    }
  }

  /**
   * Ping a cron monitor to signal it ran successfully.
   * @param {string} monitorId  - The monitor UUID
   * @param {'ok'|'error'|'in_progress'} status
   */
  Beacon.pingMonitor = function (monitorId, status) {
    if (!_ingestUrl) return
    // Extract base URL and key from _ingestUrl
    var base = _ingestUrl.replace(/\/api\/ingest.*$/, '')
    var key = (_ingestUrl.match(/[?&]key=([^&]+)/) || [])[1] || ''
    fetch(base + '/api/crons/' + encodeURIComponent(monitorId) + '/ping?key=' + key + '&status=' + (status || 'ok'), {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
    }).catch(function () {})
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  function getAnalyticsSessionId() {
    try {
      var key = 'bcn_sid'
      var existing = sessionStorage.getItem(key)
      if (existing) return existing
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2)
      sessionStorage.setItem(key, id)
      return id
    } catch (e) {
      return Math.random().toString(36).slice(2)
    }
  }

  function getDeviceType() {
    var ua = navigator.userAgent || ''
    if (/Mobi|Android/i.test(ua)) return 'mobile'
    if (/Tablet|iPad/i.test(ua)) return 'tablet'
    return 'desktop'
  }

  function sendAnalytics(payload) {
    if (!_analyticsUrl) return
    fetch(_analyticsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
    }).catch(function () {})
  }

  function sendPageView(durationMs) {
    if (!_analyticsEnabled || !_analyticsSessionId) return
    var search = global.location ? global.location.search : ''
    var params = new URLSearchParams(search)
    sendAnalytics({
      type: 'pageview',
      session_id: _analyticsSessionId,
      url: global.location ? global.location.href : null,
      path: global.location ? global.location.pathname : null,
      referrer: document.referrer || null,
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      has_interacted: _hasInteracted,
      device: getDeviceType(),
      duration_ms: durationMs || null,
    })
  }

  function instrumentAnalytics() {
    // Headless browsers (Puppeteer, Playwright, Selenium) expose navigator.webdriver = true.
    // Abort silently — no session, no page views.
    if (navigator.webdriver) return

    _analyticsSessionId = getAnalyticsSessionId()
    _pageStartTime = Date.now()

    // Track real human interaction so the server can distinguish engaged visitors
    // from crawlers that slip past UA detection.
    function markInteracted() { _hasInteracted = true }
    document.addEventListener('click', markInteracted, { once: true, passive: true })
    document.addEventListener('keydown', markInteracted, { once: true, passive: true })
    document.addEventListener('scroll', markInteracted, { once: true, passive: true })
    document.addEventListener('touchstart', markInteracted, { once: true, passive: true })

    // Track the path so SPA nav patches only fire when the path actually changes
    var _lastTrackedPath = global.location ? global.location.pathname + global.location.search : null

    // Initial page view
    sendPageView(null)

    // Duration tracking
    function flushDuration() {
      if (!_pageStartTime) return
      var duration = Date.now() - _pageStartTime
      _pageStartTime = null
      sendPageView(duration)
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        flushDuration()
      } else {
        // Tab came back into focus — restart the timer but do NOT send a new page view.
        // The page was already recorded when it was first loaded/navigated to.
        _pageStartTime = Date.now()
      }
    })

    // SPA navigation — wrap history.pushState (may already be wrapped by instrumentNavigation)
    var origPush = history.pushState
    history.pushState = function () {
      origPush.apply(history, arguments)
      var newPath = global.location ? global.location.pathname + global.location.search : null
      // Only track if the path actually changed (guards against Vue Router's initial navigation
      // and other frameworks that call pushState with the same URL)
      if (newPath !== _lastTrackedPath) {
        _lastTrackedPath = newPath
        flushDuration()
        _pageStartTime = Date.now()
        sendPageView(null)
      }
    }

    global.addEventListener('popstate', function () {
      var newPath = global.location ? global.location.pathname + global.location.search : null
      if (newPath !== _lastTrackedPath) {
        _lastTrackedPath = newPath
        flushDuration()
        _pageStartTime = Date.now()
        sendPageView(null)
      }
    })
  }

  /**
   * Track a custom analytics event.
   * @param {string} name  - Event name, e.g. 'Signup', 'Checkout Completed'
   * @param {object} props - Optional properties, e.g. { plan: 'pro', value: 29 }
   */
  Beacon.track = function (name, props) {
    if (!_analyticsEnabled || !_analyticsSessionId) return
    sendAnalytics({
      type: 'event',
      session_id: _analyticsSessionId,
      name: name,
      props: props || null,
      url: global.location ? global.location.href : null,
    })
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  global.Beacon = Beacon

  // CommonJS / ESM compat
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Beacon
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this)
