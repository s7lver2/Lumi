// apps/web/app/lib/draw-circle-mode.ts
//
// Custom "draw a circle" mode for @mapbox/mapbox-gl-draw, written against
// ONLY the documented public mode lifecycle (onSetup/onClick/onMouseMove/
// onStop/toDisplayFeatures/onTrash — see Mapbox's "Custom Draw Modes" docs).
// This intentionally replaces the `mapbox-gl-draw-circle` npm package, which
// hard-pins `@mapbox/mapbox-gl-draw@1.1.1` internals — a different major
// version than the 1.5.x this app uses — and broke draw mode registration
// entirely when merged into a newer MapboxDraw instance.
import * as turf from "@turf/turf";

type Ctx = any;
type State = { polygon: any };

// Typed as `any`: MapboxDraw's official DrawCustomMode<T> type demands an
// exact toDisplayFeatures signature that this plain-object literal (using
// `this`-bound helpers not in TS's DOM lib) can't structurally satisfy —
// the mode object is inherently dynamically dispatched by MapboxDraw itself.
export const CircleMode: any = {
  onSetup(): State {
    const polygon = this.newFeature({
      type: "Feature",
      properties: { isCircle: true, center: [] as number[] },
      geometry: { type: "Polygon", coordinates: [[]] },
    });
    this.addFeature(polygon);
    this.clearSelectedFeatures();
    this.updateUIClasses({ mouse: "add" });
    this.setActionableState({ trash: true });
    return { polygon };
  },

  onClick(state: State, e: any) {
    const center: number[] = state.polygon.properties.center;
    if (center.length === 0) {
      center.push(e.lngLat.lng, e.lngLat.lat);
      return;
    }
    this.updateUIClasses({ mouse: "pointer" });
    this.changeMode("simple_select", { featureIds: [state.polygon.id] });
  },

  onMouseMove(state: State, e: any) {
    this.updateRadius(state, e);
  },

  onDrag(state: State, e: any) {
    this.updateRadius(state, e);
  },

  // Not part of the standard lifecycle map key, but callable via `this` from
  // the handlers above (MapboxDraw binds every key of the mode object, and
  // also exposes them all as `this.<key>` on the shared mode context).
  updateRadius(state: State, e: any) {
    const center: number[] = state.polygon.properties.center;
    if (center.length === 0) return;
    const radiusKm = Math.max(
      turf.distance(turf.point(center), turf.point([e.lngLat.lng, e.lngLat.lat]), { units: "kilometers" }),
      0.01
    );
    const circleFeature = turf.circle(center, radiusKm, { steps: 64, units: "kilometers" });
    state.polygon.incomingCoords(circleFeature.geometry.coordinates);
  },

  onStop(state: State) {
    this.activateUIButton();
    const ring = state.polygon.getCoordinates()[0];
    if (state.polygon.properties.center.length === 0 || !ring || ring.length < 4) {
      this.deleteFeature([state.polygon.id], { silent: true });
    }
  },

  toDisplayFeatures(state: State, geojson: any, display: (g: any) => void) {
    const isActivePolygon = geojson.properties.id === state.polygon.id;
    geojson.properties.active = isActivePolygon ? "true" : "false";
    display(geojson);
  },

  onTrash(state: State) {
    this.deleteFeature([state.polygon.id], { silent: true });
  },
};
