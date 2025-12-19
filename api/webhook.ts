
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
    // 1. HANDLE BUTTON CLICKS
    if (callback_query) {
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const data = callback_query.data;

      // Schema is now compact: cmd|type|count (to stay under 64 bytes)
      const [cmd, type, countStr] = data.split('|');
      const count = parseInt(countStr || '3');

      if (cmd === 'toggle_type') {
        const nextType = type === 'face' ? 'style' : 'face';
        await updateMenu(chatId, messageId, nextType, count);
      } 
      else if (cmd === 'toggle_count') {
        const nextCount = count === 1 ? 3 : count === 3 ? 5 : 1;
        await updateMenu(chatId, messageId, type, nextCount);
      } 
      else if (cmd === 'run') {
        await answerCallback(callback_query.id, "🪄 Алхимия запущена...");
        
        // Extract files from the message context instead of callback_data
        const currentMsg = callback_query.message;
        const mainPhoto = currentMsg.photo ? currentMsg.photo[currentMsg.photo.length - 1].file_id : null;
        const repliedPhoto = currentMsg.reply_to_message?.photo ? currentMsg.reply_to_message.photo[currentMsg.reply_to_message.photo.length - 1].file_id : null;

        if (!mainPhoto) {
          await sendTelegramMessage(chatId, "❌ Не удалось найти фото для анализа.");
          return res.status(200).send('ok');
        }

        await sendTelegramMessage(chatId, "🧪 *Изучаю черты лица и художественный стиль...* Это займет около 15 секунд.");

        try {
          // If there's a reply, it's always Mix mode: Reply (Face) + Current (Style)
          const prompts = await performAlchemy(mainPhoto, repliedPhoto, type, count);
          const resultText = `✨ *Готово! Ваши промты:* \n\n` + prompts.join("\n\n---\n\n");
          await sendTelegramMessage(chatId, resultText);
        } catch (e) {
          console.error("Alchemy Error:", e);
          await sendTelegramMessage(chatId, "❌ Ошибка генерации. Возможно, фото слишком большое или сервер перегружен.");
        }
      }
      return res.status(200).send('ok');
    }

    // 2. HANDLE NEW MESSAGES
    if (message) {
      const chatId = message.chat.id;

      if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        
        // Alchemy Check
        const repliedMsg = message.reply_to_message;
        const hasRepliedPhoto = !!(repliedMsg?.photo);

        if (hasRepliedPhoto) {
          await sendConfigMenu(chatId, "mix", 3, "✅ *Обнаружено два фото!*\nЯ смешаю лицо с первого фото и стиль со второго.");
        } else {
          await sendConfigMenu(chatId, "face", 3, "📸 *Фото получено!*\nВыберите, как его использовать:");
        }
      } 
      else if (message.text === "/start") {
        await sendTelegramMessage(chatId, "👋 Привет! Я *Prompt Alchemy Bot*.\n\nЯ создаю профессиональные промты, объединяя лица людей с любыми стилями.\n\n*Как работать:*\n1️⃣ Отправь фото.\n2️⃣ Выбери роль: *Лицо* (Target Face) или *Стиль* (Style).\n3️⃣ Чтобы смешать, отправь второе фото *ОТВЕТОМ* (Reply) на сообщение с первым.\n4️⃣ Жми *Запустить Алхимию*!");
      } 
    }
  } catch (error) {
    console.error("Global Webhook Error:", error);
  }

  return res.status(200).send('ok');
}

async function sendConfigMenu(chatId: number, type: string, count: number, text: string) {
  const keyboard = buildKeyboard(type, count);
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

async function updateMenu(chatId: number, messageId: number, type: string, count: number) {
  const keyboard = buildKeyboard(type, count);
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

function buildKeyboard(type: string, count: number) {
  const typeLabel = type === 'face' ? "🧬 Лицо (Subject)" : type === 'style' ? "🎨 Стиль (Style)" : "🧪 Смешивание (Mix)";
  // Buttons no longer contain file_id to respect 64-byte limit
  return {
    inline_keyboard: [
      [
        { text: typeLabel, callback_data: `toggle_type|${type}|${count}` },
        { text: `🔢 Промтов: ${count}`, callback_data: `toggle_count|${type}|${count}` }
      ],
      [{ text: "🚀 Запустить Алхимию!", callback_data: `run|${type}|${count}` }]
    ]
  };
}

async function performAlchemy(f1: string, f2: string | null, type: string, count: number): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  // Refined instructions to focus on "Seamless result"
  let systemInstruction = `You are a professional Prompt Engineer for Midjourney.
  Your goal is to describe a scene that perfectly blends the provided references.
  
  RULES:
  - NEVER use phrases like "based on image", "image 1", "reference", or "mix these".
  - Output ONLY the final prompts as if you are describing a high-end photography or digital art.
  - Describe the person's identity (hair, face shape, eyes) and the environment's style (lighting, medium, color) as ONE cohesive vision.
  - Prompts must be in English.
  - Be highly descriptive and atmospheric.`;

  if (f2) {
    // MIX MODE (f1 is style from current msg, f2 is face from replied msg)
    const [styB64, subB64] = await Promise.all([downloadToB64(f1), downloadToB64(f2)]);
    
    parts.push({ text: `
      Analyze these two images:
      Reference A: Use this for the PERSON'S IDENTITY.
      Reference B: Use this for the ARTISTIC STYLE, LIGHTING, and MOOD.
      
      Generate ${count} prompts describing the person from Reference A standing in a setting that replicates the EXACT aesthetic of Reference B.
      Return JSON: { "prompts": ["...", "..."] }
    `});
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: subB64 } }); // Face
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: styB64 } }); // Style
  } else {
    // SINGLE MODE
    const b1 = await downloadToB64(f1);
    const instruction = type === 'face' 
      ? `This is a portrait. Create ${count} prompts describing this specific person in new epic cinematic settings, keeping the description of their facial features very detailed.`
      : `This is a style reference. Create ${count} prompts that capture this aesthetic (lighting, color, camera) and apply it to various interesting subjects.`;
    
    parts.push({ text: instruction + ` Return JSON: { "prompts": ["...", "..."] }` });
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

async function downloadToB64(fileId: string): Promise<string> {
  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) throw new Error("Telegram getFile failed: " + JSON.stringify(fileData));
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
