
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, SettingsIcon, GridIcon } from './components/Icons';

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

  useEffect(() => {
    const saved = localStorage.getItem('alchemy_history_clean');
    if (saved) {
      try {
        const parsed: PromptGroup[] = JSON.parse(saved);
        setHistory(parsed);
        parsed.forEach((group, gIdx) => {
          group.prompts.forEach((p, pIdx) => {
            if (p.taskId && !p.generatedImageUrl && !p.error) {
              resumePolling(gIdx, pIdx, p.taskId);
            }
          });
        });
      } catch (e) {
        localStorage.removeItem('alchemy_history_clean');
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('alchemy_history_clean', JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  }, [history]);

  const resumePolling = async (groupIdx: number, promptIdx: number, taskId: string) => {
    setHistory(prev => {
      const next = [...prev];
      if (next[groupIdx]?.prompts[promptIdx]) {
        next[groupIdx].prompts[promptIdx] = { 
          ...next[groupIdx].prompts[promptIdx], 
          isGenerating: true, 
          taskId,
          error: undefined 
        };
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
    setter(prev => [...prev, ...newImages].slice(0, 5));
    for (const img of newImages) {
      setter(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: true } : i));
      const url = await convertToPublicUrl(img);
      setter(prev => prev.map(i => i.id === img.id ? { ...i, publicUrl: url, isUploading: false } : i));
    }
  };

  const handleGenerate = async () => {
    if (subjectImages.length === 0) { setError("Please upload a face photo."); return; }
    if (genMode === GenerationMode.MATCH_STYLE && styleImages.length === 0) { setError("Please upload style refs."); return; }
    
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
      if (!faceUrl) throw new Error("Public image URL is still uploading...");
      
      const taskId = await createTask(prompt.text, faceUrl, callbackUrl);
      resumePolling(groupIdx, promptIdx, taskId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearHistory = () => {
    if (confirm("Delete history?")) {
      setHistory([]);
      localStorage.removeItem('alchemy_history_clean');
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-200 selection:bg-indigo-500/30 font-sans">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SparklesIcon className="w-6 h-6 text-indigo-500" />
            <h1 className="text-xl font-bold text-white tracking-tight">Prompt Alchemy</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={clearHistory} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all">
              <TrashIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-xl transition-all ${showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white'}`}>
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {showSettings && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="p-6 bg-surface rounded-2xl border border-slate-700 shadow-2xl space-y-4 animate-in slide-in-from-top-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ImgBB API Key</label>
                <input type="password" value={imgbbKey} onChange={e => { setImgbbKey(e.target.value); localStorage.setItem('imgbb_key', e.target.value); }} placeholder="Paste ImgBB key..." className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm outline-none focus:border-indigo-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Callback URL</label>
                <input type="text" value={callbackUrl} onChange={e => { setCallbackUrl(e.target.value); localStorage.setItem('kie_callback_url', e.target.value); }} placeholder="https://your-domain.com/callback" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm outline-none focus:border-indigo-500" />
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 pb-20">
        {/* Left Sidebar: Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface rounded-2xl p-6 border border-slate-700/50 shadow-xl sticky top-24">
            <div className="space-y-6">
              <ImageUploader label="Subject Photo (Face)" images={subjectImages} onImagesUpload={imgs => handleImageUpload(imgs, setSubjectImages)} onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} icon={<UserIcon className="w-4 h-4 text-purple-400" />} maxCount={1} />
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Generation Mode</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: GenerationMode.MATCH_STYLE, icon: <ImageIcon className="w-5 h-5" />, label: 'Style' },
                    { id: GenerationMode.CUSTOM_SCENE, icon: <WandIcon className="w-5 h-5" />, label: 'Custom' },
                    { id: GenerationMode.CHARACTER_SHEET, icon: <GridIcon className="w-5 h-5" />, label: 'Angles' },
                    { id: GenerationMode.RANDOM_CREATIVE, icon: <SparklesIcon className="w-5 h-5" />, label: 'Random' }
                  ].map(m => (
                    <button key={m.id} onClick={() => setGenMode(m.id as GenerationMode)} title={m.label} className={`aspect-square rounded-xl border transition-all flex items-center justify-center ${genMode === m.id ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'}`}>
                      {m.icon}
                    </button>
                  ))}
                </div>
              </div>

              {genMode === GenerationMode.MATCH_STYLE && <ImageUploader label="Style Reference" images={styleImages} onImagesUpload={imgs => handleImageUpload(imgs, setStyleImages)} onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} icon={<ImageIcon className="w-4 h-4 text-sky-400" />} />}
              {genMode === GenerationMode.CUSTOM_SCENE && <textarea value={customSceneText} onChange={e => setCustomSceneText(e.target.value)} placeholder="Describe the scene..." className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-slate-300 outline-none focus:border-indigo-500 resize-none" />}
              
              <div className="flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-slate-700">
                <span className="text-xs font-bold text-slate-400 uppercase">Quantity</span>
                <div className="flex gap-1">
                  {[1, 3, 5].map(c => (
                    <button key={c} onClick={() => setPromptCount(c)} className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${promptCount === c ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white'}`}>{c}</button>
                  ))}
                </div>
              </div>

              <button onClick={handleGenerate} disabled={loadingState === LoadingState.ANALYZING} className="w-full py-4 rounded-xl font-bold bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 active:scale-95 transition-all disabled:opacity-50">
                {loadingState === LoadingState.ANALYZING ? 'Analysing Images...' : 'Generate Prompts'}
              </button>
              {error && <p className="text-xs text-red-400 text-center font-medium bg-red-400/10 p-2 rounded-lg">{error}</p>}
            </div>
          </div>
        </div>

        {/* Main Content: History & Results */}
        <div className="lg:col-span-8 space-y-6">
          {history.map((group, gIdx) => (
            <div key={group.id} className="bg-surface/50 border border-slate-800 rounded-2xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-800/50 px-6 py-3 border-b border-slate-700 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(group.timestamp).toLocaleString()} • {group.mode}</span>
              </div>
              <div className="p-6 space-y-10">
                {group.prompts.map((p, pi) => (
                  <div key={pi} className="space-y-6">
                    <div className="flex gap-6">
                      {p.referenceImage && <img src={p.referenceImage} className="w-20 h-20 rounded-xl object-cover border border-slate-700 shadow-md flex-shrink-0" />}
                      <div className="flex-grow bg-slate-900/50 border border-slate-800 rounded-2xl p-5 relative">
                        <div className="flex justify-between items-start mb-3">
                          <span className="text-[10px] font-bold text-indigo-500 opacity-50 uppercase tracking-widest">Variation #{pi + 1}</span>
                          <div className="flex gap-2">
                            <button onClick={() => handleGenImage(gIdx, pi)} disabled={p.isGenerating} className={`text-[10px] px-4 py-1.5 rounded-lg font-bold uppercase transition-all ${p.isGenerating ? 'bg-slate-800 text-slate-500' : 'bg-indigo-600 text-white shadow-md'}`}>
                              {p.isGenerating ? 'Polling...' : 'Gen Photo'}
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(p.text)} className="p-2 bg-slate-800 text-slate-400 hover:text-white rounded-lg"><CopyIcon className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-300 font-medium">{p.text}</p>
                        {p.isGenerating && (
                          <div className="mt-3 text-[9px] text-slate-500 font-mono animate-pulse">Waiting for server response... (ID: {p.taskId?.slice(0, 12)}...)</div>
                        )}
                        {p.error && <p className="text-[10px] text-red-400 mt-2 font-bold bg-red-400/5 p-2 rounded">Error: {p.error}</p>}
                      </div>
                    </div>
                    {p.generatedImageUrl && (
                      <div className="ml-26 max-w-sm rounded-2xl overflow-hidden border border-slate-700 shadow-2xl group relative aspect-square bg-slate-900">
                        <img src={p.generatedImageUrl} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <a href={p.generatedImageUrl} target="_blank" rel="noreferrer" className="px-6 py-2 bg-white text-black text-xs font-bold uppercase rounded-lg">View HQ Original</a>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <div className="h-64 flex flex-col items-center justify-center text-slate-700 border-2 border-dashed border-slate-800 rounded-2xl">
              <SparklesIcon className="w-12 h-12 mb-4 opacity-10" />
              <p className="text-sm font-bold uppercase tracking-widest opacity-20">Awaiting Your Alchemy</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
