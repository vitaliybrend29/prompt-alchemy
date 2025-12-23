
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, SettingsIcon, GridIcon } from './components/Icons';

const MAX_IMAGES_PER_CATEGORY = 5;
const MAX_HISTORY_ITEMS = 20;

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
  const [imgbbKey, setImgbbKey] = useState(localStorage.getItem('imgbb_key') || '');
  
  const defaultCallback = typeof window !== 'undefined' ? `${window.location.origin}/api/callback` : '';
  const [callbackUrl, setCallbackUrl] = useState(localStorage.getItem('kie_callback_url') || defaultCallback);

  // Загрузка истории и восстановление опроса активных задач
  useEffect(() => {
    const saved = localStorage.getItem('prompt_alchemy_history_v2');
    if (saved) {
      try {
        const parsed: PromptGroup[] = JSON.parse(saved);
        setHistory(parsed);
        // Продолжаем опрашивать задачи, которые еще не завершены
        parsed.forEach((group, gIdx) => {
          group.prompts.forEach((p, pIdx) => {
            if (p.taskId && !p.generatedImageUrl && !p.error) {
              resumePolling(gIdx, pIdx, p.taskId);
            }
          });
        });
      } catch (e) {
        localStorage.removeItem('prompt_alchemy_history_v2');
      }
    }
  }, []);

  // Сохранение истории
  useEffect(() => {
    localStorage.setItem('prompt_alchemy_history_v2', JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  }, [history]);

  const resumePolling = async (groupIdx: number, promptIdx: number, taskId: string) => {
    setHistory(prev => {
      const next = [...prev];
      if (next[groupIdx]?.prompts[promptIdx]) {
        next[groupIdx].prompts[promptIdx] = { ...next[groupIdx].prompts[promptIdx], isGenerating: true, taskId };
      }
      return next;
    });

    try {
      const url = await pollTaskStatus(taskId);
      setHistory(prev => {
        const next = [...prev];
        if (next[groupIdx]?.prompts[promptIdx]) {
          next[groupIdx].prompts[promptIdx] = { 
            ...next[groupIdx].prompts[promptIdx], 
            isGenerating: false, 
            generatedImageUrl: url,
            error: undefined 
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
    const key = imgbbKey || process.env.IMGBB_API_KEY;
    if (!key) return undefined;
    try {
      const fd = new FormData();
      fd.append('image', image.base64.split(',')[1]);
      const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: 'POST', body: fd });
      const data = await res.json();
      return data.success ? data.data.url : undefined;
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
    if (subjectImages.length === 0) { setError("Please upload a Face photo first."); return; }
    if (genMode === GenerationMode.MATCH_STYLE && styleImages.length === 0) { setError("Style references required for this mode."); return; }
    
    setError(null);
    setLoadingState(LoadingState.ANALYZING);
    try {
      const results = await generatePrompts(styleImages, subjectImages, promptCount, genMode, customSceneText);
      const prompts: GeneratedPrompt[] = await Promise.all(results.map(async (p) => ({
        text: p.text,
        referenceImage: p.referenceImage ? await createThumbnail(p.referenceImage) : undefined
      })));
      
      const newGroup: PromptGroup = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        prompts,
        styleReferences: styleImages.map(i => i.publicUrl!).filter(Boolean),
        subjectReferences: subjectImages.map(i => i.publicUrl!).filter(Boolean),
        mode: genMode,
      };
      
      setHistory(prev => [newGroup, ...prev]);
      setLoadingState(LoadingState.IDLE);
    } catch (err: any) {
      setError(err.message);
      setLoadingState(LoadingState.ERROR);
    }
  };

  const handleGenImage = async (groupIdx: number, promptIdx: number) => {
    const group = history[groupIdx];
    const prompt = group.prompts[promptIdx];
    
    if (prompt.isGenerating) return;

    try {
      const faceUrl = group.subjectReferences[0];
      if (!faceUrl) throw new Error("Face reference URL is missing. Re-upload photo.");
      
      const taskId = await createTask(prompt.text, faceUrl, callbackUrl);
      resumePolling(groupIdx, promptIdx, taskId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearHistory = () => {
    if (confirm("Delete all history entries? This cannot be undone.")) {
      setHistory([]);
      localStorage.removeItem('prompt_alchemy_history_v2');
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-20 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-slate-800 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Prompt Alchemy</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={clearHistory}
              title="Clear History"
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all"
            >
              <TrashIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white'}`}
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {showSettings && (
          <div className="max-w-6xl mx-auto mt-4 p-5 bg-surface rounded-2xl border border-slate-700 shadow-2xl animate-in slide-in-from-top duration-300 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">ImgBB API Key (Required for links)</label>
                <input 
                  type="password" 
                  value={imgbbKey} 
                  onChange={e => { setImgbbKey(e.target.value); localStorage.setItem('imgbb_key', e.target.value); }} 
                  placeholder="Paste key here..." 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white outline-none focus:border-indigo-500 transition-colors" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Webhook Callback URL</label>
                <input 
                  type="text" 
                  value={callbackUrl} 
                  onChange={e => { setCallbackUrl(e.target.value); localStorage.setItem('kie_callback_url', e.target.value); }} 
                  placeholder="https://..." 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white outline-none" 
                />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Боковая панель управления */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-3xl p-6 border border-slate-700/50 shadow-2xl sticky top-24">
            <div className="space-y-6">
              <ImageUploader 
                label="The Person (Face)" 
                images={subjectImages} 
                onImagesUpload={imgs => handleImageUpload(imgs, setSubjectImages)} 
                onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} 
                icon={<UserIcon className="w-4 h-4 text-purple-400" />} 
                maxCount={1} 
              />
              
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <WandIcon className="w-4 h-4 text-indigo-400" /> Generation Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: GenerationMode.MATCH_STYLE, label: 'Style Match', icon: <ImageIcon className="w-4 h-4" /> },
                    { id: GenerationMode.CUSTOM_SCENE, label: 'Custom Scene', icon: <WandIcon className="w-4 h-4" /> },
                    { id: GenerationMode.CHARACTER_SHEET, label: 'Angle Set', icon: <GridIcon className="w-4 h-4" /> },
                    { id: GenerationMode.RANDOM_CREATIVE, label: 'Surprise Me', icon: <SparklesIcon className="w-4 h-4" /> }
                  ].map(mode => (
                    <button 
                      key={mode.id} 
                      onClick={() => setGenMode(mode.id as GenerationMode)}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all gap-2 ${
                        genMode === mode.id 
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
                        : 'bg-slate-900/50 border-slate-700 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      {mode.icon}
                      <span className="text-[10px] font-bold uppercase tracking-wider">{mode.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {genMode === GenerationMode.MATCH_STYLE && (
                <ImageUploader 
                  label="Aesthetic Ref" 
                  images={styleImages} 
                  onImagesUpload={imgs => handleImageUpload(imgs, setStyleImages)} 
                  onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} 
                  icon={<ImageIcon className="w-4 h-4 text-sky-400" />} 
                />
              )}

              {genMode === GenerationMode.CUSTOM_SCENE && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Scene Description</label>
                  <textarea 
                    value={customSceneText} 
                    onChange={e => setCustomSceneText(e.target.value)} 
                    placeholder="e.g. Walking in rainy Cyberpunk Tokyo..." 
                    className="w-full h-28 bg-slate-900 border border-slate-700 rounded-2xl p-4 text-xs text-slate-300 outline-none focus:border-indigo-500 transition-colors resize-none" 
                  />
                </div>
              )}
              
              <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-2xl border border-slate-700">
                <span className="text-xs font-bold text-slate-400 ml-2 uppercase tracking-tighter">Variants:</span>
                <div className="flex gap-1">
                  {[1, 3, 5].map(c => (
                    <button 
                      key={c} 
                      onClick={() => setPromptCount(c)} 
                      className={`w-9 h-9 rounded-xl text-xs font-bold transition-all ${
                        promptCount === c ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-800'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={handleGenerate} 
                disabled={loadingState === LoadingState.ANALYZING} 
                className="w-full py-4 rounded-2xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xl hover:shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 uppercase tracking-widest text-sm"
              >
                {loadingState === LoadingState.ANALYZING ? 'Processing Alchemy...' : 'Ignite Alchemist'}
              </button>
              
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-[10px] text-red-400 text-center font-bold">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Сетка результатов */}
        <div className="lg:col-span-8 space-y-6">
          {history.map((group, gIdx) => (
            <div key={group.id} className="bg-surface/40 border border-slate-800/50 rounded-3xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500 backdrop-blur-sm">
              <div className="bg-slate-800/30 px-6 py-4 border-b border-slate-700/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                    {new Date(group.timestamp).toLocaleTimeString()} • {group.mode.replace('_', ' ')}
                  </span>
                </div>
              </div>
              
              <div className="p-6 space-y-10">
                {group.prompts.map((p, pi) => (
                  <div key={pi} className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      {p.referenceImage && (
                        <div className="relative group/ref shrink-0">
                          <img src={p.referenceImage} className="w-24 h-24 rounded-2xl object-cover border border-slate-700 shadow-lg" />
                          <div className="absolute -top-2 -left-2 bg-slate-800 border border-slate-700 text-[8px] font-bold px-1.5 py-0.5 rounded text-indigo-400">REF</div>
                        </div>
                      )}
                      
                      <div className="flex-grow bg-slate-900/40 border border-slate-800/50 rounded-2xl p-5 relative">
                        <div className="flex justify-between items-start mb-3">
                          <span className="text-[10px] font-black text-indigo-500/30">OPUS #0{pi + 1}</span>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleGenImage(gIdx, pi)} 
                              disabled={p.isGenerating}
                              className={`text-[10px] px-4 py-1.5 rounded-xl font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                                p.isGenerating 
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                                : p.generatedImageUrl 
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/10'
                              }`}
                            >
                              {p.isGenerating ? (
                                <><span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span> Polling...</>
                              ) : p.generatedImageUrl ? 'Regenerate' : 'Create Image'}
                            </button>
                            <button 
                              onClick={() => navigator.clipboard.writeText(p.text)} 
                              className="p-2 bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors"
                            >
                              <CopyIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-300 font-medium selection:bg-indigo-500/50">{p.text}</p>
                        {p.error && <p className="text-[10px] text-red-400 mt-3 font-bold bg-red-400/10 p-2 rounded-lg">Error: {p.error}</p>}
                        {p.taskId && !p.generatedImageUrl && !p.error && (
                          <div className="mt-3 flex items-center gap-2 text-[9px] text-slate-500 font-bold bg-slate-800/50 w-fit px-2 py-1 rounded">
                             <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></div>
                             WAITING FOR CALLBACK: {p.taskId.substring(0, 8)}...
                          </div>
                        )}
                      </div>
                    </div>

                    {p.generatedImageUrl && (
                      <div className="md:ml-28 max-w-lg rounded-3xl overflow-hidden border border-slate-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)] group relative aspect-square bg-slate-900">
                        <img src={p.generatedImageUrl} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
                          <div className="flex gap-3">
                            <a 
                              href={p.generatedImageUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="flex-grow py-3 bg-white text-black text-xs font-black uppercase text-center rounded-xl hover:bg-slate-200 transition-colors"
                            >
                              View Original
                            </a>
                            <button 
                              onClick={() => navigator.clipboard.writeText(p.generatedImageUrl!)}
                              className="p-3 bg-slate-800 text-white rounded-xl hover:bg-slate-700"
                            >
                              <CopyIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="absolute top-4 right-4 bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-xl">SUCCESS</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          
          {history.length === 0 && (
            <div className="h-96 flex flex-col items-center justify-center text-slate-700 border-4 border-dashed border-slate-800/50 rounded-[3rem]">
              <SparklesIcon className="w-16 h-16 mb-6 opacity-5" />
              <p className="text-lg font-black uppercase tracking-widest opacity-20">Awaiting your First Alchemy</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
