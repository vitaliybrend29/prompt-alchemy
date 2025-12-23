
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
  TASK: Generate detailed, professional visual prompts in English.
  
  CORE IDENTITY PRESERVATION:
  - Analyze the SUBJECT's facial features (structure, eyes, nose, lips) and hair.
  - In EVERY prompt, describe the subject's features clearly so the character remains consistent.
  
  CLOTHING & FIGURE RULES (STRICT):
  - Always specify clothing that emphasizes a fit and toned physique.
  - Recommended attire: "form-fitting sports bra and tight athletic shorts", "minimalist bodysuit", or "elegant lingerie that highlights the silhouette".
  - Use materials like "spandex", "silk", or "technical fabric" to add realism.
  
  MODE SPECIFIC RULES:
  - If mode is CHARACTER_SHEET: You must generate ${count} INDIVIDUAL prompts, each for a different specific angle. 
    Prompt 1: Full body shot, front view, straight posture.
    Prompt 2: Full body shot, back view, showing the back and legs.
    Prompt 3: Side profile shot, showing the silhouette.
    Prompt 4: Close-up portrait or dynamic 3/4 view.
    Each prompt must be a standalone masterpiece, not a combined sheet.
  
  Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  if (subjectImages.length > 0) {
    parts.push({ text: `SUBJECT REFERENCE PHOTOS (The person to maintain in all prompts):` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }

  if (mode === GenerationMode.CHARACTER_SHEET) {
    parts.push({ text: `
      ACTION: Generate ${count} SEPARATE prompts for a character reference set.
      CLOTHING: The subject must wear form-fitting attire (sports top and shorts or lingerie) that emphasizes the figure.
      ANGLES TO COVER: Provide a sequence of different angles (front, back, side, etc.).
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["prompt 1 (front view)", "prompt 2 (back view)", ...] } ] }
    ` });
  }
  else if (mode === GenerationMode.CUSTOM_SCENE && customText) {
    parts.push({ text: `
      SCENE CONTEXT: "${customText}".
      Generate ${count} prompts placing this specific person in this scene. 
      Ensure clothing highlights their figure appropriately for the scene.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
  }
  else if (mode === GenerationMode.RANDOM_CREATIVE) {
    parts.push({ text: `
      Generate ${count} creative, high-fashion editorial prompts for this person.
      Experiment with lighting (neon, golden hour, rim lighting) and emphasize their physique.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
  } 
  else if (styleImages.length > 0) {
    parts.push({ text: `STYLE REFERENCES:` });
    styleImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
    
    parts.push({ text: `
      Generate ${count} prompts merging the SUBJECT's identity with the STYLE's aesthetic and environment.
      Maintain the figure-emphasizing clothing instructions.
      Return JSON: { "results": [ { "imageIndex": 0, "prompts": ["...", "..."] } ] }
    ` });
  } else {
    throw new Error("Missing required reference images.");
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
      const index = res.imageIndex || 0;
      const refImg = mode === GenerationMode.MATCH_STYLE 
        ? styleImages[index]?.base64 || styleImages[0]?.base64 
        : subjectImages[index]?.base64 || subjectImages[0]?.base64;

      res.prompts.forEach(p => finalPrompts.push({ text: p, referenceImage: refImg }));
    });

    return finalPrompts;
  } catch (error: any) {
    throw error;
  }
};
