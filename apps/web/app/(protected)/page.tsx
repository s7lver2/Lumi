"use client";

import { MapCanvas } from "../components/MapCanvas";

export default function TestPage() {
  return <MapCanvas onReady={(map, prov) => console.log(`Mapa listo con: ${prov}`)} />;
}