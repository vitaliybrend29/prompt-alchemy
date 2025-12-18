export interface UploadedImage {
  id: string;
  file?: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

export enum GenerationMode {
  MATCH_STYLE = 'MATCH_STYLE',
  RANDOM_CREATIVE = 'RANDOM_CREATIVE',
}

export interface GeneratedPrompt {
  text: string;
  referenceImage?: string; // base64 data of the specific reference used for this prompt
}

export interface PromptGroup {
  id: string;
  timestamp: number;
  prompts: GeneratedPrompt[];
  styleReferences: string[]; // original style images
  subjectReferences: string[]; // original subject images
  mode: GenerationMode;
}

export enum LoadingState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  ERROR = 'ERROR',
}