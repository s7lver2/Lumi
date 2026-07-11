import { NextResponse } from "next/server";
import { fetchStreetGeometry } from "@netryx/geo-sampling";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bboxStr = searchParams.get("bbox");

  if (!bboxStr) {
    return NextResponse.json({ error: "bbox parameter is required" }, { status: 400 });
  }

  // Parseamos el bbox [minLng, minLat, maxLng, maxLat] a un polígono cerrado simétrico
  const coords = bboxStr.split(",").map(Number);
  if (coords.length !== 4 || coords.some(Number.isNaN)) {
    return NextResponse.json({ error: "Invalid bbox format. Expected minLng,minLat,maxLng,maxLat" }, { status: 400 });
  }

  const [minLng, minLat, maxLng, maxLat] = coords;
  
  // Convertimos a la estructura de anillo cerrado [lng, lat][] requerida por fetchStreetGeometry
  const polygonBoundingRing: [number, number][] = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];

  try {
    const lines = await fetchStreetGeometry(polygonBoundingRing);
    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo obtener la red vial: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}