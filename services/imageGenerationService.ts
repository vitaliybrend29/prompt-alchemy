
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1";
const KIE_API_JOBS = `${KIE_API_BASE}/jobs`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки
 * Стандартный путь Kie.ai: GET /jobs/{taskId}
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  const pollUrl = `${KIE_API_JOBS}/${taskId}`;
  console.log(`Polling task status at: ${pollUrl}`);

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(pollUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (response.status === 404) {
        // Иногда API нужно время, чтобы задача появилась в базе после создания
        console.warn("Task not found yet (404), retrying...");
      } else if (!response.ok) {
        throw new Error(`Ошибка сети (${response.status}): ${response.statusText}`);
      } else {
        const result = await response.json();

        // Kie.ai возвращает объект задачи в поле data или сразу в корне
        const taskData = result.data || result;

        if (taskData.state === "success") {
          console.log("Task success! Result data:", taskData);
          
          // Результат может быть в resultJson (строка) или result (объект)
          let resultObj = taskData.result;
          if (taskData.resultJson && typeof taskData.resultJson === 'string') {
            try {
              resultObj = JSON.parse(taskData.resultJson);
            } catch(e) {}
          }
            
          if (resultObj && resultObj.resultUrls && resultObj.resultUrls.length > 0) {
            return resultObj.resultUrls[0];
          }
          
          // Запасной вариант: проверка прямых полей
          if (taskData.imageUrl) return taskData.imageUrl;
          
          throw new Error("URL результата не найден в ответе API.");
        }

        if (taskData.state === "fail") {
          throw new Error(taskData.failMsg || "Задача завершилась с ошибкой на стороне сервера.");
        }
        
        console.log(`Task state: ${taskData.state || 'pending'}...`);
      }

    } catch (e: any) {
      console.error("Polling error:", e);
      throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации (3 мин).");
};

/**
 * Генерирует изображение на основе уже готового публичного URL
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден. Пожалуйста, выберите ключ в настройках.");
  }

  if (!faceUrl || !faceUrl.startsWith('http')) {
    throw new Error("Отсутствует ссылка на изображение лица. Пожалуйста, загрузите фото заново.");
  }

  try {
    const input: any = {
      prompt: prompt,
      output_format: "png",
      image_size: "1:1",
      image_urls: [faceUrl]
    };

    console.log("Creating Kie.ai task at:", KIE_API_JOBS);
    
    const createResponse = await fetch(KIE_API_JOBS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/nano-banana-edit",
        input: input
      }),
    });

    const createResult = await createResponse.json().catch(() => ({}));
    
    // В некоторых версиях API ответ успешен, если code === 200 или success === true
    if (!createResponse.ok || (createResult.code && createResult.code !== 200)) {
      const msg = createResult.message || createResult.msg || createResponse.statusText;
      throw new Error(msg || "Ошибка создания задачи в Kie.ai");
    }

    // Извлекаем taskId (он может быть в data.taskId или data.id)
    const taskId = createResult.data?.taskId || createResult.data?.id || createResult.taskId;
    
    if (!taskId) {
      console.error("Full API response:", createResult);
      throw new Error("Не удалось получить ID задачи (taskId) от сервера.");
    }

    console.log("Task created successfully. ID:", taskId);
    return await pollTaskStatus(taskId);

  } catch (error: any) {
    console.error("Kie.ai Creation Error:", error);
    throw new Error(error.message || "Ошибка при запуске генерации.");
  }
};
