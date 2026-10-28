-- Trigram similarity for listing search (title, town). Must exist before 0001's GIN indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
