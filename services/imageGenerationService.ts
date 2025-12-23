
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_JOBS_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_JOBS_BASE}/createTask`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки.
 * В Kie.ai статус часто проверяется через GET /api/v1/jobs/{taskId}
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  // URL вида https://api.kie.ai/api/v1/jobs/ВАШ_ID
  const statusUrl = `${KIE_API_JOBS_BASE}/${taskId}`;

  console.log(`Starting polling for task: ${taskId} at ${statusUrl}`);

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        }
      });

      if (!response.ok) {
        // Если 404 - задача еще "прогревается" или не создана в БД статусов.
        // Для Kie.ai это нормально в первые 10-20 секунд.
        if (response.status === 404) {
          console.log(`Attempt ${attempts}: Task not found (404), retrying in 5s...`);
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        
        // Если 405 (Method Not Allowed), пробуем POST на тот же URL (некоторые прокси требуют POST)
        if (response.status === 405) {
            const postResponse = await fetch(statusUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ taskId })
            });
            const postResult = await postResponse.json();
            return handleTaskData(postResult.data || postResult);
        }

        throw new Error(`API Error ${response.status}`);
      }

      const result = await response.json();
      const taskData = result.data || result;
      
      return await handleTaskData(taskData);

    } catch (e: any) {
      // Если мы получили URL через "бросок исключения" из handleTaskData, возвращаем его
      if (e.message.startsWith('URL_FOUND:')) {
          return e.message.replace('URL_FOUND:', '');
      }
      
      console.warn("Polling error:", e.message);
      // Если это не фатальная ошибка, продолжаем до 20 попыток
      if (attempts > 20) throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации (300 сек).");
};

/**
 * Парсинг данных задачи и поиск URL изображения
 */
async function handleTaskData(taskData: any): Promise<string> {
    const state = taskData.state || taskData.status;
    console.log(`Task state: ${state}`);

    if (state === "success" || state === "COMPLETED" || state === "succeeded") {
        let resultUrls: string[] = [];
        
        // Проверка вложенного JSON (resultJson)
        if (taskData.resultJson) {
            try {
                const parsed = typeof taskData.resultJson === 'string' 
                    ? JSON.parse(taskData.resultJson) 
                    : taskData.resultJson;
                if (parsed.resultUrls) resultUrls = parsed.resultUrls;
            } catch (e) {}
        }

        // Проверка вложенного объекта result
        if (resultUrls.length === 0 && taskData.result?.resultUrls) {
            resultUrls = taskData.result.resultUrls;
        }

        const finalUrl = resultUrls[0] || taskData.imageUrl || taskData.resultUrl || (taskData.result && typeof taskData.result === 'string' ? taskData.result : null);
        
        if (finalUrl && typeof finalUrl === 'string' && finalUrl.startsWith('http')) {
            // "Выбрасываем" URL, чтобы выйти из цикла опроса
            throw new Error(`URL_FOUND:${finalUrl}`);
        }
    }

    if (state === "failed" || state === "fail" || state === "ERROR") {
        throw new Error(taskData.failMsg || taskData.msg || "Generation failed on server.");
    }
    
    return ""; // Еще выполняется (pending/running)
}

/**
 * Создание задачи генерации
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY (Kie.ai) не найден в настройках.");
  }

  try {
    const payload = {
      model: "google/nano-banana-edit",
      input: {
        prompt: prompt,
        image_urls: [faceUrl],
        output_format: "png",
        image_size: "1:1"
      }
    };

    console.log("Sending createTask request...");
    
    const createResponse = await fetch(CREATE_TASK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Create failed (${createResponse.status}): ${errorText}`);
    }

    const createResult = await createResponse.json();
    const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id || createResult.id;
    
    if (!taskId) {
      throw new Error("API did not return taskId. Check your balance/key.");
    }

    return await pollTaskStatus(taskId);

  } catch (error: any) {
    if (error.message.startsWith('URL_FOUND:')) {
        return error.message.replace('URL_FOUND:', '');
    }
    throw error;
  }
};
