
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ImageUploader from './components/ImageUploader';
import { UploadedImage, LoadingState, GenerationMode, PromptGroup, GeneratedPrompt } from './types';
import { generatePrompts } from './services/geminiService';
import { startImageGenerationTask, monitorTaskProgress } from './services/imageGenerationService';
import { WandIcon, CopyIcon, SparklesIcon, ImageIcon, UserIcon, TrashIcon, GridIcon, PlayIcon, DownloadIcon, XIcon, SettingsIcon } from './components/Icons';

type ResolutionType = "Standard" | "1K" | "2K" | "4K";

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1', icon: '▢' },
  { id: '16:9', label: '16:9', icon: '▭' },
  { id: '9:16', label: '9:16', icon: '▯' },
  { id: '4:3', label: '4:3', icon: '▤' },
  { id: '3:4', label: '3:4', icon: '▧' },
];

const App: React.FC = () => {
  const [styleImages, setStyleImages] = useState<UploadedImage[]>([]);
  const [subjectImages, setSubjectImages] = useState<UploadedImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [qualityLevel, setQualityLevel] = useState<ResolutionType>("1K");
  const [genMode, setGenMode] = useState<GenerationMode>(GenerationMode.MATCH_STYLE);
  const [nsfcEnabled, setNsfcEnabled] = useState<boolean>(false);
  const [customSceneText, setCustomSceneText] = useState<string>('');
  const [promptCount, setPromptCount] = useState<number>(3);
  const [history, setHistory] = useState<PromptGroup[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showVault, setShowVault] = useState<boolean>(false);
  
  const [selectedPrompts, setSelectedPrompts] = useState<Set<string>>(new Set());

  const allGeneratedImages = useMemo(() => {
    return history.flatMap(group => 
      group.prompts.flatMap(p => p.generatedImageUrls || [])
    );
  }, [history]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewImage(null);
        setShowVault(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('alchemy_v11_history');
    if (saved) {
      try {
        const parsed: PromptGroup[] = JSON.parse(saved);
        setHistory(parsed);
        parsed.forEach(group => {
          group.prompts.forEach(p => {
            if (p.taskId && !p.generatedImageUrls?.length && !p.error) {
              resumeMonitoringProcess(group.id, p.id, p.taskId);
            }
          });
        });
      } catch (e) { localStorage.removeItem('alchemy_v11_history'); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('alchemy_v11_history', JSON.stringify(history.slice(0, 50)));
  }, [history]);

  const togglePromptSelection = (id: string) => {
    const next = new Set(selectedPrompts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPrompts(next);
  };

  const selectAllInGroup = (groupId: string) => {
    const group = history.find(g => g.id === groupId);
    if (!group) return;
    const next = new Set(selectedPrompts);
    group.prompts.forEach(p => next.add(p.id));
    setSelectedPrompts(next);
  };

  const handleDownload = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `alchemist-render-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed:", err);
      window.open(url, '_blank');
    }
  };

  const resumeMonitoringProcess = async (groupId: string, promptId: string, taskId: string) => {
    updatePromptUI(groupId, promptId, { isGenerating: true, taskId });
    try {
      const urls = await monitorTaskProgress(taskId);
      updatePromptUI(groupId, promptId, (prev) => ({
        isGenerating: false,
        generatedImageUrls: [...(prev.generatedImageUrls || []), ...urls]
      }));
    } catch (err: any) {
      updatePromptUI(groupId, promptId, { isGenerating: false, error: err.message });
    }
  };

  const updatePromptUI = (
    groupId: string, 
    promptId: string, 
    updates: Partial<GeneratedPrompt> | ((p: GeneratedPrompt) => Partial<GeneratedPrompt>)
  ) => {
    setHistory(prev => prev.map(group => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        prompts: group.prompts.map(p => {
          if (p.id !== promptId) return p;
          const res = typeof updates === 'function' ? updates(p) : updates;
          return { ...p, ...res };
        })
      };
    }));
  };

  const deleteSinglePromptFromHistory = (groupId: string, promptId: string) => {
    setHistory(prev => prev.map(group => {
      if (group.id !== groupId) return group;
      return { ...group, prompts: group.prompts.filter(p => p.id !== promptId) };
    }).filter(group => group.prompts.length > 0));
    const next = new Set(selectedPrompts);
    next.delete(promptId);
    setSelectedPrompts(next);
  };

  const handleIdentityImagesUpload = async (newImages: UploadedImage[]) => {
    setSubjectImages(prev => [...prev, ...newImages].slice(0, 8));
    const key = process.env.IMGBB_API_KEY;
    for (const img of newImages) {
      setSubjectImages(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: true } : i));
      try {
        const fd = new FormData();
        fd.append('image', img.base64.split(',')[1]);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: 'POST', body: fd });
        const data = await res.json();
        const url = data.success ? data.data.url : undefined;
        setSubjectImages(prev => prev.map(i => i.id === img.id ? { ...i, publicUrl: url, isUploading: false } : i));
      } catch (e) {
        setSubjectImages(prev => prev.map(i => i.id === img.id ? { ...i, isUploading: false } : i));
      }
    }
  };

  const runPromptEngineeringProcess = async () => {
    if (subjectImages.length === 0) { setError("Please upload face photos."); return; }
    setError(null);
    setLoadingState(LoadingState.ANALYZING);
    try {
      const results = await generatePrompts(styleImages, subjectImages, promptCount, genMode, nsfcEnabled, customSceneText);
      const newGroup: PromptGroup = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        prompts: results.map(r => ({
          id: Math.random().toString(36).substr(2, 9),
          text: r.text,
          referenceImage: r.referenceImage
        })),
        styleReferences: styleImages.map(i => i.publicUrl!).filter(Boolean),
        subjectReferences: subjectImages.map(i => i.publicUrl!).filter(Boolean),
        mode: nsfcEnabled ? GenerationMode.NSFC : genMode, 
      };
      setHistory(prev => [newGroup, ...prev]);
      setLoadingState(LoadingState.IDLE);
    } catch (err: any) {
      setError(err.message);
      setLoadingState(LoadingState.ERROR);
    }
  };

  const executeImageRender = async (groupId: string, promptId: string) => {
    const group = history.find(g => g.id === groupId);
    const prompt = group?.prompts.find(p => p.id === promptId);
    if (!prompt || prompt.isGenerating || !group) return;

    try {
      const taskId = await startImageGenerationTask(prompt.text, group.subjectReferences, aspectRatio, qualityLevel, group.mode);
      resumeMonitoringProcess(groupId, promptId, taskId);
    } catch (err: any) {
      updatePromptUI(groupId, promptId, { error: err.message });
    }
  };

  const bulkRenderSelected = async () => {
    const promptsToRender: {groupId: string, promptId: string}[] = [];
    history.forEach(group => {
      group.prompts.forEach(p => {
        if (selectedPrompts.has(p.id) && !p.isGenerating) {
          promptsToRender.push({ groupId: group.id, promptId: p.id });
        }
      });
    });

    for (const item of promptsToRender) {
      executeImageRender(item.groupId, item.promptId);
    }
    setSelectedPrompts(new Set()); 
  };

  return (
    <div className="min-h-screen bg-[#06080d] text-slate-300 font-sans">
      {/* Full Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[110] bg-black/98 flex items-center justify-center p-4 backdrop-blur-md" onClick={() => setPreviewImage(null)}>
          <button className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors">
            <XIcon className="w-8 h-8" />
          </button>
          <img 
            src={previewImage} 
            className="max-w-full max-h-full rounded-2xl shadow-2xl animate-in zoom-in-95 duration-300 border border-white/10" 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Artifact Vault Modal */}
      {showVault && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-300" onClick={() => setShowVault(false)}>
          <div 
            className="bg-[#0e111a] border border-white/10 w-full max-w-7xl h-full max-h-[90vh] rounded-[3rem] overflow-hidden flex flex-col shadow-[0_0_100px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-10 py-8 border-b border-white/5 flex items-center justify-between bg-black/20">
              <div className="flex items-center gap-5">
                <div className="p-3.5 bg-indigo-600/10 rounded-2xl border border-indigo-500/20 text-indigo-400">
                  <GridIcon className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black uppercase tracking-widest text-white italic leading-none mb-1.5">Artifact Vault</h2>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{allGeneratedImages.length} Saved Generations</p>
                </div>
              </div>
              <button 
                onClick={() => setShowVault(false)}
                className="bg-white/5 hover:bg-white/10 text-white w-14 h-14 rounded-full flex items-center justify-center transition-all border border-white/5 group"
              >
                <XIcon className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </button>
            </div>

            <div className="flex-grow overflow-y-auto p-10 custom-scrollbar">
              {allGeneratedImages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20">
                  <ImageIcon className="w-24 h-24 mb-6" />
                  <span className="text-xs font-black uppercase tracking-[0.6em]">No artifacts found</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {allGeneratedImages.map((url, idx) => (
                    <div key={idx} className="relative aspect-square group/vault-img rounded-[2rem] overflow-hidden bg-black border border-white/5 shadow-2xl transition-all hover:border-indigo-500/50 hover:shadow-indigo-500/10">
                      <img src={url} className="w-full h-full object-cover transition-all duration-1000 group-hover/vault-img:scale-110" />
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover/vault-img:opacity-100 transition-all flex items-center justify-center gap-3 backdrop-blur-sm">
                        <button 
                          onClick={() => setPreviewImage(url)} 
                          className="p-4 bg-white text-black rounded-full hover:scale-110 active:scale-90 transition-all shadow-xl"
                        >
                          <PlayIcon className="w-5 h-5 fill-current" />
                        </button>
                        <button 
                          onClick={() => handleDownload(url)} 
                          className="p-4 bg-indigo-600 text-white rounded-full hover:scale-110 active:scale-90 transition-all shadow-xl"
                        >
                          <DownloadIcon className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedPrompts.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 px-6 py-4 rounded-full shadow-2xl flex items-center gap-8 animate-in slide-in-from-bottom-10 duration-300">
          <span className="text-xs font-black uppercase tracking-widest text-white whitespace-nowrap">
            {selectedPrompts.size} Prompts Selected
          </span>
          <div className="flex gap-2">
            <button 
              onClick={bulkRenderSelected}
              className="bg-white text-indigo-600 px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
            >
              Bulk Render ({qualityLevel})
            </button>
            <button 
              onClick={() => setSelectedPrompts(new Set())}
              className="bg-black/20 text-white/80 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-black/40 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 bg-[#06080d]/90 backdrop-blur-lg border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-600/20">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-sm font-black uppercase tracking-widest text-white italic">Alchemist Engine</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setNsfcEnabled(!nsfcEnabled)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all text-[9px] font-black uppercase tracking-[0.2em] border shadow-xl ${
                nsfcEnabled 
                ? 'bg-red-600 border-red-400 text-white animate-pulse shadow-red-600/20 scale-105' 
                : 'bg-white/5 border-white/10 text-slate-500 hover:bg-white/10 hover:text-slate-300'
              }`}
            >
              <TrashIcon className={`w-3 h-3 ${nsfcEnabled ? 'text-white' : 'text-slate-600'}`} />
              NSFC {nsfcEnabled ? 'ON' : 'OFF'}
            </button>

            <div className="w-px h-6 bg-white/10 mx-1"></div>

            <button 
              onClick={() => setShowVault(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-indigo-600/20 text-slate-300 hover:text-indigo-400 border border-white/5 rounded-full transition-all text-[10px] font-black uppercase tracking-widest"
            >
              <GridIcon className="w-3.5 h-3.5" />
              Vault ({allGeneratedImages.length})
            </button>
            
            <button onClick={() => setHistory([])} className="text-[10px] font-bold text-slate-600 hover:text-red-400 uppercase tracking-widest transition-colors flex items-center gap-2 px-2">
              <TrashIcon className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-10 pb-20 items-start">
        
        {/* Боковая панель управления */}
        <div className="lg:col-span-4 sticky top-24 max-h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar bg-[#0e111a] border border-white/5 rounded-3xl p-8 shadow-2xl">
          <div className="space-y-8">
            <ImageUploader 
              label="1. Target Identity" 
              images={subjectImages} 
              onImagesUpload={handleIdentityImagesUpload} 
              onRemove={id => setSubjectImages(p => p.filter(i => i.id !== id))} 
              icon={<UserIcon className="w-4 h-4 text-indigo-400" />} 
              maxCount={8} 
            />

            <ImageUploader 
              label="2. Style References" 
              images={styleImages} 
              onImagesUpload={imgs => setStyleImages(p => [...p, ...imgs].slice(0, 5))} 
              onRemove={id => setStyleImages(p => p.filter(i => i.id !== id))} 
              icon={<ImageIcon className="w-4 h-4 text-emerald-400" />} 
              maxCount={5}
            />

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 block">3. Select Mode</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: GenerationMode.MATCH_STYLE, label: 'Match Style', icon: <ImageIcon className="w-4 h-4" /> },
                  { id: GenerationMode.CUSTOM_SCENE, label: 'Custom Scene', icon: <WandIcon className="w-4 h-4" /> },
                  { id: GenerationMode.CHARACTER_SHEET, label: 'Character Sheet', icon: <GridIcon className="w-4 h-4" /> },
                  { id: GenerationMode.RANDOM_CREATIVE, label: 'Creative Mix', icon: <SparklesIcon className="w-4 h-4" /> },
                ].map(mode => (
                  <button 
                    key={mode.id}
                    onClick={() => setGenMode(mode.id)}
                    className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all ${
                      genMode === mode.id ? 'bg-indigo-600 border-indigo-400 text-white shadow-xl' : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/10'
                    }`}
                  >
                    {mode.icon}
                    <span className="text-[9px] font-black uppercase tracking-tighter">{mode.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {genMode === GenerationMode.CUSTOM_SCENE && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] block">Scene Description</label>
                <textarea 
                  value={customSceneText} 
                  onChange={e => setCustomSceneText(e.target.value)}
                  placeholder="Describe where the person should be..."
                  className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-xs italic text-slate-300 focus:border-indigo-500 transition-colors h-24 resize-none outline-none"
                />
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 block">4. Prompt Quantity (Per Style)</label>
              <div className="grid grid-cols-3 gap-2 p-1.5 bg-black/40 rounded-2xl border border-white/5">
                {[1, 3, 5].map(c => (
                  <button
                    key={c}
                    onClick={() => setPromptCount(c)}
                    className={`py-2 rounded-xl text-[10px] font-black transition-all ${
                      promptCount === c ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {c} {c === 1 ? 'Prompt' : 'Prompts'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 block">5. Aspect Ratio</label>
              <div className="grid grid-cols-5 gap-2">
                {ASPECT_RATIOS.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setAspectRatio(r.id)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${
                      aspectRatio === r.id ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10'
                    }`}
                  >
                    <span className="text-sm leading-none mb-1">{r.icon}</span>
                    <span className="text-[8px] font-bold">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 block">6. Render Quality</label>
              <div className="grid grid-cols-4 gap-2 p-1.5 bg-black/40 rounded-2xl border border-white/5">
                {(["Standard", "1K", "2K", "4K"] as ResolutionType[]).map(res => (
                  <button
                    key={res}
                    onClick={() => setQualityLevel(res)}
                    className={`py-2 rounded-xl text-[10px] font-black transition-all ${
                      qualityLevel === res ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
              {nsfcEnabled && (
                <p className="mt-2 text-[8px] font-black text-red-500/60 uppercase tracking-widest text-center">Using SeeDream 4.5 Edit (No Censorship)</p>
              )}
            </div>

            <div className="pt-4 pb-2">
              <button 
                onClick={runPromptEngineeringProcess} 
                disabled={loadingState === LoadingState.ANALYZING} 
                className={`w-full py-5 rounded-full font-black text-xs uppercase tracking-[0.2em] transition-all active:scale-95 disabled:opacity-20 shadow-2xl ${
                  nsfcEnabled ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-black hover:bg-indigo-600 hover:text-white'
                }`}
              >
                {loadingState === LoadingState.ANALYZING ? 'Processing...' : 'Generate Prompts'}
              </button>
              {error && <p className="text-[10px] text-red-400 text-center font-black uppercase italic mt-4">! {error}</p>}
            </div>
          </div>
        </div>

        {/* Правая колонка с историей */}
        <div className="lg:col-span-8 space-y-12 min-h-screen">
          {history.length === 0 && (
            <div className="flex flex-col items-center justify-center py-40 border border-dashed border-white/5 rounded-[3rem] opacity-20">
              <SparklesIcon className="w-16 h-16 mb-6" />
              <p className="text-xs font-black uppercase tracking-[0.4em]">Ready for Transmutation</p>
            </div>
          )}

          {history.map(group => (
            <div key={group.id} className="space-y-6">
              <div className="flex items-center gap-6 px-4">
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{new Date(group.timestamp).toLocaleTimeString()}</span>
                <div className="h-px flex-grow bg-white/5"></div>
                <button 
                  onClick={() => selectAllInGroup(group.id)}
                  className="text-[9px] font-black text-indigo-400 uppercase tracking-widest hover:text-white transition-colors"
                >
                  Select All
                </button>
                <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${group.mode === GenerationMode.NSFC ? 'text-red-500' : 'text-slate-600'}`}>{group.mode}</span>
              </div>

              <div className="space-y-6">
                {group.prompts.map(p => (
                  <div 
                    key={p.id} 
                    className={`bg-[#0e111a]/40 border rounded-[2.5rem] p-8 transition-all group/card relative ${
                      selectedPrompts.has(p.id) ? 'border-indigo-500/50 bg-[#0e111a]' : 'border-white/5 hover:bg-[#0e111a]'
                    }`}
                  >
                    <div 
                      onClick={() => togglePromptSelection(p.id)}
                      className={`absolute top-6 left-6 w-5 h-5 rounded-full border-2 cursor-pointer transition-all z-10 flex items-center justify-center ${
                        selectedPrompts.has(p.id) ? 'bg-indigo-600 border-indigo-400' : 'border-white/20 bg-black/40'
                      }`}
                    >
                      {selectedPrompts.has(p.id) && <div className="w-2 h-2 bg-white rounded-full"></div>}
                    </div>

                    <div className="flex flex-col md:flex-row gap-8">
                      <div className="w-24 h-24 rounded-2xl overflow-hidden border border-white/10 shrink-0 bg-black shadow-inner ml-8 md:ml-0">
                        {p.referenceImage ? <img src={p.referenceImage} className="w-full h-full object-cover grayscale opacity-40 group-hover/card:opacity-60 transition-opacity" /> : <div className="w-full h-full flex items-center justify-center opacity-10"><ImageIcon className="w-8 h-8" /></div>}
                      </div>

                      <div className="flex-grow flex flex-col justify-between py-1">
                        <div className="space-y-6">
                          <div className="flex items-start justify-between gap-6">
                            <p className="text-sm leading-relaxed text-slate-300 italic font-medium">"{p.text}"</p>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => navigator.clipboard.writeText(p.text)} title="Copy Prompt" className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-500 hover:text-white transition-all"><CopyIcon className="w-4 h-4" /></button>
                              <button onClick={() => deleteSinglePromptFromHistory(group.id, p.id)} title="Delete Prompt" className="p-3 bg-white/5 hover:bg-red-500/20 rounded-xl text-slate-500 hover:text-red-400 transition-all"><TrashIcon className="w-4 h-4" /></button>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <button 
                              onClick={() => executeImageRender(group.id, p.id)} 
                              disabled={p.isGenerating}
                              className={`px-10 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
                                p.isGenerating ? 'bg-slate-800 text-slate-500' : (group.mode === GenerationMode.NSFC ? 'bg-red-600' : 'bg-indigo-600') + ' text-white shadow-xl hover:scale-105 active:scale-95'
                              }`}
                            >
                              {p.isGenerating ? 'Rendering...' : `Render (${group.mode === GenerationMode.NSFC ? 'SeeDream' : qualityLevel})`}
                            </button>
                            {p.error && <span className="text-[9px] text-red-400 font-black bg-red-400/10 px-4 py-1.5 rounded-full border border-red-400/20 uppercase">! {p.error}</span>}
                          </div>
                        </div>

                        {p.generatedImageUrls && p.generatedImageUrls.length > 0 && (
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 animate-in slide-in-from-top-4 duration-700">
                            {p.generatedImageUrls.map((url, idx) => (
                              <div key={idx} className="relative aspect-square group/img rounded-3xl overflow-hidden border border-white/5 shadow-2xl bg-black">
                                <img src={url} className="w-full h-full object-cover transition-all duration-1000 group-hover/img:scale-110" />
                                
                                {/* Badge showing the model name */}
                                <div className="absolute top-3 left-3 px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-1.5 z-10 pointer-events-none">
                                  <div className={`w-1 h-1 rounded-full animate-pulse ${group.mode === GenerationMode.NSFC ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]' : 'bg-indigo-500 shadow-[0_0_5px_rgba(99,102,241,0.8)]'}`}></div>
                                  <span className="text-[7px] font-black uppercase tracking-[0.2em] text-white/80">
                                    {group.mode === GenerationMode.NSFC ? 'SeeDream 4.5' : 'Nano Banana'}
                                  </span>
                                </div>

                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                                  <div className="flex gap-2">
                                    <button 
                                      onClick={() => setPreviewImage(url)} 
                                      className="p-3 bg-white/10 hover:bg-indigo-600 rounded-full text-white transition-all shadow-lg"
                                      title="Preview"
                                    >
                                      <PlayIcon className="w-5 h-5 fill-current" />
                                    </button>
                                    <button 
                                      onClick={() => handleDownload(url)} 
                                      className="p-3 bg-white/10 hover:bg-emerald-600 rounded-full text-white transition-all shadow-lg"
                                      title="Download"
                                    >
                                      <DownloadIcon className="w-5 h-5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {p.isGenerating && (
                          <div className="h-40 flex flex-col items-center justify-center gap-4 mt-8 bg-black/20 rounded-[2rem] border border-dashed border-white/5">
                            <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${group.mode === GenerationMode.NSFC ? 'border-red-500' : 'border-indigo-500'}`}></div>
                            <span className={`text-[9px] font-black uppercase tracking-[0.3em] animate-pulse ${group.mode === GenerationMode.NSFC ? 'text-red-500' : 'text-indigo-500'}`}>Alchemy in progress...</span>
                          </div>
                        )}
                      </div>
                    </div>
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
