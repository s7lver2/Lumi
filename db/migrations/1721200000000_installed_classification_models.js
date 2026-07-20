exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE installed_classification_models (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id     text NOT NULL,
      manifest     jsonb NOT NULL,
      active       boolean NOT NULL DEFAULT true,
      installed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX installed_classification_models_model_id_active_idx
      ON installed_classification_models (model_id, active);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE installed_classification_models;`);
};