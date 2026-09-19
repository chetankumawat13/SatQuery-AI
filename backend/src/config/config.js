import dotenv from "dotenv";
dotenv.config();

/**
 * @description Fails fast at startup if the environment variables the app
 * cannot safely run without (MONGO_URI, JWT_SECRET) are missing. Better to
 * crash immediately with a clear message than to run in a broken state.
 * @access Public
 */
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  throw new Error("Missing required environment variables: MONGO_URI and JWT_SECRET");
}

if (!process.env.PORT) {
  throw new Error("Missing required environment variable: PORT");
}

if (!process.env.NODE_ENV) {
  throw new Error("Missing required environment variable: NODE_ENV");
}

/**
 * @description Centralised, typed access point for all environment-derived
 * configuration. Import this instead of reading process.env directly
 * elsewhere in the codebase, so every config value has one source of truth.
 * @access Public
 */
const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  // ===== AI layer — LLM (Groq) =====
  // All OPTIONAL — the app falls back gracefully when any of these are
  // missing; see src/services/llm.service.js and aiPipeline.service.js.
  groqApiKey: process.env.GROQ_API_KEY || null,
  groqChatModel: process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
  // No safe hardcoded default — Groq's vision-capable model catalog changes
  // over time. Set this explicitly once you've checked
  // https://console.groq.com/docs/models. Left unset, vision analysis is
  // skipped (not guessed) and the app falls back to the non-vision baseline
  // adapter in remoteSensingAnalysis.service.js.
  groqVisionModel: process.env.GROQ_VISION_MODEL || null,

  // ===== Previous LLM providers — no longer used by llm.service.js =====
  // llm.service.js now talks to Groq exclusively. These are kept here only
  // so nothing crashes if some other file still references them; they are
  // not read by the current AI pipeline. Safe to delete once you've
  // confirmed nothing else in the codebase still imports them.
  mistralApiKey: process.env.MISTRAL_API_KEY || null,
  mistralChatModel: process.env.MISTRAL_CHAT_MODEL || "mistral-large-latest",
  mistralEmbeddingModel: process.env.MISTRAL_EMBEDDING_MODEL || "mistral-embed",
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || "gemini-3.6-flash",

  // ===== Vector DB (Pinecone) =====
  pineconeApiKey: process.env.PINECONE_API_KEY || null,
  pineconeIndex: process.env.PINECONE_INDEX || "satquery-ai",

  // ===== Satellite data (Sentinel Hub) =====
  sentinelHubClientId: process.env.SENTINEL_HUB_CLIENT_ID || null,
  sentinelHubClientSecret: process.env.SENTINEL_HUB_CLIENT_SECRET || null,

  // ===== Redis (OPTIONAL) — used for access-token blocklisting on logout.
  // Without it, logout still invalidates the refresh token (via MongoDB,
  // unchanged) but the access token remains valid until it naturally
  // expires. See src/services/tokenBlocklist.service.js.
  redisUrl: process.env.REDIS_URL || null,
};

export default config;