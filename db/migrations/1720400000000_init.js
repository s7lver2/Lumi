// db/migrations/1720400000000_init.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS vector;`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS postgis;`);

  pgm.sql(`
    CREATE TABLE areas (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name                  text,
      geometry              geometry(Polygon, 4326) NOT NULL,
      area_km2              numeric NOT NULL,
      status                text NOT NULL DEFAULT 'pending',
      points_estimated      integer NOT NULL DEFAULT 0,
      points_captured       integer NOT NULL DEFAULT 0,
      images_embedded       integer NOT NULL DEFAULT 0,
      estimated_cost_usd    numeric,
      actual_cost_usd       numeric,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE indexed_images (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      area_id               uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      pano_id               text NOT NULL,
      heading               smallint NOT NULL,
      location              geography(Point, 4326) NOT NULL,
      street_view_date      date,
      embedding             vector(8448),
      embedded_at           timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now(),
      UNIQUE (pano_id, heading)
    );
  `);
  pgm.sql(
    `CREATE INDEX idx_indexed_images_location ON indexed_images USING GIST (location);`
  );

  pgm.sql(`
    CREATE TABLE searches (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      query_image_path      text NOT NULL,
      query_embedding       vector(8448),
      created_at            timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE search_regions (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      search_id             uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      centroid              geography(Point, 4326) NOT NULL,
      radius_m              integer NOT NULL,
      aggregate_score       numeric NOT NULL,
      candidate_count       integer NOT NULL
    );
  `);

  pgm.sql(`
    CREATE TABLE search_candidates (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      search_id             uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      region_id             uuid REFERENCES search_regions(id) ON DELETE SET NULL,
      indexed_image_id      uuid NOT NULL REFERENCES indexed_images(id),
      similarity_score      numeric NOT NULL,
      verification_score    numeric,
      rank                  integer NOT NULL,
      status                text NOT NULL DEFAULT 'unreviewed'
    );
  `);

  pgm.sql(`
    CREATE TABLE api_usage (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      date                  date NOT NULL DEFAULT current_date,
      street_view_requests  integer NOT NULL DEFAULT 0,
      estimated_cost_usd    numeric NOT NULL DEFAULT 0,
      UNIQUE (date)
    );
  `);

  pgm.sql(`
    CREATE TABLE system_settings (
      key                   text PRIMARY KEY,
      value                 text,
      encrypted_value       bytea,
      is_secret             boolean NOT NULL DEFAULT false,
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS system_settings;`);
  pgm.sql(`DROP TABLE IF EXISTS api_usage;`);
  pgm.sql(`DROP TABLE IF EXISTS search_candidates;`);
  pgm.sql(`DROP TABLE IF EXISTS search_regions;`);
  pgm.sql(`DROP TABLE IF EXISTS searches;`);
  pgm.sql(`DROP TABLE IF EXISTS indexed_images;`);
  pgm.sql(`DROP TABLE IF EXISTS areas;`);
};