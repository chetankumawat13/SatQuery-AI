import { Pinecone } from "@pinecone-database/pinecone";
import config from "../config/config.js";

let client = null;
let indexHandle = null;

/**
 * @description Lazily creates and caches the Pinecone client + index handle.
 * Returns null if PINECONE_API_KEY is not configured, so callers can skip
 * the RAG step gracefully instead of crashing.
 * @access Private
 */
const getIndex = () => {
  if (!config.pineconeApiKey) return null;
  if (indexHandle) return indexHandle;

  client = new Pinecone({ apiKey: config.pineconeApiKey });
  indexHandle = client.index(config.pineconeIndex);
  return indexHandle;
};

/**
 * @description Stores a query's embedding vector in Pinecone along with
 * metadata (the raw text, region, phenomenon), so future similar queries can
 * retrieve it as RAG context.
 * @param {string} id - unique ID for this vector (use the Mongo Query _id)
 * @param {number[]} embedding
 * @param {object} metadata
 * @returns {Promise<boolean>} true if stored, false if Pinecone isn't configured or the call failed
 * @access Private
 */
export const upsertQueryVector = async (id, embedding, metadata) => {
  const index = getIndex();
  if (!index) return false;

  try {
    await index.upsert([{ id, values: embedding, metadata }]);
    return true;
  } catch (err) {
    console.warn("Pinecone upsert failed:", err.message);
    return false;
  }
};

export const upsertQueryRecord = async (id, text, metadata) => {
  const index = getIndex();
  if (!index) return false;

  try {
    await index.upsertRecords({
      namespace: "satquery",
      records: [{
        _id: id,
        text,
        rawQueryText: metadata.rawQueryText,
        region: metadata.region || "",
        phenomenon: metadata.phenomenon || "",
      }],
    });
    return true;
  } catch (err) {
    console.warn("Pinecone record upsert failed:", err.message);
    return false;
  }
};

/**
 * @description Finds the most similar past queries to a given embedding, to
 * use as retrieved context (RAG) when composing the LLM's answer.
 * @param {number[]} embedding
 * @param {number} topK
 * @returns {Promise<Array<{score:number, metadata:object}>>} empty array if
 *   Pinecone isn't configured or the call failed
 * @access Private
 */
export const querySimilarVectors = async (embedding, topK = 3) => {
  const index = getIndex();
  if (!index) return [];

  try {
    const result = await index.query({ vector: embedding, topK, includeMetadata: true });
    return result.matches || [];
  } catch (err) {
    console.warn("Pinecone query failed:", err.message);
    return [];
  }
};

export const querySimilarRecords = async (text, topK = 3) => {
  const index = getIndex();
  if (!index) return [];

  try {
    const result = await index.searchRecords({
      namespace: "satquery",
      query: { inputs: { text }, topK },
      fields: ["rawQueryText", "region", "phenomenon"],
    });
    return result.result?.hits || [];
  } catch (err) {
    console.warn("Pinecone record search failed:", err.message);
    return [];
  }
};

/**
 * @description Whether the Pinecone layer is configured at all. Lets callers
 * skip embedding work entirely (saving a Mistral AI call) if there's nowhere to
 * store or retrieve vectors from anyway.
 * @access Private
 */
export const isPineconeConfigured = () => Boolean(config.pineconeApiKey);