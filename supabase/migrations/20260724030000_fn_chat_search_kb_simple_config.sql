-- Companion to 20260724020000: fn_chat_search_kb must query with the same
-- ts config the column was generated with, or every query silently misses.
create or replace function fn_chat_search_kb(p_query text, p_collection text default null)
returns table (collection text, doc_title text, heading text, content text)
language sql
stable
as $$
  select d.collection, d.title, c.heading, c.content
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where d.deleted_at is null
    and (p_collection is null or d.collection = p_collection)
    and c.search_vector @@ websearch_to_tsquery('simple', p_query)
  order by ts_rank(c.search_vector, websearch_to_tsquery('simple', p_query)) desc
  limit 8;
$$;
