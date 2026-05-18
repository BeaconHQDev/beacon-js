# @beaconhq/browser

Beacon browser SDK — lightweight error tracking for web applications. Drop it in via CDN or install from npm for bundler-based projects.

---

## CDN (recommended for most sites)

```html
<script src="https://cdn.beaconhq.dev/beacon.js"></script>
<script>
  Beacon.init({ dsn: 'https://pub_KEY@api.beaconhq.dev/PROJECT_ID' })
</script>
```

Use `beacon.min.js` for a smaller payload:

```html
<script src="https://cdn.beaconhq.dev/beacon.min.js"></script>
```

### Versioned URLs (stable, via jsDelivr)

Publishing an npm release tag (e.g. `v1.0.0`) produces stable, CDN-cached URLs:

```
https://cdn.jsdelivr.net/npm/@beaconhq/browser@1.0.0/beacon.js
https://cdn.jsdelivr.net/npm/@beaconhq/browser@1.0.0/beacon.min.js
```

The `cdn.beaconhq.dev` URLs always point to the latest build.

---

## npm (for bundlers)

```bash
npm install @beaconhq/browser
```

```js
import Beacon from '@beaconhq/browser'

Beacon.init({ dsn: 'https://pub_KEY@api.beaconhq.dev/PROJECT_ID' })
```

---

## Initialization

```js
Beacon.init({
  dsn: 'https://pub_KEY@api.beaconhq.dev/PROJECT_ID', // required
  release: '1.2.3',           // optional — your app version
  environment: 'production',  // optional — default: 'production'
  maxBreadcrumbs: 50,         // optional — default: 50
  replay: false,              // optional — enable session replay (beta)
})
```

**DSN format:** `https://pub_KEY@api.beaconhq.dev/PROJECT_ID`

Find your DSN in the Beacon dashboard under **Project Settings → API Keys**.

---

## API Reference

### `Beacon.setUser(user)`

Associate a user with subsequent events.

```js
Beacon.setUser({ id: '42', email: 'user@example.com', name: 'Jane Doe' })
```

### `Beacon.captureError(error, extraContext?)`

Manually capture a JavaScript `Error`.

```js
try {
  doSomethingRisky()
} catch (err) {
  Beacon.captureError(err, { component: 'Checkout' })
}
```

### `Beacon.captureMessage(message, level?)`

Send a plain message event. Level defaults to `'info'`.

```js
Beacon.captureMessage('Payment flow started', 'info')
Beacon.captureMessage('Stripe webhook missing', 'warning')
```

### `Beacon.install(app)` — Vue 3 plugin

Registers a global Vue error handler that forwards Vue component errors to Beacon.

```js
import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)
app.use(Beacon)   // or: Beacon.install(app)
app.mount('#app')
```

### `Beacon.setExtra(key, value)`

Attach arbitrary metadata to all subsequent events.

```js
Beacon.setExtra('plan', 'pro')
```

### `Beacon.setTag(key, value)`

Attach a searchable tag to all subsequent events.

```js
Beacon.setTag('region', 'us-east-1')
```

### `Beacon.showFeedbackDialog(opts?)`

Show a built-in user feedback modal.

```js
Beacon.showFeedbackDialog({ eventId: 'abc123' })
```

### `Beacon.pingMonitor(monitorId, status)`

Ping a cron monitor (`'ok'`, `'error'`, or `'in_progress'`).

```js
Beacon.pingMonitor('monitor-uuid', 'ok')
```

---

## Auto-instrumentation

Beacon automatically captures:

- **Uncaught exceptions** (`window.onerror`)
- **Unhandled promise rejections** (`unhandledrejection`)
- **Console output** — breadcrumbs for `log`, `info`, `warn`, `error`, `debug`
- **XHR and fetch** — HTTP breadcrumbs with method, URL, and status
- **Navigation** — `pushState`, `replaceState`, `popstate` breadcrumbs
- **Web Vitals** — LCP, FID, CLS, TTFB, FCP (sent to `/api/perf`)

---

## Cloudflare Pages deployment

This repo is served via Cloudflare Pages at `cdn.beaconhq.dev`.

| Setting          | Value                        |
|------------------|------------------------------|
| Build command    | `npm run build`              |
| Output directory | `/` (repo root)              |
| Framework preset | None                         |

`beacon.js` and `beacon.min.js` are served directly from the root of the output directory.

---

## License

MIT — [beaconhq.dev](https://beaconhq.dev)
