// apps/web/app/components/widgets/types.ts
export interface Widget {
  id: string;
  title: string;
  icon: JSX.Element;
  /** How many grid columns this widget occupies when expanded (spec §6.1's bento layout). */
  colSpan: 1 | 2 | 4;
  /** True for widgets whose model isn't installed/active yet — rendered blurred with an unlock CTA. */
  locked: boolean;
  /** Geolocalización and Metadatos EXIF start expanded (always-active, no lock); locked widgets start collapsed. */
  defaultExpanded: boolean;
  render: () => JSX.Element;
  /** Shown as an InfoTooltip next to the title in WidgetGrid's own header
   * row — widgets themselves no longer render their own internal
   * icon+title+tooltip header (spec: docs/superpowers/specs/2026-07-21-
   * results-widgets-popup-and-per-candidate-refine-design.md). */
  tooltip?: string;
}