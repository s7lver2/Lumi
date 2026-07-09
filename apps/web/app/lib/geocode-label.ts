// apps/web/app/lib/geocode-label.ts
export interface MapboxFeature {
  text: string;
  context?: { id: string; text: string }[];
}

export function formatMapboxLabel(feature: MapboxFeature): string {
  const region = feature.context?.find((c) => c.id.startsWith("region"))?.text;
  const country = feature.context?.find((c) => c.id.startsWith("country"))?.text;
  return [feature.text, region, country].filter(Boolean).join(", ");
}

export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
}

export function formatNominatimLabel(addr: NominatimAddress): string {
  const locality = addr.city ?? addr.town ?? addr.village;
  return [locality, addr.state, addr.country].filter(Boolean).join(", ");
}