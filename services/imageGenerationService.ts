
/**
 * Сервис для генерации изображений через Kie.ai API
 */

const KIE_API_URL = "https://api.kie.ai/api/v1/jobs";
const KIE_API_KEY = process.env.KIE_API_KEY || process.env.API_KEY; // Используем KIE_API_KEY или общий ключ

/**
 * Опрашивает статус задачи до завершения или ошибки
 */
const pollTaskStatus = async (taskId: string): Promise<string> => {
  const maxAttempts = 60; // 2 минуты максимум (60 * 2сек)
  let attempts = 0;

  while (attempts < maxAttempts) {
    const response = await fetch(`${KIE_API_URL}/queryTask?taskId=${taskId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${KIE_API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Ошибка при проверке статуса: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.code !== 200) {
      throw new Error(result.message || "Ошибка API при опросе статуса");
    }

    const taskData = result.data;

    if (taskData.state === "success") {
      const resultJson = JSON.parse(taskData.resultJson);
      if (resultJson.resultUrls && resultJson.resultUrls.length > 0) {
        return resultJson.resultUrls[0];
      }
      throw new Error("Задача завершена, но URL изображения не найден.");
    }

    if (taskData.state === "fail") {
      throw new Error(taskData.failMsg || "Задача завершилась с ошибкой на стороне сервера.");
    }

    // Ждем 2 секунды перед следующим опросом
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;
  }

  throw new Error("Превышено время ожидания генерации изображения.");
};

/**
 * Генерирует изображение на основе промта и фото лица через Kie.ai
 */
export const generateGeminiImage = async (prompt: string, faceBase64?: string): Promise<string> => {
  if (!KIE_API_KEY) {
    throw new Error("KIE_API_KEY не задан. Пожалуйста, настройте переменные окружения.");
  }

  // Подготовка входных данных
  const input: any = {
    prompt: prompt,
    output_format: "png",
    image_size: "1:1"
  };

  if (faceBase64) {
    // В большинстве случаев API принимают Data URL вместо прямой ссылки
    input.image_urls = [faceBase64];
  } else {
    throw new Error("Для работы модели редактирования необходимо фото лица.");
  }

  try {
    // 1. Создание задачи
    const createResponse = await fetch(`${KIE_API_URL}/createTask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${KIE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/nano-banana-edit",
        input: input
      }),
    });

    if (!createResponse.ok) {
      const errData = await createResponse.json().catch(() => ({}));
      throw new Error(errData.message || `Ошибка создания задачи: ${createResponse.statusText}`);
    }

    const createResult = await createResponse.json();
    if (createResult.code !== 200 || !createResult.data?.taskId) {
      throw new Error(createResult.message || "Не удалось получить ID задачи от Kie.ai");
    }

    const taskId = createResult.data.taskId;

    // 2. Поллинг статуса до получения результата
    const imageUrl = await pollTaskStatus(taskId);
    return imageUrl;

  } catch (error: any) {
    console.error("Kie.ai Generation Error:", error);
    throw new Error(error.message || "Непредвиденная ошибка при работе с Kie.ai");
  }
};
