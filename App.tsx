
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, TelegramIcon, SettingsIcon, PlayIcon, GridIcon } from './components/Icons';

const MAX_IMAGES_PER_CATEGORY = 5;
const MAX_HISTORY_ITEMS = 10;

const createThumbnail = (base64: string, maxWidth = 200): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = img.width / img.height;
      canvas.width = maxWidth;
      canvas.height = maxWidth / ratio;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64;
  });
};

const App: React.FC = () => {
  const [styleImages, setStyleImages] = useState<UploadedImage[]>([]);
  const [subjectImages, setSubjectImages] = useState<UploadedImage[]>([]);
  const [promptCount, setPromptCount] = useState<number>(3);
  const [genMode, setGenMode] = useState<GenerationMode>(GenerationMode.MATCH_STYLE);
  const [customSceneText, setCustomSceneText] = useState<string>('');
  const [history, setHistory] = useState<PromptGroup[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  const [imgbbKey, setImgbbKey] = useState(process.env.IMGBB_API_KEY || localStorage.getItem('imgbb_key') || '');
  
  const defaultCallback = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/callback` 
    : '';
  const [callbackUrl, setCallbackUrl] = useState(localStorage.getItem('kie_callback_url') || defaultCallback);

  useEffect(() => {
    const saved = localStorage.getItem('prompt_alchemy_v5');
    if (saved) {
      try {
        const parsedHistory: PromptGroup[] = JSON.parse(saved);
        setHistory(parsedHistory);
        parsedHistory.forEach((group, gIdx) => {
          group.prompts.forEach((prompt, pIdx) => {
            if (prompt.taskId && !prompt.generatedImageUrl && !prompt.error) {
              resumePolling(gIdx, pIdx, prompt.taskId);
            }
          });
        });
      } catch (e) {
        localStorage.removeItem('prompt_alchemy_v5');
      }
    }
  }, []);

  const testWebhook = async () => {
    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          test: true, 
          taskId: "test_" + Date.now(),
          status: "success",
          data: { state: "success", imageUrl: "https://via.placeholder.com/150" }
        })
      });
      const data = await response.json();
      alert("Webhook Reachable! Response: " + JSON.stringify(data));
    } catch (e: any) {
      alert("Webhook Error: " + e.message);
    }
  };

  useEffect(() => {
    const checkApiKey = async () => {
      // @ts-ignore
      if (window.aistudio) {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          // @ts-ignore
          await window.aistudio.openSelectKey();
        }
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    try {
      const historyToSave = history.slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem('prompt_alchemy_v5', JSON.stringify(historyToSave));
    } catch (e) {}
  }, [history]);

  useEffect(() => {
    if (imgbbKey && imgbbKey !== process.env.IMGBB_API_KEY) {
      localStorage.setItem('imgbb_key', imgbbKey);
    }
  }, [imgbbKey]);

  useEffect(() => {
    localStorage.setItem('kie_callback_url', callbackUrl);
  }, [callbackUrl]);

  const resumePolling = async (groupIdx: number, promptIdx: number, taskId: string) => {
    setHistory(prev => {
      const next = [...prev];
      if (next[groupIdx]?.prompts[promptIdx]) {
        next[groupIdx].prompts[promptIdx] = { 
          ...next[groupIdx].prompts[promptIdx], 
          isGenerating: true,
          taskId: taskId 
        };
      }
      return next;
    });

    try {
      const imageUrl = await pollTaskStatus(taskId);
      setHistory(prev => {
        const next = [...prev];
        if (next[groupIdx]?.prompts[promptIdx]) {
          next[groupIdx].prompts[promptIdx] = { 
            ...next[groupIdx].prompts[promptIdx], 
            isGenerating: false, 
            generatedImageUrl: imageUrl 
          };
        }
        return next;
      });
    } catch (err: any) {
      setHistory(prev => {
        const next = [...prev];
        if (next[groupIdx]?.prompts[promptIdx]) {
          next[groupIdx].prompts[promptIdx] = { 
            ...next[groupIdx].prompts[promptIdx], 
            isGenerating: false, 
            error: err.message 
          };
        }
        return next;
      });
    }
  };

  const convertToPublicUrl = async (image: UploadedImage): Promise<string | undefined> => {
    const keyToUse = imgbbKey || process.env.IMGBB_API_KEY;
    if (!keyToUse || keyToUse === 'undefined') {
      setError("Please set an ImgBB API Key in Settings.");
      return undefined;
    }
    try {
      const formData = new FormData();
      const base64Data = image.base64.split(',')[1];
      formData.append('image', base64Data);
      const response = await fetch(`https://api.imgbb.com/1/upload?key=${keyToUse}`, { method: 'POST', body: formData });
      const result = await response.json();
      return result.success ? result.data.url : undefined;
    } catch (e) { return undefined; }
  };

  const handleImageUpload = async (newImages: UploadedImage[], setter: React.Dispatch<React.SetStateAction<UploadedImage[]>>) => {
    setter(prev => [...prev, ...newImages].slice(0, MAX_IMAGES_PER_CATEGORY));
    for (const img of newImages) {
      setter(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: true } : i));
      const url = await convertToPublicUrl(img);
      setter(prev => prev.map(i => i.id === img.id ? { ...i, publicUrl: url, isUploading: false } : i));
    }
  };

  const handleGenerate = async () => {
    if (genMode === GenerationMode.CUSTOM_SCENE && (subjectImages.length === 0 || !customSceneText.trim())) {
      setError("Add a subject photo and describe the scene."); return;
    }
    const isConverting = [...subjectImages, ...styleImages].some(img => img.isUploading);
    if (isConverting) { setError("Still converting images..."); return; }
    
    setError(null);
    setLoadingState(LoadingState.ANALYZING);
    try {
      const results = await generatePrompts(styleImages, subjectImages, promptCount, genMode, customSceneText);
      const promptsWithThumbnails: GeneratedPrompt[] = await Promise.all(
        results.map(async (p) => ({
          text: p.text,
          referenceImage: p.referenceImage ? await createThumbnail(p.referenceImage) : undefined
        }))
      );
      const newGroup: PromptGroup = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        prompts: promptsWithThumbnails,
        styleReferences: styleImages.map(i => i.publicUrl!),
        subjectReferences: subjectImages.map(i => i.publicUrl!),
        mode: genMode,
      };
      setHistory(prev => [newGroup, ...prev].slice(0, MAX_HISTORY_ITEMS));
      setLoadingState(LoadingState.IDLE);
    } catch (err: any) {
      setError(err.message);
      setLoadingState(LoadingState.ERROR);
    }
  };

  const handleGenImage = async (groupIndex: number, promptIndex: number) => {
    const group = history[groupIndex];
    const promptObj = group.prompts[promptIndex];
    
    setHistory(prev => {
      const next = [...prev];
      next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], isGenerating: true, error: undefined };
      return next;
    });

    try {
      const faceRef = group.subjectReferences[0];
      const taskId = await createTask(promptObj.text, faceRef, callbackUrl);
      
      setHistory(prev => {
        const next = [...prev];
        next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], taskId: taskId };
        return next;
      });

      const imageUrl = await pollTaskStatus(taskId);
      
      setHistory(prev => {
        const next = [...prev];
        next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], isGenerating: false, generatedImageUrl: imageUrl };
        return next;
      });
    } catch (err: any) {
      setHistory(prev => {
        const next = [...prev];
        next[groupIndex].prompts[promptIndex] = { ...next[groupIndex].prompts[promptIndex], isGenerating: false, error: err.message };
        return next;
      });
    }
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-20 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-slate-800 px-4 py-4 mb-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-lg">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight hidden lg:block">Prompt Alchemy</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="max-w-6xl mx-auto px-4 mt-4 animate-in slide-in-from-top duration-300">
            <div className="bg-surface border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-indigo-400" /> API Keys</h3>
                  <button onClick={() => (window as any).aistudio.openSelectKey()} className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors">Select Primary Key</button>
                  <input type="password" value={imgbbKey} onChange={(e) => setImgbbKey(e.target.value)} placeholder="ImgBB API Key..." className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white outline-none" />
                </div>
                <div className="space-y-4 border-l border-slate-800 pl-0 md:pl-6">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><GridIcon className="w-4 h-4 text-sky-400" /> Webhook Test</h3>
                  <p className="text-[11px] text-slate-400">Current URL: {callbackUrl}</p>
                  <div className="flex gap-2">
                    <button 
                      onClick={testWebhook}
                      className="flex-grow py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Send Test Callback
                    </button>
                    <button 
                      onClick={() => setCallbackUrl(defaultCallback)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-600 text-slate-300 text-xs"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-2xl p-5 border border-slate-700/50 shadow-2xl sticky top-24">
            <div className="space-y-6">
              <ImageUploader label="Target (Person's Face)" images={subjectImages} maxCount={MAX_IMAGES_PER_CATEGORY} onImagesUpload={(imgs) => handleImageUpload(imgs, setSubjectImages)} onRemove={(id) => setSubjectImages(prev => prev.filter(i => i.id !== id))} icon={<UserIcon className="w-4 h-4 text-purple-400" />} />
              {genMode === GenerationMode.MATCH_STYLE && (
                <ImageUploader label="Style Reference" images={styleImages} maxCount={MAX_IMAGES_PER_CATEGORY} onImagesUpload={(imgs) => handleImageUpload(imgs, setStyleImages)} onRemove={(id) => setStyleImages(prev => prev.filter(i => i.id !== id))} icon={<ImageIcon className="w-4 h-4 text-indigo-400" />} />
              )}
              {genMode === GenerationMode.CUSTOM_SCENE && (
                <textarea value={customSceneText} onChange={(e) => setCustomSceneText(e.target.value)} placeholder="Describe the scene..." className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 outline-none resize-none" />
              )}
              <div className="space-y-4 pt-4 border-t border-slate-700/50">
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900/50 rounded-xl border border-slate-700">
                  <button onClick={() => setGenMode(GenerationMode.MATCH_STYLE)} className={`py-1.5 text-[10px] font-bold rounded-lg ${genMode === GenerationMode.MATCH_STYLE ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Style</button>
                  <button onClick={() => setGenMode(GenerationMode.CUSTOM_SCENE)} className={`py-1.5 text-[10px] font-bold rounded-lg ${genMode === GenerationMode.CUSTOM_SCENE ? 'bg-pink-600 text-white' : 'text-slate-500'}`}>Scene</button>
                  <button onClick={() => setGenMode(GenerationMode.CHARACTER_SHEET)} className={`py-1.5 text-[10px] font-bold rounded-lg ${genMode === GenerationMode.CHARACTER_SHEET ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>Sheet</button>
                  <button onClick={() => setGenMode(GenerationMode.RANDOM_CREATIVE)} className={`py-1.5 text-[10px] font-bold rounded-lg ${genMode === GenerationMode.RANDOM_CREATIVE ? 'bg-purple-600 text-white' : 'text-slate-500'}`}>Random</button>
                </div>
                <button onClick={handleGenerate} disabled={loadingState === LoadingState.ANALYZING} className="w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r from-indigo-600 to-purple-600 disabled:opacity-50">
                  {loadingState === LoadingState.ANALYZING ? "Analyzing..." : "Start Alchemy"}
                </button>
                {error && <p className="text-[10px] text-red-400 text-center font-bold">{error}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          {history.map((group, groupIdx) => (
            <div key={group.id} className="bg-surface/50 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
              <div className="bg-slate-800/50 px-5 py-3 border-b border-slate-700/50 flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
                <span>{new Date(group.timestamp).toLocaleTimeString()} • {group.mode}</span>
              </div>
              <div className="p-5 space-y-8">
                {group.prompts.map((prompt, pIdx) => (
                  <div key={pIdx} className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4 group">
                      {prompt.referenceImage && <img src={prompt.referenceImage} className="w-24 h-24 rounded-xl border border-slate-700 object-cover" />}
                      <div className="flex-grow bg-slate-900/40 rounded-xl p-4 border border-slate-700/30">
                        <div className="flex justify-between mb-2">
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold">V{pIdx + 1}</span>
                          <div className="flex gap-2">
                            <button onClick={() => handleGenImage(groupIdx, pIdx)} disabled={prompt.isGenerating} className="text-[10px] font-bold bg-indigo-600 px-3 py-1 rounded-lg hover:bg-indigo-500 flex items-center gap-2">
                              {prompt.isGenerating ? (
                                <>
                                  <span className="w-2 h-2 bg-white rounded-full animate-ping"></span>
                                  Generating...
                                </>
                              ) : "Gen Image"}
                            </button>
                            <button onClick={() => copyToClipboard(prompt.text)} className="text-slate-500 hover:text-white"><CopyIcon className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed font-mono">{prompt.text}</p>
                        {prompt.error && <p className="text-[10px] text-red-400 mt-2 font-bold">{prompt.error}</p>}
                      </div>
                    </div>
                    {prompt.generatedImageUrl && (
                      <div className="ml-0 sm:ml-28 rounded-2xl overflow-hidden border border-slate-700 max-w-sm aspect-square bg-slate-900 relative">
                        <img src={prompt.generatedImageUrl} className="w-full h-full object-cover" />
                        <div className="absolute top-2 right-2 p-1 bg-black/50 backdrop-blur-md rounded text-white text-[9px] font-bold">Generated</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;
