
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
  
  let systemInstruction = `You are a world-class Midjourney & Stable Diffusion Prompt Engineer.
  TASK: Generate detailed visual prompts that ensure high subject likeness.
  
  IDENTITY PRESERVATION (CRITICAL):
  - You must analyze the subject's physical identity. 
  - Instead of "a person" or "the model", describe their SPECIFIC features: face shape, eye color and shape, nose structure, lip fullness, hair texture/length, and skin tone.
  - This "physical description" acts as a text-based backup for the face-ID system.
  
  STYLE MAPPING:
  - If Style References are provided: Place the subject into that specific aesthetic/lighting.
  - Return the 'imageIndex' corresponding to the style image used.
  
  CLOTHING:
  - Specify detailed textures and fit.
  
  Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  if (subjectImages.length > 0) {
    parts.push({ text: `SUBJECT PHOTOS for Identity analysis:` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }

  if (styleImages.length > 0 && mode === GenerationMode.MATCH_STYLE) {
    parts.push({ text: `STYLE REFERENCE PHOTOS:` });
    styleImages.forEach((img, idx) => {
      parts.push({ text: `Style Image [${idx}]:` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } });
    });
    
    parts.push({ text: `
      ACTION: Create ${count} prompts for EACH Style Image. 
      In each prompt, FIRST describe the subject's unique physical features accurately, THEN the style/environment.
    ` });
  } 
  else {
    parts.push({ text: `Generate ${count} prompts. Focus heavily on describing the subject's physical traits to maintain identity.` });
    if (customText) parts.push({ text: `Context: ${customText}` });
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
