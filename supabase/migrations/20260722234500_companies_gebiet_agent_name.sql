-- Agent name for the Gebiet code, denormalized from the VIS import (the
-- "NAME" rep column). No agent profiles with matching `gebiet` exist yet
-- (M2+), so this stands in until profiles.gebiet can be joined instead.
alter table companies add column gebiet_agent_name text;
