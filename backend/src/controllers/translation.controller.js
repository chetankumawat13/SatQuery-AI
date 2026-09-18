import { asyncHandler } from "../utils/error.handler.js";
import { translateText } from "../services/llm.service.js";

export const translate = asyncHandler(async (req, res) => {
  const { text, language } = req.body;
  if (!text || !language) {
    return res.status(400).json({ success: false, message: "text and language are required" });
  }

  const translatedText = await translateText(String(text), String(language));
  res.status(200).json({ success: true, data: { text: translatedText, language } });
});