
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
  
  let systemInstruction = `You are a professional AI Prompt Engineer specializing in high-end fashion and lifestyle photography.
  
  STYLE GUIDE (Follow this EXACTLY):
  - Start with shot type and subject: "A full-body portrait of a beautiful woman..."
  - Describe physical features based on photos: "long flowing hair, specific eye color, lip shape."
  - Describe clothing in detail: "form-fitting athletic top, matching leggings, silk dress, etc."
  - Describe the ENVIRONMENT/BACKGROUND: "modern bedroom with soft curtains, minimalist bed, luxury hotel lobby, etc."
  - Describe LIGHTING: "brightly lit, clean natural light from a window, soft and airy atmosphere."
  - End with technical keywords: "professional photography, 8k, highly detailed, masterwork."
  
  TASK:
  Generate prompts that act as a "Physical Passport" for the subject. Do not use generic terms like "the girl". Describe HER.
  
  Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  if (subjectImages.length > 0) {
    parts.push({ text: `REFERENCE SUBJECT PHOTOS:` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }

  if (styleImages.length > 0 && mode === GenerationMode.MATCH_STYLE) {
    parts.push({ text: `ARTISTIC STYLE REFERENCES:` });
    styleImages.forEach((img, idx) => {
      parts.push({ text: `Style [${idx}]:` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } });
    });
    
    parts.push({ text: `Create ${count} prompts for each style. Blend the subject's identity into these styles.` });
  } 
  else {
    parts.push({ text: `Generate ${count} highly descriptive prompts based on the subject's appearance.` });
    if (customText) parts.push({ text: `Scene Context: ${customText}` });
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
                  imageIndex: { type: Type.INTEGER },
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
      const refImg = (mode === GenerationMode.MATCH_STYLE && styleImages.length > 0)
        ? styleImages[idx]?.base64 || styleImages[0]?.base64 
        : subjectImages[0]?.base64;

      res.prompts.forEach(p => finalPrompts.push({ text: p, referenceImage: refImg }));
    });

    return finalPrompts;
  } catch (error: any) {
    console.error("Gemini Error:", error);
    throw error;
  }
};
