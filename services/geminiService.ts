
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
  Focus intensely on capturing the physical essence and mood of the reference images.
  
  DETAILED ANALYSIS PROTOCOL:
  1. IDENTITY: Analyze the subject's face precisely (eye shape, jawline, skin texture, hair flow). They are the "Constant".
  2. POSE & KINETICS: Describe the exact body position. Is the subject leaning, sitting, twisting? Specify the angle of the head and shoulders.
  3. HANDS & GESTURES: (CRITICAL) Detail the position of the hands and fingers. E.g., "fingers interlaced", "hand resting delicately on the chin", "one hand tucked into a pocket", "gesturing with open palms".
  4. EMOTION & EXPRESSION: Capture the soul of the image. Is it "stoic determination", "a subtle, enigmatic smirk", "eyes filled with longing", or "joyful, exuberant laughter"?
  5. LIGHTING: Identify light sources. E.g., "volumetric fog", "high-key fashion lighting", "cinematic noir shadows", "rim light".
  6. COLOR & MOOD: Extract the exact color palette (e.g., "muted earth tones", "vibrant neon cyan and magenta").
  7. TEXTURE & MEDIUM: Identify if it's "35mm film grain", "sharp digital focus", "oil painting brushstrokes", etc.
  
  MODE SPECIFIC RULES:
  - MATCH_STYLE: REVERSE ENGINEER the "Artistic Style Reference". Describe its physical DNA (lighting, texture, pose, emotion) and place the "Target Identity" subject into that exact state. Describe the hands and pose from the style reference as part of the style's composition.
  - CHARACTER_SHEET: Focus on consistency across angles. 
  
  PROMPT STRUCTURE:
  [Shot Type] of [Detailed Subject Description], [Specific Pose and Hand Position], [Specific Emotional Expression], [Detailed Clothing], [Environment], [Precise Lighting and Color], [Technical Info: e.g., shot on Hasselblad, f/1.8].
  
  Output MUST be valid JSON.`;

  const parts: any[] = [];
  
  // Добавляем фото лица как основной ориентир
  if (subjectImages.length > 0) {
    parts.push({ text: `PRIMARY SUBJECT IDENTITY (Face constant):` });
    subjectImages.forEach(img => parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } }));
  }

  if (styleImages.length > 0 && mode === GenerationMode.MATCH_STYLE) {
    parts.push({ text: `ARTISTIC STYLE & COMPOSITION REFERENCES (Analyze Pose, Hands, and Emotion here):` });
    styleImages.forEach((img, idx) => {
      parts.push({ text: `Reference Style [${idx}]:` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64(img.base64) } });
    });
    
    parts.push({ text: `Create ${count} prompts. Synthesize the Subject's Identity with the exact pose, hand gestures, facial expression, and visual DNA (lighting, grain, color) of the style references.` });
  } 
  else {
    parts.push({ text: `Generate ${count} cinematic prompts for the Subject.` });
    if (customText) parts.push({ text: `Scene Context: ${customText}` });
    if (mode === GenerationMode.CHARACTER_SHEET) {
      parts.push({ text: `Create a character reference sheet with multiple angles.` });
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
