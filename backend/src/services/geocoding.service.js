import axios from "axios";

const coordinatePattern = /([+-]?\d+(?:\.\d+)?)\s*([NS])?\s*,\s*([+-]?\d+(?:\.\d+)?)\s*([EW])?/i;

export const parseCoordinates = (value) => {
  if (typeof value !== "string") return null;

  const match = value.match(coordinatePattern);
  if (!match) return null;

  let lat = Number(match[1]);
  let lng = Number(match[3]);

  if (match[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (match[2]?.toUpperCase() === "N") lat = Math.abs(lat);
  if (match[4]?.toUpperCase() === "W") lng = -Math.abs(lng);
  if (match[4]?.toUpperCase() === "E") lng = Math.abs(lng);

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng, displayName: `${lat}, ${lng}` };
};

export const extractRegionName = (value) => {
  if (typeof value !== "string") return null;

  const match = value.match(
    /(?:\d+(?:\.\d+)?\s*[NS]?\s*,\s*\d+(?:\.\d+)?\s*[EW]?)\s+in\s+([^?.]+?)(?:[?.]|$)/i
  );

  return match?.[1]?.trim() || null;
};

/**
 * @description Converts a place name into coordinates using OpenStreetMap's
 * Nominatim API — free, no API key required. Used as a fallback/complement
 * to whatever region name the LLM (or the rule-based matcher) extracts from
 * a user's query, so we can center the satellite data fetch on a real
 * latitude/longitude instead of a hardcoded demo location.
 *
 * Nominatim's usage policy caps requests at ~1/second and asks for a
 * descriptive User-Agent — both are respected here. For production traffic
 * beyond light use, self-hosting Nominatim or using a paid geocoder is
 * recommended instead of hammering the public instance.
 * @param {string} placeName - e.g. "Supaul, Bihar"
 * @returns {Promise<{lat: number, lng: number, displayName: string} | null>}
 * @access Private
 */
export const geocodePlace = async (placeName) => {
  if (!placeName || !placeName.trim()) return null;

  const coordinates = parseCoordinates(placeName);
  if (coordinates) return coordinates;

  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: placeName,
        format: "json",
        limit: 1,
      },
      headers: {
        // Nominatim's usage policy requires a real identifying User-Agent.
        "User-Agent": "SatQueryAI/1.0 (SIH26167 hackathon project)",
      },
      timeout: 8000,
    });

    const result = response.data?.[0];
    if (!result) return null;

    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
    };
  } catch (err) {
    console.warn(`Geocoding failed for "${placeName}":`, err.message);
    return null;
  }
};