import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import { PromptTemplate } from "@langchain/core/prompts";
import config from "../config/config.js";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.env"
  ),
});

const geminiApiKey =
  process.env.GEMINI_API_KEY || config.geminiApiKey;

const geminiChatModel =
  process.env.GEMINI_CHAT_MODEL ||
  config.geminiChatModel ||
  "gemini-3.6-flash";

let geminiClient = null;
let chatClient = null;

const getGeminiClient = () => {
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(geminiApiKey);
  }

  return geminiClient;
};

const getChatClient = () => {
  if (!chatClient) {
    chatClient = getGeminiClient().getGenerativeModel({
      model: geminiChatModel,
    });
  }

  return chatClient;
};

/**
 * Checks whether Gemini is configured.
 */
export const isLLMConfigured = () => {
  return Boolean(geminiApiKey);
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

export const analyzeImagesWithVision = async ({ files, mode, task, roles }) => {
  if (!isLLMConfigured()) return null;

  try {
    const parts = [{ text: visionPrompt({ mode, task, roles }) }];
    for (const file of files) {
      parts.push({ inlineData: await prepareVisionImage(file) });
    }

    const result = await getChatClient().generateContent(parts);
    const raw = result.response.text().trim();
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
      model: geminiChatModel,
    };
  } catch (error) {
    console.warn("Vision analysis failed:", error.message);
    return null;
  }
};

/**
 * Generates text using Gemini.
 */
const generateText = async (prompt) => {
  const model = getChatClient();

  const result = await model.generateContent(prompt);

  return result.response.text().trim();
};

/**
 * Embeddings are not handled by Gemini chat model.
 *
 * Return null for now so the pipeline can use the
 * existing rule-based/fallback flow.
 */
export const embedText = async () => {
  console.warn(
    "Embedding is not configured for Gemini. Returning null."
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

    // Handles accidental markdown fences if Gemini adds them
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