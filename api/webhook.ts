
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
  if (req.method !== 'POST') return res.status(200).send('Bot is running');

  const { message, callback_query } = req.body;

  // Handle Callback Queries (Buttons)
  if (callback_query) {
    const chatId = callback_query.message.chat.id;
    const messageId = callback_query.message.message_id;
    const data = callback_query.data; // Format: "act|type|count|fileId"

    const [act, type, count, fileId] = data.split('|');

    if (act === 'set_type') {
      const newType = type === 'face' ? 'style' : 'face';
      await updateMenu(chatId, messageId, newType, count, fileId);
    } 
    else if (act === 'set_count') {
      const nextCountMap: any = { '1': '3', '3': '5', '5': '1' };
      const newCount = nextCountMap[count] || '3';
      await updateMenu(chatId, messageId, type, newCount, fileId);
    } 
    else if (act === 'run') {
      await answerCallback(callback_query.id, "🔮 Магия начинается...");
      await editMessageText(chatId, messageId, "🔮 Анализирую и генерирую... Это займет около 10-15 секунд.");
      
      try {
        const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        const filePath = fileData.result.file_path;
        const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64 = encode(new Uint8Array(arrayBuffer));

        const prompts = await askGemini(base64, "image/jpeg", type, parseInt(count));
        const reply = `🧪 **Готово!**\nТип: ${type === 'face' ? 'Лицо' : 'Стиль'}\nПромтов: ${count}\n\n` + prompts.join("\n\n---\n\n");
        
        await sendTelegramMessage(chatId, reply);
      } catch (e) {
        await sendTelegramMessage(chatId, "❌ Ошибка. Возможно, файл слишком большой или API временно недоступен.");
      }
    }

    return res.status(200).send('ok');
  }

  // Handle Incoming Messages
  if (!message) return res.status(200).send('ok');
  const chatId = message.chat.id;

  if (message.photo) {
    const photo = message.photo[message.photo.length - 1];
    await sendMenu(chatId, photo.file_id);
  } else if (message.text === "/start") {
    await sendTelegramMessage(chatId, "👋 Привет! Я **Prompt Alchemy Bot**.\n\nОтправь мне фото, и я помогу превратить его в промт. После отправки ты сможешь выбрать, использовать фото как **Лицо (Subject)** или как **Стиль (Style)**.");
  } else {
    await sendTelegramMessage(chatId, "📸 Пожалуйста, отправь **фотографию**.");
  }

  return res.status(200).send('ok');
}

async function sendMenu(chatId: number, fileId: string) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🧬 Как Лицо (Subject)", callback_data: `set_type|face|3|${fileId}` },
        { text: "🔢 Промтов: 3", callback_data: `set_count|face|3|${fileId}` }
      ],
      [{ text: "🚀 Генерировать!", callback_data: `run|face|3|${fileId}` }]
    ]
  };

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: "📸 Фото получено! Настройте параметры генерации:",
      reply_markup: keyboard
    })
  });
}

async function updateMenu(chatId: number, messageId: number, type: string, count: string, fileId: string) {
  const typeLabel = type === 'face' ? "🧬 Лицо (Subject)" : "🎨 Стиль (Style)";
  const keyboard = {
    inline_keyboard: [
      [
        { text: typeLabel, callback_data: `set_type|${type}|${count}|${fileId}` },
        { text: `🔢 Промтов: ${count}`, callback_data: `set_count|${type}|${count}|${fileId}` }
      ],
      [{ text: "🚀 Начать алхимию!", callback_data: `run|${type}|${count}|${fileId}` }]
    ]
  };

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: "📸 Настройки обновлены. Нажмите кнопку для запуска:",
      reply_markup: keyboard
    })
  });
}

async function answerCallback(id: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text: text })
  });
}

async function editMessageText(chatId: number, messageId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text })
  });
}

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

async function askGemini(base64: string, mimeType: string, type: string, count: number): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-flash-preview';
  
  const instruction = type === 'face' 
    ? `Analyze the person in this image. Create ${count} detailed photorealistic prompts that maintain this specific face/subject but place her in different cinematic or high-fashion settings. Vary outfits and lighting.`
    : `Reverse-engineer the artistic style, lighting, and composition of this image. Generate ${count} prompts that describe this exact aesthetic so it can be applied to other subjects.`;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { text: instruction + " Return a JSON object with a 'prompts' array of strings." },
        { inlineData: { mimeType, data: base64 } }
      ]
    },
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
