
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
        
        // Extract files from the message containing the keyboard
        const currentMsg = callback_query.message;
        // In Telegram, the photo is an array, we take the largest version (last element)
        const mainPhoto = currentMsg.photo ? currentMsg.photo[currentMsg.photo.length - 1].file_id : null;
        
        // Check if the message with the keyboard is a reply to another photo
        const repliedPhoto = currentMsg.reply_to_message?.photo ? currentMsg.reply_to_message.photo[currentMsg.reply_to_message.photo.length - 1].file_id : null;

        if (!mainPhoto) {
          await sendTelegramMessage(chatId, "❌ Не удалось найти фото. Пожалуйста, отправьте фото еще раз.");
          return res.status(200).send('ok');
        }

        await sendTelegramMessage(chatId, "🧪 *Изучаю черты лица и художественный стиль...* Это займет около 15 секунд.");

        try {
          // If there's a replied photo, use Mix mode (replied = face, current = style)
          // Otherwise use single mode logic based on the toggle 'type'
          const prompts = await performAlchemy(mainPhoto, repliedPhoto, type, count);
          const resultText = `✨ *Готово! Ваши промты:* \n\n` + prompts.join("\n\n---\n\n");
          await sendTelegramMessage(chatId, resultText);
        } catch (e) {
          console.error("Alchemy Error:", e);
          await sendTelegramMessage(chatId, "❌ Ошибка генерации. Попробуйте еще раз или используйте другое фото.");
        }
      }
      return res.status(200).send('ok');
    }

    // 2. HANDLE NEW MESSAGES
    if (message) {
      const chatId = message.chat.id;

      if (message.photo) {
        const photoArray = message.photo;
        const lastPhoto = photoArray[photoArray.length - 1];
        const fileId = lastPhoto.file_id;
        
        // Alchemy Check: Did the user reply to a previous photo?
        const repliedMsg = message.reply_to_message;
        const hasRepliedPhoto = !!(repliedMsg?.photo);

        if (hasRepliedPhoto) {
          // Send a NEW photo message (repeating the current style photo) with the MIX menu
          // and link it to the previous photo (the face) via reply_to_message_id
          await sendConfigMenu(
            chatId, 
            fileId,
            "mix", 
            3, 
            "✅ *Обнаружено два фото!*\nЯ смешаю лицо с первого фото и стиль с этого.",
            repliedMsg.message_id
          );
        } else {
          // Single photo mode: send the same photo back with the menu
          await sendConfigMenu(
            chatId, 
            fileId,
            "face", 
            3, 
            "📸 *Фото получено!*\nВыберите, как его использовать:"
          );
        }
      } 
      else if (message.text === "/start") {
        await sendTelegramMessage(chatId, "👋 Привет! Я *Prompt Alchemy Bot*.\n\nЯ создаю профессиональные промты для Midjourney/Stable Diffusion.\n\n*Как работать:*\n1️⃣ Отправь фото.\n2️⃣ Выбери роль: *Лицо* (Target) или *Стиль*.\n3️⃣ Чтобы смешать, отправь второе фото *ОТВЕТОМ* (Reply) на сообщение с первым.\n4️⃣ Жми *Запустить Алхимию*!");
      } 
    }
  } catch (error) {
    console.error("Global Webhook Error:", error);
  }

  return res.status(200).send('ok');
}

/**
 * Sends a photo message with an inline keyboard for configuration.
 * Crucial: Attaching the keyboard to a photo ensures the callback query has access to the photo data.
 */
async function sendConfigMenu(chatId: number, fileId: string, type: string, count: number, text: string, replyToId?: number) {
  const keyboard = buildKeyboard(type, count);
  const body: any = {
    chat_id: chatId,
    photo: fileId,
    caption: text,
    reply_markup: keyboard,
    parse_mode: 'Markdown'
  };
  
  if (replyToId) {
    body.reply_to_message_id = replyToId;
  }

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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
  
  let systemInstruction = `You are a professional Prompt Engineer for Midjourney.
  Goal: Describe a cohesive scene combining the given visual references.
  
  RULES:
  - DO NOT mention "image", "reference", or "mix".
  - Write ONLY pure descriptive prompts in English.
  - Mix the subject's identity and the stylistic atmosphere into ONE natural paragraph.
  - Return a JSON object with a "prompts" array.`;

  if (f2) {
    // MIX MODE (f1 is style from current msg, f2 is face from replied msg)
    const [styB64, subB64] = await Promise.all([downloadToB64(f1), downloadToB64(f2)]);
    
    parts.push({ text: `
      Image A (Subject/Face): Maintain this person's identity (features, hair).
      Image B (Style/Mood): Replicate this aesthetic, lighting, and medium.
      
      Generate ${count} prompts describing the person from Image A in a scene with the exact style of Image B.
      Output format JSON: { "prompts": ["...", "..."] }
    `});
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: subB64 } });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: styB64 } });
  } else {
    // SINGLE MODE
    const b1 = await downloadToB64(f1);
    const instruction = type === 'face' 
      ? `This is a portrait. Generate ${count} prompts describing this specific person in cinematic, detailed environments while keeping their identity consistent.`
      : `This is a style reference. Generate ${count} prompts that capture this aesthetic and apply it to new artistic subjects.`;
    
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
