
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
  // Ensure we only process POST requests from Telegram
  if (req.method !== 'POST') return res.status(200).send('Bot is active');

  const { message, callback_query } = req.body;

  try {
    // 1. HANDLE BUTTON CLICKS
    if (callback_query) {
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const data = callback_query.data; // format: "cmd|type|count"

      const [cmd, type, countStr] = data.split('|');
      const count = parseInt(countStr || '3');

      // Check if the message actually has photos (our menu is attached to a photo)
      const photo = callback_query.message.photo;
      const repliedPhoto = callback_query.message.reply_to_message?.photo;

      if (cmd === 'toggle_type') {
        const nextType = type === 'face' ? 'style' : 'face';
        await updateMenu(chatId, messageId, nextType, count);
        return res.status(200).send('ok');
      }

      if (cmd === 'toggle_count') {
        const nextCount = count === 1 ? 3 : count === 3 ? 5 : 1;
        await updateMenu(chatId, messageId, type, nextCount);
        return res.status(200).send('ok');
      }

      if (cmd === 'run') {
        await answerCallback(callback_query.id, "🪄 Начинаю алхимию...");
        await sendTelegramMessage(chatId, "⏳ Генерирую промты... Пожалуйста, подождите 10-20 секунд.");

        const mainPhotoId = photo[photo.length - 1].file_id;
        let secondaryPhotoId = repliedPhoto ? repliedPhoto[repliedPhoto.length - 1].file_id : null;

        // If we have both, image 1 is Subject, image 2 is Style
        // If only one, use selected type
        const prompts = await performAlchemy(mainPhotoId, secondaryPhotoId, type, count);
        
        const resultText = `✅ **Готово!**\n\n` + prompts.join("\n\n---\n\n");
        await sendTelegramMessage(chatId, resultText);
        return res.status(200).send('ok');
      }
    }

    // 2. HANDLE NEW MESSAGES
    if (message) {
      const chatId = message.chat.id;

      if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        
        // If this photo is a REPLY to another photo message, we can offer to MIX them
        if (message.reply_to_message?.photo) {
          // Pass the reply message ID explicitly to solve scoping issues with req
          await sendMixMenu(chatId, photo.file_id, message.reply_to_message.message_id);
        } else {
          await sendSingleMenu(chatId, photo.file_id);
        }
      } 
      else if (message.text === "/start") {
        await sendTelegramMessage(chatId, "👋 Привет! Я **Prompt Alchemy Bot**.\n\n**Как пользоваться:**\n1. Отправь фото и выбери тип (Лицо или Стиль).\n2. Чтобы **смешать два фото**, отправь второе фото **ОТВЕТОМ** (Reply) на сообщение с первым фото.\n3. Выбери количество промтов и жми 'Пуск'!");
      } 
      else {
        await sendTelegramMessage(chatId, "📸 Пожалуйста, отправь **фотографию**, чтобы начать.");
      }
    }
  } catch (error: any) {
    console.error("Bot Handler Error:", error);
    // Silent fail for Telegram or send user notification
    const chatId = message?.chat?.id || callback_query?.message?.chat?.id;
    if (chatId) await sendTelegramMessage(chatId, "❌ Произошла ошибка. Убедитесь, что фото не слишком большое.");
  }

  return res.status(200).send('ok');
}

// UI HELPERS
async function sendSingleMenu(chatId: number, fileId: string) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🧬 Это Лицо (Subject)", callback_data: `toggle_type|face|3` },
        { text: "🔢 Промтов: 3", callback_data: `toggle_count|face|3` }
      ],
      [{ text: "🚀 Генерировать!", callback_data: `run|face|3` }],
      [{ text: "💡 Совет: ответь на это фото другим, чтобы смешать их", callback_data: "none" }]
    ]
  };

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: fileId,
      caption: "🖼 Фото получено! Выберите режим:",
      reply_markup: keyboard
    })
  });
}

// Fixed signature to accept replyToMessageId parameter
async function sendMixMenu(chatId: number, fileId: string, replyToMessageId: number) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🔢 Промтов: 3", callback_data: `toggle_count|mix|3` },
        { text: "🚀 Смешать (Алхимия)!", callback_data: `run|mix|3` }
      ]
    ]
  };

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: fileId,
      caption: "🧪 Обнаружено два фото! Я могу смешать это фото (как Стиль) с предыдущим (как Лицо).",
      reply_markup: keyboard,
      reply_to_message_id: replyToMessageId
    })
  });
}

async function updateMenu(chatId: number, messageId: number, type: string, count: number) {
  const typeLabel = type === 'face' ? "🧬 Лицо (Subject)" : type === 'style' ? "🎨 Стиль (Style)" : "🧪 Алхимия (Смешивание)";
  const keyboard = {
    inline_keyboard: [
      [
        { text: typeLabel, callback_data: `toggle_type|${type}|${count}` },
        { text: `🔢 Промтов: ${count}`, callback_data: `toggle_count|${type}|${count}` }
      ],
      [{ text: "🚀 Запустить генерацию!", callback_data: `run|${type}|${count}` }]
    ]
  };

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

// GEMINI LOGIC
async function performAlchemy(file1: string, file2: string | null, type: string, count: number): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  let instruction = `Generate ${count} high-quality image prompts based on provided images.`;

  if (file2 || type === 'mix') {
    instruction += ` Image 1 is the subject (face/person). Image 2 is the artistic style/lighting. Mix them perfectly.`;
    const [b1, b2] = await Promise.all([downloadToB64(file1), downloadToB64(file2!)]);
    parts.push({ text: instruction });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b1 } });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b2 } });
  } else {
    if (type === 'face') {
      instruction += ` The provided image is a subject. Create cinematic prompts with varied outfits/settings for this specific person.`;
    } else {
      instruction += ` The provided image is a style reference. Create prompts that replicate this exact aesthetic for random subjects.`;
    }
    const b1 = await downloadToB64(file1);
    parts.push({ text: instruction });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b1 } });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: {
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

// TELEGRAM API WRAPPERS
async function downloadToB64(fileId: string): Promise<string> {
  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
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
