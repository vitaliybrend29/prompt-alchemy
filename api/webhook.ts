
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
    if (callback_query) {
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const data = callback_query.data;

      const [cmd, type, countStr] = data.split('|');
      const count = parseInt(countStr || '3');

      if (cmd === 'toggle_type') {
        const nextType = type === 'face' ? 'style' : type === 'style' ? 'custom' : 'face';
        await updateMenu(chatId, messageId, nextType, count);
      } 
      else if (cmd === 'toggle_count') {
        const nextCount = count === 1 ? 3 : count === 3 ? 5 : 1;
        await updateMenu(chatId, messageId, type, nextCount);
      } 
      else if (cmd === 'run') {
        await answerCallback(callback_query.id, "🪄 Алхимия запущена...");
        
        const currentMsg = callback_query.message;
        const mainPhoto = currentMsg.photo ? currentMsg.photo[currentMsg.photo.length - 1].file_id : null;
        const repliedPhoto = currentMsg.reply_to_message?.photo ? currentMsg.reply_to_message.photo[currentMsg.reply_to_message.photo.length - 1].file_id : null;
        const customPrompt = currentMsg.caption || null;

        if (!mainPhoto) {
          await sendTelegramMessage(chatId, "❌ Ошибка: Фото не найдено.");
          return res.status(200).send('ok');
        }

        await sendTelegramMessage(chatId, "🧪 *Провожу глубокий анализ...* Готовность через 15 секунд.");

        try {
          const prompts = await performAlchemy(mainPhoto, repliedPhoto, type, count, customPrompt);
          const resultText = `✨ *Ваши промты готовы:* \n\n` + prompts.join("\n\n---\n\n");
          await sendTelegramMessage(chatId, resultText);
        } catch (e) {
          console.error(e);
          await sendTelegramMessage(chatId, "❌ Ошибка генерации. Попробуйте снова.");
        }
      }
      return res.status(200).send('ok');
    }

    if (message) {
      const chatId = message.chat.id;
      if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        const fileId = photo.file_id;
        const caption = message.caption;
        const repliedMsg = message.reply_to_message;
        const hasRepliedPhoto = !!(repliedMsg?.photo);

        if (hasRepliedPhoto) {
          await sendConfigMenu(chatId, fileId, "mix", 3, "🧪 *Смешивание обнаружено!*\nЛицо будет взято из первого фото, а стиль из этого.", caption, repliedMsg.message_id);
        } else if (caption) {
          await sendConfigMenu(chatId, fileId, "custom", 3, `✨ *Свой Сюжет:* "${caption}"\nЯ впишу это лицо в ваш сюжет.`, caption);
        } else {
          await sendConfigMenu(chatId, fileId, "face", 3, "📸 *Фото получено!*\nВыберите режим:");
        }
      } 
      else if (message.text === "/start") {
        await sendTelegramMessage(chatId, "👋 Привет! Я *Prompt Alchemy Bot*.\n\n*Режимы:*\n1️⃣ *Лицо* — новые сюжеты для этого человека.\n2️⃣ *Стиль* — копирование эстетики фото.\n3️⃣ *Свой Сюжет* — отправь фото *С ПОДПИСЬЮ*, и я впишу лицо в этот сюжет!\n4️⃣ *Смешивание* — ответь на фото другим фото.");
      } 
    }
  } catch (error) {
    console.error(error);
  }
  return res.status(200).send('ok');
}

async function sendConfigMenu(chatId: number, fileId: string, type: string, count: number, text: string, caption?: string, replyToId?: number) {
  const keyboard = buildKeyboard(type, count);
  const body: any = { chat_id: chatId, photo: fileId, caption: text, reply_markup: keyboard, parse_mode: 'Markdown' };
  if (replyToId) body.reply_to_message_id = replyToId;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function updateMenu(chatId: number, messageId: number, type: string, count: number) {
  const keyboard = buildKeyboard(type, count);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageReplyMarkup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: keyboard }) });
}

function buildKeyboard(type: string, count: number) {
  const typeLabel = type === 'face' ? "🧬 Лицо" : type === 'style' ? "🎨 Стиль" : type === 'custom' ? "✨ Свой Сюжет" : "🧪 Смешивание";
  return { inline_keyboard: [[ { text: typeLabel, callback_data: `toggle_type|${type}|${count}` }, { text: `🔢 Промтов: ${count}`, callback_data: `toggle_count|${type}|${count}` } ], [{ text: "🚀 Запустить!", callback_data: `run|${type}|${count}` }]] };
}

async function performAlchemy(f1: string, f2: string | null, type: string, count: number, customText: string | null): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  let systemInstruction = `You are a professional Prompt Engineer for Midjourney. 
  Your output MUST be a standalone description of a scene. 
  
  STRICT RULES:
  - NEVER mention "Image A", "Image B", "the first photo", or "the provided reference".
  - DO NOT say "woman from the photo". Instead describe her features: "a woman with cascading brown waves and striking green eyes".
  - Describe the artistic style and the subject as ONE unified vision.
  - No meta-talk. Only pure visual description in English.
  - Format: JSON { "prompts": ["string", ...] }`;

  if (type === 'custom' && customText) {
    const b1 = await downloadToB64(f1);
    parts.push({ text: `Analyze the person's facial features and identity. Create ${count} prompts placing them in the scene: "${customText}". Describe their features directly in the prompt.` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b1 } });
  } else if (f2) {
    const [styB64, subB64] = await Promise.all([downloadToB64(f1), downloadToB64(f2)]);
    parts.push({ text: `Subject identity is in Image A. Artistic style/environment is in Image B. Create ${count} prompts where the subject from A is in the world of B. Describe everything physically, no meta references.` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: subB64 } });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: styB64 } });
  } else {
    const b1 = await downloadToB64(f1);
    const instr = type === 'face' ? `Analyze person and create ${count} cinematic portrait prompts.` : `Extract the artistic style and apply to a new subject. Create ${count} prompts.`;
    parts.push({ text: instr });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b1 } });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: { systemInstruction, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { prompts: { type: Type.ARRAY, items: { type: Type.STRING } } } } }
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

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
}

async function answerCallback(id: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id, text }) });
}
