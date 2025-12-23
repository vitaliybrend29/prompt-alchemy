
import React, { useState, useEffect } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { createTask, pollTaskStatus } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, GridIcon } from './components/Icons';

const MAX_HISTORY_ITEMS = 30;

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1', desc: 'Square' },
  { id: '16:9', label: '16:9', desc: 'Cinema' },
  { id: '9:16', label: '9:16', desc: 'Mobile' },
  { id: '4:3', label: '4:3', desc: 'Photo' },
  { id: '3:2', label: '3:2', desc: 'Classic' }
];

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
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [genMode, setGenMode] = useState<GenerationMode>(GenerationMode.MATCH_STYLE);
  const [customSceneText, setCustomSceneText] = useState<string>('');
  const [history, setHistory] = useState<PromptGroup[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = process.env.KIE_CALLBACK_URL || '';

  useEffect(() => {
    const saved = localStorage.getItem('alchemy_v7_history');
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
        localStorage.removeItem('alchemy_v7_history');
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('alchemy_v7_history', JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
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

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  const convertToPublicUrl = async (image: UploadedImage): Promise<string | undefined> => {
    const key = process.env.IMGBB_API_KEY;
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
    if (subjectImages.length === 0) { setError("Upload model photos."); return; }
    if (genMode === GenerationMode.MATCH_STYLE && styleImages.length === 0) { setError("Upload style references."); return; }
    
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
      const faceUrls = group.subjectReferences;
      if (faceUrls.length === 0) throw new Error("Upload not finished.");
      
      const taskId = await createTask(prompt.text, faceUrls, aspectRatio, callbackUrl);
      resumePolling(groupIdx, promptIdx, taskId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearHistory = () => {
    if (confirm("Reset History?")) {
      setHistory([]);
      localStorage.removeItem('alchemy_v7_history');
    }
  };

  return (
    <div className="min-h-screen bg-[#07090f] text-slate-200 font-sans">
      <header className="sticky top-0 z-50 bg-[#07090f]/80 backdrop-blur-xl border-b border-white/5 px-8 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <SparklesIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tighter text-white uppercase italic">Alchemist Studio</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">Intelligence v7.0</p>
            </div>
          </div>
          <button onClick={clearHistory} className="group flex items-center gap-2 px-5 py-2 rounded-full border border-white/5 hover:border-red-500/30 transition-all">
            <TrashIcon className="w-4 h-4 text-slate-500 group-hover:text-red-400" />
            <span className="text-[10px] font-bold text-slate-500 group-hover:text-red-400 uppercase tracking-widest">Clear Storage</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-8 mt-10 grid grid-cols-1 lg:grid-cols-12 gap-10 pb-32">
        
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-[#0f121d] rounded-3xl p-8 border border-white/5 shadow-2xl sticky top-28">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-8 flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> Transmutation Config
            </h2>

            <div className="space-y-10">
              <ImageUploader 
                label="The Identity (Model)" 
                images={subjectImages} 
                onImagesUpload={imgs => handleImageUpload(imgs, setSubjectImages)} 
                onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} 
                icon={<UserIcon className="w-4 h-4 text-indigo-400" />} 
                maxCount={5} 
              />

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <GridIcon className="w-4 h-4" /> Mode & Frame
                </label>
                
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: GenerationMode.MATCH_STYLE, icon: <ImageIcon className="w-5 h-5" />, label: 'Style' },
                    { id: GenerationMode.CUSTOM_SCENE, icon: <WandIcon className="w-5 h-5" />, label: 'Custom' },
                    { id: GenerationMode.CHARACTER_SHEET, icon: <GridIcon className="w-5 h-5" />, label: 'Sheets' },
                    { id: GenerationMode.RANDOM_CREATIVE, icon: <SparklesIcon className="w-5 h-5" />, label: 'Random' }
                  ].map(m => (
                    <button 
                      key={m.id} 
                      onClick={() => setGenMode(m.id as GenerationMode)}
                      title={m.label}
                      className={`aspect-square rounded-2xl border transition-all flex items-center justify-center ${
                        genMode === m.id 
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-xl shadow-indigo-600/20' 
                        : 'bg-[#161a27] border-white/5 text-slate-500 hover:border-white/20'
                      }`}
                    >
                      {m.icon}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-5 gap-1.5 p-1.5 bg-[#161a27] rounded-2xl border border-white/5">
                  {ASPECT_RATIOS.map(ratio => (
                    <button
                      key={ratio.id}
                      onClick={() => setAspectRatio(ratio.id)}
                      className={`flex flex-col items-center py-2 rounded-xl transition-all ${
                        aspectRatio === ratio.id 
                        ? 'bg-indigo-600 text-white shadow-lg' 
                        : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <span className="text-[10px] font-black">{ratio.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {genMode === GenerationMode.MATCH_STYLE && (
                <ImageUploader 
                  label="Aesthetic Seeds (Style)" 
                  images={styleImages} 
                  onImagesUpload={imgs => handleImageUpload(imgs, setStyleImages)} 
                  onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} 
                  icon={<ImageIcon className="w-4 h-4 text-emerald-400" />} 
                  maxCount={5}
                />
              )}

              {genMode === GenerationMode.CUSTOM_SCENE && (
                <textarea 
                  value={customSceneText} 
                  onChange={e => setCustomSceneText(e.target.value)} 
                  placeholder="Enter scene details..." 
                  className="w-full h-32 bg-[#161a27] border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-indigo-500/50 transition-colors resize-none" 
                />
              )}

              <div className="pt-4 space-y-4">
                <div className="flex items-center justify-between px-2">
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Variations per image</span>
                  <div className="flex gap-2">
                    {[1, 3, 5].map(c => (
                      <button key={c} onClick={() => setPromptCount(c)} className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${promptCount === c ? 'bg-white text-black' : 'text-slate-500 hover:text-white'}`}>{c}</button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={handleGenerate} 
                  disabled={loadingState === LoadingState.ANALYZING} 
                  className="w-full py-5 rounded-[2rem] font-black bg-white text-black text-xs uppercase tracking-[0.2em] hover:bg-indigo-500 hover:text-white transition-all shadow-xl disabled:opacity-20 active:scale-95"
                >
                  {loadingState === LoadingState.ANALYZING ? 'Processing Intelligence...' : 'Generate Prompts'}
                </button>
                {error && <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-2xl text-[10px] text-red-400 text-center font-bold uppercase tracking-widest">{error}</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-12">
          {history.map((group, gIdx) => (
            <div key={group.id} className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
              <div className="flex items-center gap-6">
                <div className="px-4 py-1 bg-white/5 rounded-full border border-white/5">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{new Date(group.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="h-px flex-grow bg-white/5"></div>
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em]">{group.mode}</span>
              </div>

              <div className="space-y-6">
                {group.prompts.map((p, pi) => (
                  <div key={pi} className="group bg-[#0f121d]/50 border border-white/5 rounded-[2.5rem] p-8 flex flex-col xl:flex-row gap-10 hover:bg-[#0f121d] transition-all duration-500">
                    
                    <div className="xl:w-24 flex flex-col items-center gap-3 shrink-0">
                      <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Source</span>
                      <div className="w-20 h-20 rounded-2xl overflow-hidden border border-white/10 relative group-hover:border-indigo-500/50 transition-colors">
                        <img src={p.referenceImage} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                        <div className="absolute inset-0 bg-indigo-600/10 mix-blend-overlay"></div>
                      </div>
                    </div>

                    <div className="flex-grow flex flex-col justify-between py-1">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[11px] font-black text-indigo-500 uppercase tracking-[0.2em]">Synthesis Result 0{pi+1}</h3>
                          <div className="flex gap-2">
                            <button onClick={() => navigator.clipboard.writeText(p.text)} className="p-2.5 bg-white/5 hover:bg-white/10 text-slate-500 hover:text-white rounded-xl transition-all" title="Copy Prompt">
                              <CopyIcon className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleGenImage(gIdx, pi)} 
                              disabled={p.isGenerating}
                              className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                p.isGenerating ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:scale-105 active:scale-95'
                              }`}
                            >
                              {p.isGenerating ? 'Rendering...' : 'Render Image'}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-300 font-medium italic selection:bg-indigo-500/30">"{p.text}"</p>
                      </div>
                      {p.error && <p className="mt-4 text-[9px] text-red-400 font-bold bg-red-400/5 p-3 rounded-2xl border border-red-400/10">! {p.error}</p>}
                    </div>

                    <div className="xl:w-72 aspect-square shrink-0 rounded-[2rem] overflow-hidden bg-black border border-white/5 shadow-2xl group-hover:border-white/10 transition-colors relative">
                      {p.generatedImageUrl ? (
                        <div className="w-full h-full group/img relative bg-slate-900">
                          <img 
                            src={p.generatedImageUrl} 
                            className="w-full h-full object-contain animate-in fade-in zoom-in-95 duration-500" 
                            alt="Generated"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                            <button 
                              onClick={() => handleDownload(p.generatedImageUrl!, `alchemy-render-${Date.now()}.png`)}
                              className="px-6 py-3 bg-white text-black text-[10px] font-black uppercase rounded-full tracking-widest hover:scale-110 transition-transform flex items-center gap-2"
                            >
                              <SparklesIcon className="w-4 h-4" /> Save to Device
                            </button>
                            <a 
                              href={p.generatedImageUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="px-6 py-2 bg-white/10 text-white text-[10px] font-bold uppercase rounded-full tracking-widest hover:bg-white/20 transition-all"
                            >
                              Full Resolution
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-800">
                          {p.isGenerating ? (
                            <div className="flex flex-col items-center gap-4">
                              <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-indigo-500 animate-pulse">Forging Visuals...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-3 opacity-20">
                              <ImageIcon className="w-12 h-12" />
                              <span className="text-[8px] font-black uppercase tracking-widest">Ready for Render</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                ))}
              </div>
            </div>
          ))}

          {history.length === 0 && (
            <div className="h-[600px] flex flex-col items-center justify-center text-slate-900 border-2 border-dashed border-white/5 rounded-[4rem]">
              <SparklesIcon className="w-20 h-20 mb-8 opacity-5" />
              <p className="text-sm font-black uppercase tracking-[0.5em] opacity-10">Studio Idle • Ready for Alchemy</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
