-- CLAUDE.md M8 follow-up (2026-07-25, Anis: "brand consumptio profile - do your
-- own research for each specific brand and use this information as preliminary,
-- i will give some input afterwards with sanin and agents"). brand_focus_match
-- (§6) has been permanently dead since brand_consumption_profiles has 0 rows
-- (the brand workshop, §14 item 5, hasn't happened yet). Seeding preliminary,
-- Claude-researched rows so the table isn't empty while the real workshop is
-- still unscheduled — these need the same honesty handling as generated
-- descriptions/representative images (§9): a specific factual claim about a
-- real brand shown directly to agents needs a visible "not yet confirmed by
-- Anis/Sanin" marker until a human signs off.
alter table brand_consumption_profiles
  add column verified boolean not null default false,
  add column source text;
