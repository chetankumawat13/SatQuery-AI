import "dotenv/config";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const model = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";

async function testGroq() {
  try {
    const response = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: "Reply only with: Groq is working!",
        },
      ],
    });

    console.log("✅ SUCCESS");
    console.log("Model:", response.model);
    console.log("Response:", response.choices[0].message.content);
  } catch (error) {
    console.error("❌ FAILED");
    console.error(error.message);
  }
}

testGroq();