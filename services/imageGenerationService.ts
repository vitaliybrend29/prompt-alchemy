
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";
const CREATE_TASK_URL = `${KIE_API_BASE}/createTask`;
const QUERY_TASK_URL = `${KIE_API_BASE}/queryTask`;

// Безопасное получение ключа
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки.
 * ВАЖНО: Kie.ai часто требует POST для queryTask.
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; 
  let attempts = 0;

  console.log(`Starting polling for task: ${taskId}`);

  while (attempts < maxAttempts) {
    try {
      // Используем POST для проверки статуса, как того требует спецификация многих подобных API
      const response = await fetch(QUERY_TASK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ taskId: taskId })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Status check failed (${response.status}):`, errorText);
        // Если 404 - возможно задача еще "прогревается" в системе
        if (response.status === 404) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw new Error(`Ошибка сети при опросе: ${response.status}`);
      }

      const result = await response.json();
      const taskData = result.data || result;

      console.log(`Task ${taskId} state: ${taskData.state}`);

      if (taskData.state === "success") {
        console.log("Task success!", taskData);
        
        let resultObj = taskData.result;
        if (taskData.resultJson && typeof taskData.resultJson === 'string') {
          try {
            resultObj = JSON.parse(taskData.resultJson);
          } catch(e) {}
        }
          
        if (resultObj && resultObj.resultUrls && resultObj.resultUrls.length > 0) {
          return resultObj.resultUrls[0];
        }
        
        if (taskData.imageUrl) return taskData.imageUrl;
        if (taskData.resultUrl) return taskData.resultUrl;
        
        throw new Error("URL результата не найден в ответе API.");
      }

      if (taskData.state === "failed" || taskData.state === "fail") {
        throw new Error(taskData.failMsg || taskData.msg || "Задача завершилась с ошибкой.");
      }

    } catch (e: any) {
      console.error("Polling attempt error:", e);
      if (attempts > 5 && !e.message.includes('success')) {
         // Если после 5 попыток всё еще ошибки связи - выходим
         // Но продолжаем если это просто ожидание (state === 'pending')
      }
    }

    // Ждем 5 секунд перед следующей проверкой
    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации (300 сек).");
};

/**
 * Генерирует изображение через createTask
 */
export const generateGeminiImage = async (prompt: string, faceUrl: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден. Пожалуйста, выберите ключ в настройках.");
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

    console.log("Creating task at:", CREATE_TASK_URL);
    
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
      throw new Error(`Ошибка API при создании (${createResponse.status}): ${errorText}`);
    }

    const createResult = await createResponse.json();
    // Извлекаем taskId (он может быть в разных местах в зависимости от версии API)
    const taskId = createResult.data?.taskId || createResult.taskId || createResult.data?.id;
    
    if (!taskId) {
      console.error("Invalid create response:", createResult);
      throw new Error("API не вернул taskId. Проверьте ключ и баланс.");
    }

    return await pollTaskStatus(taskId);

  } catch (error: any) {
    console.error("Generation service error:", error);
    throw error;
  }
};
