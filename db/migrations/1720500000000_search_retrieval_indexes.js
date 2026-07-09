exports.shorthands = undefined;

// NOTE on why there is no hnsw/ivfflat index here: pgvector hard-caps ANN
// indexes (hnsw and ivfflat) at 2000 dimensions — the vector type itself
// stores up to 16000, but neither index type can be built above 2000
// ("column cannot have more than 2000 dimensions for hnsw index"). MegaLoc's
// embedding is 8448-d, so embedding columns here are NOT ANN-indexable as-is.
// This matches spec §3.3's own original call ("búsqueda por coseno directa,
// sin FAISS/HNSW... no se necesita ANN aproximado todavía") — exact/sequential
// cosine scan is intentional at this scale, not an oversight. Revisit with
// dimensionality reduction or pgvector's binary-quantization support if the
// index grows enough for sequential scan to matter.
exports.up = (pgm) => {
  // Per-pano aggregate descriptor (mean of a pano's heading embeddings),
  // Lumi Preview multi-heading aggregation (spec §15.1). Keyed by pano_id so it
  // dedupes across overlapping areas exactly like indexed_images does.
  pgm.sql(`
    CREATE TABLE indexed_points (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      area_id      uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      pano_id      text NOT NULL UNIQUE,
      location     geography(Point, 4326) NOT NULL,
      embedding    vector(8448) NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX idx_indexed_points_location ON indexed_points USING GIST (location);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS indexed_points;`);
};