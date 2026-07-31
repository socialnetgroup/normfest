-- CI #103 failed (2026-07-31) with the exact 57014 statement-timeout symptom
-- again, despite the 45s function-level override added in
-- 20260731010000_fn_refresh_signals_perf_fix.sql. Measured directly right
-- after the failure: a single real call took 32.1s -- under 45s, but the
-- already-documented run-to-run variance for this function (26-77s observed
-- across prior runs, per that migration's own comment) means 45s doesn't
-- leave enough headroom on a slower CI run. Bumping to 75s.
alter function fn_refresh_signals() set statement_timeout = '75s';
