const PHENOMENON_KEYWORDS = {
  flood: ["flood", "flooding", "waterlogging", "inundation", "ndwi", "water extent"],
  crop_stress: ["crop", "agriculture", "vegetation", "ndvi", "drought", "soil moisture", "farm"],
  deforestation: ["forest", "deforest", "canopy", "tree cover", "land cover"],
  glacial_lake: ["glacier", "glacial", "lake", "snow"],
};

const LOCATION_FILLER = /\b(show|find|detect|analyze|analyse|measure|check|monitor|query|the|latest|extent|change|stress|in|near|around|at|for|of|on)\b/gi;

const cleanRegion = (value) =>
  value
    .replace(LOCATION_FILLER, " ")
    .replace(/[,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Extracts only the user's location and requested analysis type.
 * It never assigns coordinates, measurements, confidence, or satellite data.
 */
export const extractRuleBasedIntent = (rawQueryText) => {
  const text = typeof rawQueryText === "string" ? rawQueryText : "";
  const lower = text.toLowerCase();
  const phenomenon = Object.entries(PHENOMENON_KEYWORDS).find(([, words]) =>
    words.some((word) => lower.includes(word))
  )?.[0] || "unknown";

  const region = cleanRegion(
    text
      .replace(/\b(?:flooding|waterlogging|inundation|deforestation|glacial lake|crop stress)\b/gi, "")
      .replace(/\b(?:ndvi|ndwi)\b/gi, "")
  );

  return { region: region || null, phenomenon };
};