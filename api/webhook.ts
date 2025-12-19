
import { GoogleGenAI, Type } from "@google/genai";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// Manual base64 encoding helper to avoid dependency on Node's Buffer
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is running');
  }

  const { message } = req.body;

  if (!message || (!message.photo && !message.text)) {
    return res.status(200).send('ok');
  }

  const chatId = message.chat.id;

  try {
    // 1. If user sent a photo
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1]; // Get largest size
      await sendTelegramMessage(chatId, "🔮 Анализирую изображение... Пожалуйста, подождите.");

      // Get file path from Telegram
      const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${photo.file_id}`);
      const fileData = await fileRes.json();
      const filePath = fileData.result.file_path;

      // Download file and convert to base64
      const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
      const arrayBuffer = await imgRes.arrayBuffer();
      // Use the manual encode helper instead of Buffer.from().toString('base64')
      const base64 = encode(new Uint8Array(arrayBuffer));

      // Call Gemini
      const prompts = await askGemini(base64, "image/jpeg");

      // Send results back
      const reply = "✨ **Сгенерированные промты:**\n\n" + prompts.join("\n\n---\n\n");
      await sendTelegramMessage(chatId, reply);
    } 
    // 2. If user sent text
    else if (message.text === "/start") {
      await sendTelegramMessage(chatId, "Привет! Я Prompt Alchemy Bot. 🧪\n\nПришли мне фотографию, и я создам на её основе профессиональные промты для Midjourney/Stable Diffusion.");
    } else {
      await sendTelegramMessage(chatId, "Пожалуйста, пришли мне **фотографию**, чтобы я мог проанализировать её стиль и выдать промты.");
    }
  } catch (error) {
    console.error("Bot Error:", error);
    await sendTelegramMessage(chatId, "❌ Произошла ошибка при обработке изображения. Попробуйте позже.");
  }

  return res.status(200).send('ok');
}

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

async function askGemini(base64: string, mimeType: string): Promise<string[]> {
  // Initialize GoogleGenAI right before making an API call using the environment variable directly
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-flash-preview';
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { text: "Generate 3 high-quality, detailed artistic prompts based on this image. Return them as a JSON array of strings: { \"prompts\": [\"string\", \"string\", \"string\"] }" },
        { inlineData: { mimeType, data: base64 } }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["prompts"]
      }
    }
  });

  // Access text directly from the response object
  const data = JSON.parse(response.text || '{"prompts":[]}');
  return data.prompts;
}
