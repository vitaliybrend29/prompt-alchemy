
import { GoogleGenAI, Type } from "@google/genai";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(200).send('Bot is active');

  const { message, callback_query } = req.body;

  try {
    // 1. HANDLE BUTTON CLICKS (CALLBACK QUERIES)
    if (callback_query) {
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const data = callback_query.data;

      // Schema: cmd|type|count|file1|file2
      const [cmd, type, countStr, file1, file2] = data.split('|');
      const count = parseInt(countStr || '3');

      if (cmd === 'toggle_type') {
        const nextType = type === 'face' ? 'style' : 'face';
        await updateMenu(chatId, messageId, nextType, count, file1, file2);
      } 
      else if (cmd === 'toggle_count') {
        const nextCount = count === 1 ? 3 : count === 3 ? 5 : 1;
        await updateMenu(chatId, messageId, type, nextCount, file1, file2);
      } 
      else if (cmd === 'run') {
        await answerCallback(callback_query.id, "🪄 Алхимия запущена...");
        await sendTelegramMessage(chatId, "🧪 *Изучаю черты лица и художественный стиль...* Это займет около 15 секунд.");

        try {
          const prompts = await performAlchemy(file1, file2, type, count);
          const resultText = `✨ *Готово! Ваши промты:* \n\n` + prompts.join("\n\n---\n\n");
          await sendTelegramMessage(chatId, resultText);
        } catch (e) {
          console.error(e);
          await sendTelegramMessage(chatId, "❌ Ошибка генерации. Попробуйте другие фото или уменьшите количество промтов.");
        }
      }
      return res.status(200).send('ok');
    }

    // 2. HANDLE NEW MESSAGES
    if (message) {
      const chatId = message.chat.id;

      if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        const fileId = photo.file_id;
        
        // Alchemy Check: If user replied to a message that has a photo
        const repliedMsg = message.reply_to_message;
        const repliedPhoto = repliedMsg?.photo ? repliedMsg.photo[repliedMsg.photo.length - 1] : null;

        if (repliedPhoto) {
          // Mixed Mode: Subject (replied) + Style (current)
          await sendConfigMenu(chatId, "mix", 3, repliedPhoto.file_id, fileId, "✅ Обнаружено два фото! Готов смешать лицо из первого со стилем из второго.");
        } else {
          // Single Mode
          await sendConfigMenu(chatId, "face", 3, fileId, "", "📸 Фото получено! Выберите роль для этого изображения:");
        }
      } 
      else if (message.text === "/start") {
        await sendTelegramMessage(chatId, "👋 Привет! Я *Prompt Alchemy Bot*.\n\nЯ умею вытаскивать стиль из фото и переносить лица на новые сюжеты.\n\n*Как работать:*\n1️⃣ Отправь фото.\n2️⃣ Выбери роль: *Лицо* (Target Face) или *Стиль* (Style).\n3️⃣ Чтобы смешать, отправь второе фото *ОТВЕТОМ* (Reply) на сообщение с первым.\n4️⃣ Жми *Запустить Алхимию*!");
      } 
      else {
        await sendTelegramMessage(chatId, "📸 Пожалуйста, отправь *фотографию*, чтобы я мог начать анализ.");
      }
    }
  } catch (error) {
    console.error("Global Webhook Error:", error);
  }

  return res.status(200).send('ok');
}

// UI HELPERS
async function sendConfigMenu(chatId: number, type: string, count: number, f1: string, f2: string, text: string) {
  const keyboard = buildKeyboard(type, count, f1, f2);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    })
  });
}

async function updateMenu(chatId: number, messageId: number, type: string, count: number, f1: string, f2: string) {
  const keyboard = buildKeyboard(type, count, f1, f2);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    })
  });
}

function buildKeyboard(type: string, count: number, f1: string, f2: string) {
  const typeLabel = type === 'face' ? "🧬 Лицо (Subject)" : type === 'style' ? "🎨 Стиль (Style)" : "🧪 Смешивание (Mix)";
  return {
    inline_keyboard: [
      [
        { text: typeLabel, callback_data: `toggle_type|${type}|${count}|${f1}|${f2}` },
        { text: `🔢 Промтов: ${count}`, callback_data: `toggle_count|${type}|${count}|${f1}|${f2}` }
      ],
      [{ text: "🚀 Запустить Алхимию!", callback_data: `run|${type}|${count}|${f1}|${f2}` }]
    ]
  };
}

// CORE LOGIC: GEMINI PROMPT ENGINEERING
async function performAlchemy(f1: string, f2: string | null, type: string, count: number): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  let systemInstruction = `You are a world-class prompt engineer for Midjourney and Stable Diffusion.
  Your task is to analyze images and create highly descriptive, professional prompts.
  RULES:
  - DO NOT mention 'Image 1', 'Image 2', or 'the provided image' in the final prompts.
  - The prompts must be standalone descriptions of a scene.
  - Combine features naturally.
  - Output exactly ${count} prompts.`;

  if (f2 && f2 !== "") {
    // ALCHEMY / MIX MODE
    const [subB64, styB64] = await Promise.all([downloadToB64(f1), downloadToB64(f2)]);
    
    parts.push({ text: `
      Analyze these two images:
      Image 1: The Subject (Face/Identity). Describe her facial features, hair, and essence precisely to keep her identity.
      Image 2: The Style. Describe the lighting, camera angle, color grading, artistic medium (e.g., 35mm film, oil painting, digital art), and atmosphere.
      
      TASK: Create ${count} prompts that place the person from Image 1 into a scene that perfectly matches the artistic style of Image 2. 
      The person's features must be the core of the description.
      Return a JSON array of strings: { "prompts": ["...", "..."] }
    `});
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: subB64 } });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: styB64 } });
  } else {
    // SINGLE IMAGE MODE
    const b1 = await downloadToB64(f1);
    const instruction = type === 'face' 
      ? `Analyze this person's face. Create ${count} cinematic prompts that describe this specific person in varied high-end settings (e.g. cyberpunk city, tropical beach, royal palace) while keeping facial descriptions detailed to preserve identity.`
      : `Analyze the artistic style, color palette, and lighting of this image. Create ${count} prompts that describe this exact aesthetic but apply it to new interesting subjects (e.g. a futuristic robot, a majestic lion, a lone traveler).`;
    
    parts.push({ text: instruction + ` Return a JSON object: { "prompts": ["...", "..."] }` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b1 } });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["prompts"]
      }
    }
  });

  const data = JSON.parse(response.text || '{"prompts":[]}');
  return data.prompts;
}

// UTILS
async function downloadToB64(fileId: string): Promise<string> {
  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) throw new Error("Telegram getFile failed");
  const filePath = fileData.result.file_path;
  const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
  const arrayBuffer = await imgRes.arrayBuffer();
  return encode(new Uint8Array(arrayBuffer));
}

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

async function answerCallback(id: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text })
  });
}
