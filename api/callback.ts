
export default async function handler(req: any, res: any) {
  // Разрешаем запросы со всех доменов (CORS)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Обработка preflight запроса
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log('--- CALLBACK RECEIVED ---');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  // Читаем тело запроса (Vercel парсит JSON автоматически, если Content-Type верный)
  const body = req.body;
  console.log('Body:', JSON.stringify(body, null, 2));

  try {
    // В некоторых случаях Kie.ai присылает данные в поле taskId или data
    const taskId = body?.taskId || body?.data?.taskId || body?.job_id;
    const status = body?.status || body?.data?.state || body?.state;
    const imageUrl = body?.data?.resultUrls?.[0] || body?.data?.imageUrl || body?.imageUrl;

    if (taskId) {
      console.log(`Processing Task: ${taskId}, Status: ${status}`);
      
      // Если есть URL картинки и статус успех - логируем победу
      if (imageUrl && (status === 'success' || status === 'COMPLETED')) {
        console.log(`SUCCESS: Task ${taskId} is ready! Image: ${imageUrl}`);
        
        // Тут можно добавить отправку в Telegram через твой существующий бот-токен
        if (process.env.TELEGRAM_BOT_TOKEN) {
          // fetch(...) к Telegram API
        }
      }
    }

    // Всегда отвечаем 200 OK, иначе Kie.ai будет спамить ретраями
    return res.status(200).json({ 
      received: true, 
      timestamp: new Date().toISOString() 
    });
  } catch (error: any) {
    console.error('Callback parsing error:', error.message);
    return res.status(200).json({ error: 'Log saved, but processing failed' });
  }
}
