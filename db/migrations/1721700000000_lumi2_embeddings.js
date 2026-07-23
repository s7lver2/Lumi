// db/migrations/1721700000000_lumi2_embeddings.js
exports.shorthands = undefined;

// NOTE on the HNSW indexes this migration does NOT create: the task brief
// this migration was written from asked for
//   CREATE INDEX ... ON indexed_images USING hnsw (embedding vector_cosine_ops)
//   CREATE INDEX ... ON indexed_images USING hnsw (embedding_lumi2 vector_cosine_ops)
//   CREATE INDEX ... ON indexed_points USING hnsw (embedding vector_cosine_ops)
//   CREATE INDEX ... ON indexed_points USING hnsw (embedding_lumi2 vector_cosine_ops)
// This was verified live against pgvector 0.8.5 and every one of these
// statements fails with "column cannot have more than 2000 dimensions for
// hnsw index" — pgvector hard-caps HNSW (and ivfflat) at 2000 dimensions
// for the `vector` type (4000 for `halfvec`), full stop, regardless of
// version. `embedding` is 8448-d (MegaLoc/Lumi Preview) and `embedding_lumi2`
// is 12288-d (Lumi 2, BoQ+DINOv2) — both are far past that ceiling, so none
// of the four requested indexes can ever be built as specified. This exactly
// matches the reasoning already recorded in
// db/migrations/1720500000000_search_retrieval_indexes.js, which deliberately
// skipped an HNSW index on indexed_points.embedding (also 8448-d) for the
// same reason. Only the additive columns from the brief are applied here;
// exact/sequential cosine scan remains the retrieval strategy for both
// models until dimensionality reduction (e.g. matryoshka truncation) makes
// ANN indexing possible — that is out of scope for this task.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images ADD COLUMN embedding_lumi2 vector(12288);`);
  pgm.sql(`ALTER TABLE indexed_points ADD COLUMN embedding_lumi2 vector(12288);`);
  pgm.sql(`ALTER TABLE searches ADD COLUMN query_embedding_lumi2 vector(12288);`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE searches DROP COLUMN query_embedding_lumi2;`);
  pgm.sql(`ALTER TABLE indexed_points DROP COLUMN embedding_lumi2;`);
  pgm.sql(`ALTER TABLE indexed_images DROP COLUMN embedding_lumi2;`);
};
