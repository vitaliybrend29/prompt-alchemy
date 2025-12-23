
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_V1 = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_V1}/createTask`;
// По наиболее актуальным данным для этой версии API:
const STATUS_URL = `${KIE_API_V1}/status`; 

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки.
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  console.log(`Starting polling for task: ${taskId}`);

  while (attempts < maxAttempts) {
    try {
      // Пробуем GET запрос с параметром в query string - это стандарт для /status
      const response = await fetch(`${STATUS_URL}?taskId=${taskId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        }
      });

      if (!response.ok) {
        // Если 404 - задача еще не зарегистрирована в системе статусов, это нормально
        if (response.status === 404) {
          console.log(`Task ${taskId} not found yet (404), waiting...`);
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        
        // Если 405, значит статус проверяется через POST
        if (response.status === 405) {
            const postResponse = await fetch(STATUS_URL, {
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

        throw new Error(`HTTP Error: ${response.status}`);
      }

      const result = await response.json();
      const taskData = result.data || result;
      
      return await handleTaskData(taskData);

    } catch (e: any) {
      if (e.message.includes('success_url')) return e.message.split('||')[1]; // Костыль для возврата из handleTaskData
      
      console.error("Polling attempt failed:", e.message);
      // Если это не фатальная ошибка, продолжаем
      if (attempts > 20) throw e;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }

  throw new Error("Превышено время ожидания (5 минут).");
};

/**
 * Вспомогательная функция для обработки данных задачи
 */
async function handleTaskData(taskData: any): Promise<string> {
    console.log(`Task state: ${taskData.state}`);

    if (taskData.state === "success") {
        let resultUrls: string[] = [];
        
        if (taskData.resultJson) {
            try {
                const parsed = typeof taskData.resultJson === 'string' 
                    ? JSON.parse(taskData.resultJson) 
                    : taskData.resultJson;
                if (parsed.resultUrls) resultUrls = parsed.resultUrls;
            } catch (e) {}
        }

        if (resultUrls.length === 0 && taskData.result?.resultUrls) {
            resultUrls = taskData.result.resultUrls;
        }

        const url = resultUrls[0] || taskData.imageUrl || taskData.resultUrl;
        if (url) {
            // Используем throw как способ выйти из цикла в pollTaskStatus
            throw new Error(`success_url||${url}`);
        }
    }

    if (taskData.state === "failed" || taskData.state === "fail") {
        throw new Error(taskData.failMsg || taskData.msg || "Task failed");
    }
    
    return ""; // Еще выполняется
}

/**
 * Генерирует изображение через createTask
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден.");
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

    const createResponse = await fetch(CREATE_TASK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const createResult = await createResponse.json();
    const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id;
    
    if (!taskId) {
      throw new Error(createResult.msg || "Failed to get taskId");
    }

    return await pollTaskStatus(taskId);

  } catch (error: any) {
    if (error.message.startsWith('success_url||')) {
        return error.message.split('||')[1];
    }
    throw error;
  }
};
