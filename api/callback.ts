
export default async function handler(req: any, res: any) {
  // Kie.ai отправляет POST запрос при завершении задачи
  if (req.method !== 'POST') {
    return res.status(200).json({ message: 'Callback endpoint active. Use POST to send data.' });
  }

  try {
    const payload = req.body;
    console.log('Received callback from Kie.ai:', JSON.stringify(payload, null, 2));

    /**
     * Типовая структура payload от Kie.ai:
     * {
     *   "taskId": "...",
     *   "status": "success", // или "failed"
     *   "data": {
     *     "resultUrls": ["https://..."],
     *     "state": "success"
     *   }
     * }
     */

    const taskId = payload.taskId || payload.data?.taskId;
    const status = payload.status || payload.data?.state;
    const imageUrl = payload.data?.resultUrls?.[0] || payload.data?.imageUrl;

    if (status === 'success' && imageUrl) {
      console.log(`Success! Task ${taskId} finished. Image: ${imageUrl}`);
      // Здесь можно добавить логику, например:
      // 1. Сохранить в базу данных (Supabase/Firebase)
      // 2. Отправить уведомление в Telegram (используя ваш существующий бот-токен)
      
      if (process.env.TELEGRAM_BOT_TOKEN) {
        // Если есть токен бота, можно уведомлять админа о каждой успешной генерации на сайте
        // Это полезно для мониторинга
      }
    }

    // Всегда отвечаем 200 OK, чтобы Kie.ai не пытался отправить повторно
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Callback error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
