// db/migrations/1721900000000_indexed_points_embedding_nullable.js
exports.shorthands = undefined;

// indexed_points.embedding was declared NOT NULL in
// db/migrations/1720500000000_search_retrieval_indexes.js, back when the
// only retrieval model was Lumi Preview and every row was expected to carry
// an `embedding` value. Since 1721700000000_lumi2_embeddings.js added the
// nullable `embedding_lumi2` column, a row indexed with the "lumi-2" model
// only populates `embedding_lumi2` and leaves `embedding` NULL — which
// violates this NOT NULL constraint and hard-fails insertIndexedPoints for
// lumi-2 rows. This was caught live-verifying the worker's write path
// (Task 4) against a real throwaway Postgres. `indexed_images.embedding`
// does not have this problem — it was already nullable — so this migration
// only touches indexed_points.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_points ALTER COLUMN embedding DROP NOT NULL;`);
};

// NOTE: restoring NOT NULL here is a best-effort rollback, not a guaranteed
// one. If any lumi-2 rows with a NULL `embedding` (and only `embedding_lumi2`
// set) exist by the time this `down` runs, `SET NOT NULL` will fail with a
// "column contains null values" error, since Postgres has no way to
// reconcile that data loss automatically. This is an accepted tradeoff for
// a rarely-exercised rollback path; resolving it (e.g. backfilling or
// deleting those rows first) is left to whoever runs the rollback.
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_points ALTER COLUMN embedding SET NOT NULL;`);
};
