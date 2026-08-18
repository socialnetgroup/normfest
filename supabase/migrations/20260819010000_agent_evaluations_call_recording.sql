-- QA-Bewertungen: real call picker (Anis, 2026-08-19) - "kada se bira novi
-- formular, i agent da izbaci spisak poziva koji se mogu ocijeniti, sa
-- filterom po danu... da odaberem pozive koje ocijeniti". A new evaluation
-- can now be pre-filled from a real metrike.php CDR row (call_date,
-- call_duration_minutes, call_reference already existed) - this column
-- carries the real recording URL along so a reviewer can listen to the
-- exact call being scored. Nullable and free-text (not validated as a URL)
-- since manual entries (no CDR row picked, e.g. calls before 2026-08-10 -
-- the CDR's own real history start, §14 item 105) never have one.
alter table agent_evaluations add column call_recording_url text;
