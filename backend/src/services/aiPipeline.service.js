import crypto from "crypto";
import { extractIntent, composeAnswer, isLLMConfigured } from "./llm.service.js";
import {
  extractRegionName,
  geocodePlace,
  parseCoordinates,
} from "./geocoding.service.js";
import { getSatelliteIndex } from "./sentinelHub.service.js";
import {
  upsertQueryRecord,
  querySimilarRecords,
  isPineconeConfigured,
} from "./pinecone.service.js";
import { extractRuleBasedIntent } from "./intent.service.js";

/**
 * @description Maps a phenomenon category to the satellite index formula
 * that actually measures it: water-related phenomena use NDWI, vegetation-
 * related ones use NDVI.
 * @param {string} phenomenon
 * @access Private
 */
const indexTypeFor = (phenomenon) =>
  phenomenon === "flood" || phenomenon === "glacial_lake" ? "NDWI" : "NDVI";

/**
 * @description The real, layered analysis pipeline for a user's query:
 *
 *   1. LLM intent extraction (region + phenomenon), with a local intent
 *      extractor as a fallback when the model is unavailable or uncertain.
 *   2. Geocode the extracted region via free Nominatim.
 *   3. If geocoded AND a phenomenon is identified, fetch a REAL NDWI/NDVI
 *      statistic for that location's last 30 days. Never return demo numbers.
 *   4. If Pinecone is configured, embed the query, retrieve similar past
 *      queries as RAG context, then store this query's embedding for future
 *      retrieval.
 *   5. Compose the final answer with the LLM, grounded in whatever real or
 *      fallback numbers we have. Falls back to a templated sentence if the
 *      LLM call fails.
 *
 * Every external call is wrapped so a missing API key or a failed request
 * degrades gracefully to the next fallback layer instead of throwing — the
 * function always returns a usable result.
 *
 * @param {string} rawQueryText
 * @returns {Promise<{
 *   matched: boolean,
 *   parsedIntent: object,
 *   satelliteResult: object,
 *   responseText: string,
 *   status: "resolved"|"low_confidence"|"failed",
 *   vectorId: string|null,
 *   usedRealSatelliteData: boolean,
 *   usedRAGContext: boolean
 * }>}
 * @access Public
 */
export const analyzeQuery = async (rawQueryText) => {

  console.log("\n========== NEW QUERY ==========");
  console.log("Raw Query:", rawQueryText);
  console.log("LLM Configured:", isLLMConfigured());

  // ---- Layer 1: intent extraction ----
  const localIntent = extractRuleBasedIntent(rawQueryText);
  const llmIntent = isLLMConfigured() ? await extractIntent(rawQueryText) : null;
  const intent =
    llmIntent && llmIntent.phenomenon !== "unknown"
      ? { ...localIntent, ...llmIntent, region: llmIntent.region || localIntent.region }
      : localIntent;
  // An address-only query still needs a useful, measurable default. NDVI is
  // the general vegetation index; it is always calculated from the requested
  // coordinates and never comes from a preset result.
  const analysisPhenomenon =
    intent.phenomenon === "unknown" ? "vegetation_index" : intent.phenomenon;
  console.log("Extracted Intent:", intent);

  const region = extractRegionName(rawQueryText) || intent.region || rawQueryText.trim();

  // ---- Layer 2: geocode the region ----
  const coords =
    parseCoordinates(rawQueryText) ||
    (region ? await geocodePlace(region) : null);
  console.log("Geocoded Coordinates:", coords);

  // ---- Layer 3: real satellite index only ----
  let usedRealSatelliteData = false;
  let indexValue = null;
  let source = "Sentinel Hub unavailable";
  let confidence;
  let areaAffectedKm2 = null;
  let changeVsBaselinePct = null;

  if (coords) {
    console.log("Calling Sentinel Hub with:", {
      coords,
      indexType: indexTypeFor(analysisPhenomenon),
    });

    const real = await getSatelliteIndex(coords, indexTypeFor(analysisPhenomenon));

     console.log("Sentinel Hub Result:", real);


    if (real) {
      usedRealSatelliteData = true;
      indexValue = real.meanValue;
      source = "Sentinel-2 L2A (live Statistical API)";
      confidence = 90; // real data — reasonable default; refine once you validate against ground truth
    }
  }

if (!usedRealSatelliteData) {
  return {
    matched: true,
    parsedIntent: {
      region,
      phenomenon: analysisPhenomenon,
      coordinates: coords
        ? {
            lat: coords.lat,
            lng: coords.lng,
          }
        : null,
    },
    satelliteResult: {
      passTimestamp: new Date(),
      source: "Sentinel Hub unavailable",
      metric: indexTypeFor(analysisPhenomenon),
      value: null,
      areaAffectedKm2: null,
      changeVsBaselinePct: null,
      confidence: 0,
    },
    responseText:
      `I identified ${analysisPhenomenon === "vegetation_index" ? "a vegetation index" : analysisPhenomenon.replace("_", " ")} for ${region}, but live satellite data could not be retrieved for this location.`,
    status: "failed",
    vectorId: null,
    usedRealSatelliteData: false,
    usedRAGContext: false,
  };
} else if (!usedRealSatelliteData) {
    confidence = 0;
  }

  // ---- Layer 4: RAG via Pinecone (optional) ----
  let usedRAGContext = false;
  let ragContext = [];
  let vectorId = null;
  let pineconeStored = false;

  if (isPineconeConfigured()) {
    const matches = await querySimilarRecords(rawQueryText, 3);
    ragContext = matches.map((match) => match.fields || match.metadata || match);
    usedRAGContext = ragContext.length > 0;

    vectorId = crypto.randomUUID();
    pineconeStored = await upsertQueryRecord(vectorId, rawQueryText, {
      rawQueryText,
      region,
      phenomenon: analysisPhenomenon,
    });
  }

  // ---- Layer 5: compose the final answer ----
  const llmAnswer = await composeAnswer({
    query: rawQueryText,
    region,
    phenomenon: analysisPhenomenon,
    indexValue,
    source,
    context: ragContext,
  });

  const responseText =
    llmAnswer ||
    `Live ${indexTypeFor(analysisPhenomenon)} data was retrieved for ${region}.`;

  return {
    matched: true,
    parsedIntent: {
      region,
      phenomenon: analysisPhenomenon,
      coordinates: coords ? { lat: coords.lat, lng: coords.lng } : null,
    },
    satelliteResult: {
      passTimestamp: new Date(),
      source,
      metric: indexTypeFor(analysisPhenomenon),
      value: indexValue,
      areaAffectedKm2,
      changeVsBaselinePct,
      confidence,
    },
    responseText,
    status: confidence >= 85 ? "resolved" : confidence > 0 ? "low_confidence" : "failed",
    vectorId,
    usedRealSatelliteData,
    usedRAGContext,
    pineconeStored,
  };
};

