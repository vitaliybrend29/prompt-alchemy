
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
  
  let systemInstruction = `You are a world-class AI Visual Architect and Reverse Prompt Engineer.
  
  CORE MISSION: 
  Deconstruct the provided images to create hyper-realistic or stylistically perfect prompts.
  
  DETAILED ANALYSIS PROTOCOL:
  1. IDENTITY: Analyze the subject's face precisely (eye shape, jawline, skin texture, hair flow). They are the "Constant".
  2. LIGHTING: Identify light sources. Is it "volumetric fog", "high-key fashion lighting", "cinematic noir shadows", or "golden hour rim light"?
  3. COLOR & MOOD: Extract the exact color palette (e.g., "muted earth tones", "vibrant neon cyberpunk cyan and magenta", "Kodak Portra 400 film aesthetics").
  4. TEXTURE & MEDIUM: Is it digital art, a raw 35mm photo, oil on canvas, or 3D render? Look for "film grain", "sharp focus", "bokeh", or "brushstrokes".
  
  MODE SPECIFIC RULES:
  - MATCH_STYLE: You must REVERSE ENGINEER the "Artistic Style Reference". Describe its DNA (lighting, texture, angle) and place the "Target Identity" subject into that exact world. Do NOT say "in the style of". Describe the visual elements that create that style.
  - CHARACTER_SHEET: Focus on consistency. Front, side, and back views. High-detail clothing description.
  
  PROMPT STRUCTURE:
  [Shot Type] of [Detailed Subject Description based on identity photos], [Detailed Clothing], [Environment Description], [Precise Lighting and Color Grading], [Camera/Technical Info: e.g., shot on 35mm, f/1.8, high resolution, masterpiece].
  
  Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  // Добавляем фото лица как основной ориентир
  if (subjectImages.length > 0) {
    parts.push({ text: `PRIMARY SUBJECT IDENTITY (The person to be generated):` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }

  if (styleImages.length > 0 && mode === GenerationMode.MATCH_STYLE) {
    parts.push({ text: `ARTISTIC STYLE REFERENCES (Deconstruct these perfectly):` });
    styleImages.forEach((img, idx) => {
      parts.push({ text: `Reference Style [${idx}]:` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } });
    });
    
    parts.push({ text: `Create ${count} highly accurate prompts. Synthesize the Subject's Identity with the exact visual DNA (lighting, grain, color, composition) of the Reference Style images.` });
  } 
  else {
    parts.push({ text: `Generate ${count} cinematic prompts for the Subject.` });
    if (customText) parts.push({ text: `Scene Context: ${customText}` });
    if (mode === GenerationMode.CHARACTER_SHEET) {
      parts.push({ text: `Create a character reference sheet with multiple angles and outfit details.` });
    }
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
      // Если есть картинка стиля, используем её как превью, иначе - лицо
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
