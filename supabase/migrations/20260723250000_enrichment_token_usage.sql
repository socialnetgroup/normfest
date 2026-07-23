-- M5/§3.2.9 cost discipline: "usage counters in admin" was promised but
-- nothing durable ever stored per-call token usage — the only record was
-- whatever showed up in the Anthropic console, impossible to attribute to
-- a specific batch/company after the fact. Store it directly on the row
-- the analysis produced, so SUM(analysis_input_tokens) is always a real,
-- queryable answer instead of a console-total guess.
alter table company_enrichment
  add column analysis_input_tokens int,
  add column analysis_output_tokens int;
