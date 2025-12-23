
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_BASE}/createTask`;
const GET_TASK_URL = `${KIE_API_BASE}/getTask`; // Изменено с queryTask на getTask

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки.
 * Используем эндпоинт getTask, который является стандартным для Kie.ai.
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  console.log(`Polling status for task: ${taskId} using ${GET_TASK_URL}`);

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(GET_TASK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ taskId: taskId })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Polling error (${response.status}): ${errorText}`);
        
        // Если 404, возможно API еще не зарегистрировало задачу в очереди статусов
        if (response.status === 404) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw new Error(`Ошибка API при проверке статуса: ${response.status}`);
      }

      const result = await response.json();
      // Согласно примеру пользователя, данные приходят в поле "data"
      const taskData = result.data || result;

      console.log(`Task status response:`, taskData);

      if (taskData.state === "success") {
        console.log("Generation successful!");
        
        // Парсим результат
        let resultUrls: string[] = [];
        
        // 1. Проверяем resultJson (как в примере пользователя)
        if (taskData.resultJson) {
          try {
            const parsedResult = typeof taskData.resultJson === 'string' 
              ? JSON.parse(taskData.resultJson) 
              : taskData.resultJson;
            if (parsedResult.resultUrls) resultUrls = parsedResult.resultUrls;
          } catch (e) {
            console.error("Failed to parse resultJson:", e);
          }
        }
        
        // 2. Если нет в JSON, проверяем поле result.resultUrls
        if (resultUrls.length === 0 && taskData.result?.resultUrls) {
          resultUrls = taskData.result.resultUrls;
        }

        // 3. Крайний случай - прямые поля
        const finalUrl = resultUrls[0] || taskData.imageUrl || taskData.resultUrl;
        
        if (finalUrl) return finalUrl;
        throw new Error("Задача завершена, но ссылка на изображение не найдена.");
      }

      if (taskData.state === "failed" || taskData.state === "fail" || (taskData.code && taskData.code !== 200 && taskData.state !== "pending" && taskData.state !== "running")) {
        throw new Error(taskData.failMsg || taskData.msg || "Ошибка на стороне сервера Kie.ai.");
      }

      console.log(`Current state: ${taskData.state || 'processing'}...`);

    } catch (e: any) {
      console.error("Polling attempt failed:", e);
      if (attempts > 10) throw e; // После 10 реальных ошибок прерываемся
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации (5 минут).");
};

/**
 * Генерирует изображение через createTask
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден. Выберите ключ в настройках.");
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

    console.log("Creating Kie.ai task...");
    
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
      throw new Error(`Ошибка создания задачи (${createResponse.status}): ${errorText}`);
    }

    const createResult = await createResponse.json();
    const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id;
    
    if (!taskId) {
      console.error("Create task response missing ID:", createResult);
      throw new Error("Сервер не вернул ID задачи.");
    }

    return await pollTaskStatus(taskId);

  } catch (error: any) {
    console.error("Kie.ai Generation Service Error:", error);
    throw error;
  }
};
