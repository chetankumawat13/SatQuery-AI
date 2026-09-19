import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import sharp from "sharp";
import { PromptTemplate } from "@langchain/core/prompts";
import config from "../config/config.js";

// Keep the explicit-path dotenv load that was already here — makes sure
// .env loads correctly even if this module is ever imported from a
// different working directory than the project root.
dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.env"
  ),
});

const groqApiKey = process.env.GROQ_API_KEY || config.groqApiKey;

const groqChatModel =
  process.env.GROQ_CHAT_MODEL || config.groqChatModel || "openai/gpt-oss-120b";

// Groq's vision-capable models are a different, smaller set than its text
// models, and which ones are available changes over time — there is no safe
// hardcoded default here. Set GROQ_VISION_MODEL explicitly once you've
// checked https://console.groq.com/docs/models for the current
// vision-capable model IDs. Until it's set, analyzeImagesWithVision below
// returns null (graceful fallback to the non-vision baseline adapter in
// remoteSensingAnalysis.service.js) — it does not guess.
const groqVisionModel = process.env.GROQ_VISION_MODEL || config.groqVisionModel || null;

let groqClient = null;

/**
 * @description Lazily creates and caches the Groq client, mirroring the
 * lazy-init pattern this file already used for its previous provider.
 * @access Private
 */
const getGroqClient = () => {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: groqApiKey });
  }
  return groqClient;
};

/**
 * Checks whether Groq is configured.
 */
export const isLLMConfigured = () => {
  return Boolean(groqApiKey);
};

export const translateText = async (text, language) => {
  if (!isLLMConfigured() || !text || language === "en") return text;

  const prompt = `Translate the following remote-sensing application text into ${language}. Preserve place names, coordinates, metric names such as NDVI/NDWI, numbers, and formatting. Return only the translated text.\n\n${text}`;
  try {
    return await generateText(prompt);
  } catch (error) {
    console.warn("Text translation failed:", error.message);
    return text;
  }
};

const visionPrompt = ({ mode, task, roles }) => `You are a remote-sensing vision analyst. Analyze the supplied ${mode} imagery for this task:
${task}

Input mode: ${mode}
Image roles: ${roles?.join(", ") || "single image"}

Use visual evidence from the image pixels. For multispectral, optical, SAR, and temporal inputs, distinguish what is visibly supported from what cannot be determined. Do not invent coordinates, dates, sensor bands, masks, or objects that are not visible. Return ONLY valid JSON with this shape:
{
  "answer": "2-4 sentence evidence-grounded answer",
  "confidence": 0,
  "observations": ["specific visible observation"],
  "limitations": ["important uncertainty"]
}
The confidence must be an integer from 0 to 100.`;

const prepareVisionImage = async (file) => {
  const inputMime = file.mimetype || "image/jpeg";
  if (inputMime === "image/tiff" || /\.tiff?$/i.test(file.originalname)) {
    return {
      data: (await sharp(file.buffer).jpeg({ quality: 86 }).toBuffer()).toString("base64"),
      mimeType: "image/jpeg",
    };
  }

  return {
    data: file.buffer.toString("base64"),
    mimeType: inputMime.startsWith("image/") ? inputMime : "image/jpeg",
  };
};

/**
 * @description Sends one or more images plus a task prompt to a Groq
 * vision-capable model, using the OpenAI-compatible multimodal message
 * format Groq's chat completions API expects (content as an array of
 * {type:"text"} and {type:"image_url"} parts, image data as a base64 data
 * URI). Returns null — same as before — if the LLM layer isn't configured,
 * so callers fall back to the non-vision baseline adapter.
 *
 * NOTE: most Groq vision-preview models currently accept only ONE image per
 * request. This function still attaches every file it's given; for
 * multi-image tasks (bi-temporal change, optical+SAR fusion) verify against
 * Groq's current docs whether your chosen GROQ_VISION_MODEL actually
 * supports multiple images before relying on this in a demo — if it
 * doesn't, Groq's API will reject the request and this returns null exactly
 * like any other failure, so the baseline adapter's numeric comparison
 * still produces a usable (if less rich) result.
 */
export const analyzeImagesWithVision = async ({ files, mode, task, roles }) => {
  if (!isLLMConfigured()) return null;

  if (!groqVisionModel) {
    console.warn(
      "GROQ_VISION_MODEL is not set — skipping vision analysis and using the baseline adapter instead. " +
        "Set GROQ_VISION_MODEL once you've confirmed a current vision-capable model ID from https://console.groq.com/docs/models."
    );
    return null;
  }

  try {
    const imageParts = await Promise.all(
      files.map(async (file) => {
        const { data, mimeType } = await prepareVisionImage(file);
        return {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${data}` },
        };
      })
    );

    const response = await getGroqClient().chat.completions.create({
      model: groqVisionModel,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: visionPrompt({ mode, task, roles }) }, ...imageParts],
        },
      ],
    });

    const raw = response.choices[0].message.content.trim();
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    return {
      answer: String(parsed.answer || "The model did not return an answer."),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      model: groqVisionModel,
    };
  } catch (error) {
    console.warn("Vision analysis failed:", error.message);
    return null;
  }
};

/**
 * Generates text using Groq's chat completions API.
 */
const generateText = async (prompt) => {
  const response = await getGroqClient().chat.completions.create({
    model: groqChatModel,
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content.trim();
};

/**
 * Embeddings are not handled by Groq's chat completion models (Groq does
 * not currently offer a dedicated embeddings endpoint through this SDK).
 *
 * Return null for now so the pipeline can use the
 * existing rule-based/fallback flow.
 */
export const embedText = async () => {
  console.warn(
    "Embedding is not configured for Groq. Returning null."
  );

  return null;
};

const INTENT_PROMPT = `
You extract structured intent from a satellite-data query.

Respond with ONLY a valid JSON object.
Do not use markdown fences.
Do not add explanations.

Use exactly this shape:
{
  "region": "<place name mentioned, or null>",
  "phenomenon": "<one of: flood, crop_stress, deforestation, glacial_lake, unknown>"
}

Query: {{QUERY}}
`;

export const extractIntent = async (rawQueryText) => {
  if (!isLLMConfigured()) return null;

  try {
    const prompt = INTENT_PROMPT.replace(
      "{{QUERY}}",
      rawQueryText
    );

    const raw = await generateText(prompt);

    // Handles accidental markdown fences if the model adds them
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    const validPhenomena = [
      "flood",
      "crop_stress",
      "deforestation",
      "glacial_lake",
      "unknown",
    ];

    if (!validPhenomena.includes(parsed.phenomenon)) {
      parsed.phenomenon = "unknown";
    }

    if (
      parsed.region !== null &&
      typeof parsed.region !== "string"
    ) {
      parsed.region = null;
    }

    return parsed;
  } catch (err) {
    console.warn("Intent extraction failed:", err.message);
    return null;
  }
};

const ANSWER_PROMPT = `
You are SatQuery AI, a satellite-data assistant.

Compose a short 2-3 sentence answer to the user's query using ONLY
the data provided below.

Do not invent numbers or facts.
If a value is missing, acknowledge the limitation briefly.
Use plain and understandable language.

User query: {{QUERY}}
Region: {{REGION}}
Phenomenon: {{PHENOMENON}}
Satellite index value: {{INDEX_VALUE}}
Data source: {{SOURCE}}
Similar past queries: {{CONTEXT}}
`;

export const composeAnswer = async ({
  query,
  region,
  phenomenon,
  indexValue,
  source,
  context,
}) => {
  if (!isLLMConfigured()) return null;

  try {
    const prompt = ANSWER_PROMPT
      .replace("{{QUERY}}", query)
      .replace("{{REGION}}", region || "unspecified")
      .replace("{{PHENOMENON}}", phenomenon || "unknown")
      .replace(
        "{{INDEX_VALUE}}",
        indexValue ?? "not available"
      )
      .replace("{{SOURCE}}", source || "not available")
      .replace(
        "{{CONTEXT}}",
        context && context.length
          ? JSON.stringify(context)
          : "none"
      );

    return await generateText(prompt);
  } catch (err) {
    console.warn("Answer composition failed:", err.message);
    return null;
  }
};