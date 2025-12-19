
import { GoogleGenAI, Type } from "@google/genai";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// Helper for base64 encoding
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Interface for callback state
// Schema: cmd:subjectId:styleId:count
type BotState = {
  cmd: string;
  sub?: string;
  sty?: string;
  cnt: number;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(200).send('Bot is running');

  const { message, callback_query } = req.body;

  // Handle Callback Queries (Wizard Logic)
  if (callback_query) {
    const chatId = callback_query.message.chat.id;
    const messageId = callback_query.message.message_id;
    const data = callback_query.data;
    
    // Parse state: cmd|sub|sty|cnt
    const [cmd, sub, sty, cntStr] = data.split('|');
    const cnt = parseInt(cntStr || '3');

    if (cmd === 'set_sub') {
      await answerCallback(callback_query.id, "🧬 Лицо выбрано!");
      await showConfigMenu(chatId, messageId, sub, sty, cnt, "Это лицо. Добавьте стиль или начните.");
    } 
    else if (cmd === 'set_sty') {
      await answerCallback(callback_query.id, "🎨 Стиль выбран!");
      await showConfigMenu(chatId, messageId, sub, sty, cnt, "Это стиль. Добавьте лицо или начните.");
    } 
    else if (cmd === 'add_more') {
      await answerCallback(callback_query.id, "Пришлите второе фото!");
      await editMessageText(chatId, messageId, `📸 Отлично! Теперь просто отправьте второе фото (оно будет ${sub ? 'Стилем' : 'Лицом'}).`);
    }
    else if (cmd === 'toggle_cnt') {
      const nextCnt = cnt === 1 ? 3 : cnt === 3 ? 5 : 1;
      await showConfigMenu(chatId, messageId, sub, sty, nextCnt, "Количество промтов изменено.");
    }
    else if (cmd === 'run') {
      await answerCallback(callback_query.id, "🔮 Алхимия начинается...");
      await editMessageText(chatId, messageId, "🔮 Магия в процессе... Генерирую промты (15-20 сек).");

      try {
        const prompts = await processAlchemy(sub, sty, cnt);
        const results = prompts.join("\n\n---\n\n");
        const header = `🧪 **Результат Алхимии**\n${sub ? '🧬 Лицо есть' : ''} ${sty ? '🎨 Стиль есть' : ''}\nПромтов: ${cnt}\n\n`;
        await sendTelegramMessage(chatId, header + results);
      } catch (e) {
        console.error(e);
        await sendTelegramMessage(chatId, "❌ Ошибка при генерации. Возможно, фото слишком сложное или API перегружен.");
      }
    }

    return res.status(200).send('ok');
  }

  // Handle Incoming Messages
  if (!message) return res.status(200).send('ok');
  const chatId = message.chat.id;

  if (message.photo) {
    const photo = message.photo[message.photo.length - 1];
    await sendInitialMenu(chatId, photo.file_id);
  } else if (message.text === "/start") {
    await sendTelegramMessage(chatId, "👋 Привет! Я **Prompt Alchemy Bot**.\n\nЯ умею создавать профессиональные промты на основе твоих фото.\n\n**Как это работает:**\n1. Отправь мне фото.\n2. Выбери, это **Лицо** (Subject) или **Стиль** (Style).\n3. Можно добавить второе фото для смешивания!\n4. Нажми 'Генерировать'.");
  } else {
    await sendTelegramMessage(chatId, "📸 Чтобы начать, просто отправь мне **фотографию**.");
  }

  return res.status(200).send('ok');
}

async function sendInitialMenu(chatId: number, fileId: string) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🧬 Это Лицо (Subject)", callback_data: `set_sub|${fileId}||3` },
        { text: "🎨 Это Стиль (Style)", callback_data: `set_sty||${fileId}|3` }
      ]
    ]
  };

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: "📸 Фото получено! Что это?",
      reply_markup: keyboard
    })
  });
}

async function showConfigMenu(chatId: number, messageId: number, sub: string, sty: string, cnt: number, text: string) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: `🔢 Промтов: ${cnt}`, callback_data: `toggle_cnt|${sub || ''}|${sty || ''}|${cnt}` }
      ],
      (!sub || !sty) ? [{ text: `➕ Добавить ${sub ? 'Стиль' : 'Лицо'}`, callback_data: `add_more|${sub || ''}|${sty || ''}|${cnt}` }] : [],
      [{ text: "🚀 Генерировать Алхимию!", callback_data: `run|${sub || ''}|${sty || ''}|${cnt}` }]
    ].filter(r => r.length > 0)
  };

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: `${text}\n\n**Текущий конфиг:**\n${sub ? '✅ Лицо загружено' : '❌ Лица нет'}\n${sty ? '✅ Стиль загружен' : '❌ Стиля нет'}\n🔢 Промтов: ${cnt}`,
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    })
  });
}

async function processAlchemy(subId?: string, styId?: string, count: number = 3): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  let instruction = `You are a prompt engineer. Generate exactly ${count} high-end image generation prompts.`;

  if (subId && styId) {
    instruction += ` Merge the subject from image 1 with the artistic style/lighting/composition of image 2. Make it cohesive.`;
    const [subB64, styB64] = await Promise.all([downloadToB64(subId), downloadToB64(styId)]);
    parts.push({ text: instruction });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: subB64 } });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: styB64 } });
  } else if (subId) {
    instruction += ` Focus on the person in this image. Create creative cinematic settings for them while keeping the face consistent.`;
    const subB64 = await downloadToB64(subId);
    parts.push({ text: instruction });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: subB64 } });
  } else if (styId) {
    instruction += ` Reverse-engineer the style of this image. Create prompts that apply this specific aesthetic to various random subjects.`;
    const styB64 = await downloadToB64(styId);
    parts.push({ text: instruction });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: styB64 } });
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

async function downloadToB64(fileId: string): Promise<string> {
  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result.file_path;
  const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
  const arrayBuffer = await imgRes.arrayBuffer();
  return encode(new Uint8Array(arrayBuffer));
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
