
import { GoogleGenAI, Type } from "@google/genai";
import { UploadedImage, GenerationMode } from "../types";

const cleanBase64 = (b64: string) => b64.split(',')[1] || b64;

export interface GeminiResponse {
  results: {
    imageIndex: number;
    prompts: string[];
  }[];
}

export const generatePrompts = async (
  styleImages: UploadedImage[],
  subjectImages: UploadedImage[],
  count: number,
  mode: GenerationMode,
  customText?: string
): Promise<{ text: string; referenceImage?: string }[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let systemInstruction = `You are a world-class Midjourney Prompt Engineer.
  TASK: Generate detailed, professional visual prompts.
  
  IDENTITY PRESERVATION:
  - Subject images provided are of the SAME person. Analyze all to capture their essence.
  - Describe the person's features (face, hair, build) directly in the prompt to ensure consistency.
  
  STYLE MAPPING:
  - If multiple Style References are provided: Generate ${count} unique prompts for EACH style image.
  - Return the 'imageIndex' corresponding to the specific style image used.
  
  CLOTHING:
  - Specify form-fitting, athletic, or high-fashion clothing that emphasizes a fit silhouette.
  
  Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  // Добавляем фото модели
  if (subjectImages.length > 0) {
    parts.push({ text: `SUBJECT/IDENTITY PHOTOS (Use these for person's appearance):` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }

  // Добавляем фото стилей (если есть)
  if (styleImages.length > 0 && mode === GenerationMode.MATCH_STYLE) {
    parts.push({ text: `STYLE REFERENCE PHOTOS:` });
    styleImages.forEach((img, idx) => {
      parts.push({ text: `Style Image [${idx}]:` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } });
    });
    
    parts.push({ text: `
      ACTION: For EACH Style Image provided above, generate ${count} prompts.
      Each prompt should place the Subject into the aesthetic, lighting, and environment of that specific Style Image.
      Return imageIndex for the Style Image used.
    ` });
  } 
  else if (mode === GenerationMode.CHARACTER_SHEET) {
    parts.push({ text: `Generate ${count} prompts for a character sheet (front, side, back views) for the subject.` });
  }
  else if (mode === GenerationMode.CUSTOM_SCENE) {
    parts.push({ text: `Generate ${count} prompts for the subject in this scene: "${customText}".` });
  }
  else {
    parts.push({ text: `Generate ${count} creative high-fashion prompts for the subject.` });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  imageIndex: { type: Type.INTEGER, description: "Index of the reference image used" },
                  prompts: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["imageIndex", "prompts"]
              }
            }
          },
          required: ["results"]
        }
      }
    });

    const parsed: GeminiResponse = JSON.parse(response.text || '{"results":[]}');
    const finalPrompts: { text: string; referenceImage?: string }[] = [];

    parsed.results.forEach(res => {
      const idx = res.imageIndex || 0;
      // Если есть стили - берем стиль, если нет - берем фото субъекта
      const refImg = (mode === GenerationMode.MATCH_STYLE && styleImages.length > 0)
        ? styleImages[idx]?.base64 || styleImages[0]?.base64 
        : subjectImages[idx]?.base64 || subjectImages[0]?.base64;

      res.prompts.forEach(p => finalPrompts.push({ text: p, referenceImage: refImg }));
    });

    return finalPrompts;
  } catch (error: any) {
    console.error("Gemini Error:", error);
    throw error;
  }
};
