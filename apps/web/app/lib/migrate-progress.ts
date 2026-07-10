// apps/web/app/lib/migrate-progress.ts
// Parsea el stream de node-pg-migrate para contar migraciones aplicadas.
// Solo cuentan líneas que indican aplicación (MIGRATION/(UP)/Migrated),
// no el listado inicial de ficheros.
const MIGRATION_RE = /(\d{13}_[\w-]+)/g;
export function appliedMigrations(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const l of lines) {
    if (!/MIGRATION|Migrated|\(UP\)/i.test(l)) continue;
    for (const m of l.matchAll(MIGRATION_RE)) seen.add(m[1]);
  }
  return [...seen];
}
export function migrateProgress(lines: string[], total: number): { applied: number; total: number; fraction: number } {
  const applied = Math.min(appliedMigrations(lines).length, total);
  return { applied, total, fraction: total ? applied / total : 0 };
}