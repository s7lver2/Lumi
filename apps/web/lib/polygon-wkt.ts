// apps/web/lib/polygon-wkt.ts
// Extracted from the inline WKT-building template literal that was
// duplicated between apps/web/app/api/areas/route.ts and the reuse-estimate
// query — same exact format Postgres/PostGIS's ST_GeomFromText/
// ST_GeogFromText expect, already proven working there.
export function polygonToWkt(polygon: [number, number][]): string {
  return `POLYGON((${polygon.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;
}
