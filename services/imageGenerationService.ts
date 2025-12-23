
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_URL = "https://api.kie.ai/api/v1/jobs";

// Безопасное получение ключа (учитываем, что Vite может превратить undefined в строку "undefined")
const getApiKey = () => {
  const key = process.env.KIE_API_KEY || process.env.API_KEY;
  if (!key || key === 'undefined' || key === 'null') return null;
  return key;
};

/**
 * Опрашивает статус задачи до завершения или ошибки
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const apiKey = getApiKey();
  const maxAttempts = 60; // 2 минуты максимум (60 * 2сек)
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`${KIE_API_URL}/queryTask?taskId=${taskId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Ошибка сети при проверке статуса: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.code !== 200) {
        throw new Error(result.message || `Ошибка API (${result.code}) при опросе статуса`);
      }

      const taskData = result.data;

      if (taskData.state === "success") {
        const resultJson = typeof taskData.resultJson === 'string' 
          ? JSON.parse(taskData.resultJson) 
          : taskData.resultJson;
          
        if (resultJson.resultUrls && resultJson.resultUrls.length > 0) {
          return resultJson.resultUrls[0];
        }
        throw new Error("Задача завершена, но URL изображения не найден в resultJson.");
      }

      if (taskData.state === "fail") {
        throw new Error(taskData.failMsg || "Задача завершилась с ошибкой на стороне Kie.ai.");
      }

    } catch (e: any) {
      console.error("Polling error:", e);
      throw e;
    }

    // Ждем 2 секунды перед следующим опросом
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации изображения (2 минуты).");
};

/**
 * Генерирует изображение на основе промта и фото лица через Kie.ai
 */
export const generateGeminiImage = async (prompt: string, faceBase64?: string): Promise<string> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error("API KEY не найден. Убедитесь, что KIE_API_KEY или API_KEY заданы в настройках Vercel и проект был пересобран.");
  }

  // Подготовка входных данных
  // Kie.ai ожидает prompt и image_urls в input
  const input: any = {
    prompt: prompt,
    output_format: "png",
    image_size: "1:1"
  };

  if (faceBase64) {
    // faceBase64 из ImageUploader уже содержит "data:image/jpeg;base64,..."
    input.image_urls = [faceBase64];
  } else {
    throw new Error("Необходимо фото лица для генерации.");
  }

  try {
    console.log("Creating Kie.ai task with prompt:", prompt.substring(0, 50) + "...");
    
    // 1. Создание задачи
    const createResponse = await fetch(`${KIE_API_URL}/createTask`, {
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
    
    if (!createResponse.ok || createResult.code !== 200) {
      console.error("Kie.ai Error Response:", createResult);
      const msg = createResult.message || createResult.msg || createResponse.statusText;
      throw new Error(msg || "Не удалось создать задачу в Kie.ai (проверьте API ключ и формат данных)");
    }

    if (!createResult.data?.taskId) {
      throw new Error("API вернул успех, но taskId отсутствует в ответе.");
    }

    const taskId = createResult.data.taskId;
    console.log("Task created successfully. ID:", taskId);

    // 2. Поллинг статуса до получения результата
    return await pollTaskStatus(taskId);

  } catch (error: any) {
    console.error("Kie.ai Full Error:", error);
    throw new Error(error.message || "Непредвиденная ошибка при работе с Kie.ai");
  }
};
