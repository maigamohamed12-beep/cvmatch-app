// Lazily initialized, and a complete no-op if SENTRY_DSN isn't set - so
// this stays entirely optional and never breaks anything for a deployment
// that hasn't configured it yet.
let sentry = null;
let initTried = false;

function getSentry() {
  if (initTried) return sentry;
  initTried = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const Sentry = require("@sentry/node");
    Sentry.init({ dsn, tracesSampleRate: 0 });
    sentry = Sentry;
  } catch (err) {
    console.error("Sentry init failed", err);
  }
  return sentry;
}

// Always logs to the console too (so Vercel's own Runtime Logs still show
// everything as before) and additionally reports to Sentry when configured.
// Awaited by callers and flushes immediately: a Vercel function's process
// can freeze right after the response is sent, before Sentry's background
// send would otherwise have gone out.
async function reportError(context, err, extra) {
  console.error(context, err);
  const Sentry = getSentry();
  if (!Sentry) return;
  try {
    // Supabase/Postgrest errors are plain objects ({message, details, hint,
    // code}), not Error instances - build a proper Error from .message so
    // Sentry gets a readable title instead of "[object Object]", and keep
    // the raw error alongside in extras either way.
    const asError = err instanceof Error ? err : new Error((err && err.message) || context);
    Sentry.withScope((scope) => {
      scope.setTag("context", context);
      scope.setExtras(Object.assign({ rawError: err }, extra || {}));
      Sentry.captureException(asError);
    });
    await Sentry.flush(2000);
  } catch (flushErr) {
    console.error("Sentry report failed", flushErr);
  }
}

module.exports = { reportError };
