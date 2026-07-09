// db/migrations/1720600000000_indexed_images_image_path.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images ADD COLUMN image_path text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images DROP COLUMN image_path;`);
};