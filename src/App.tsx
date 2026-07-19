import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Loader2, X, AlertCircle, Sun, Moon, ChevronDown, Check, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as tf from '@tensorflow/tfjs';
import { triggerRelay } from './firebase';

const CLASSES = ['Ayam', 'Gajah', 'Kucing', 'Kuda', 'Kupu-kupu'];
const MODELS = ['CNN', 'MobileNetV2'];

export default function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [prediction, setPrediction] = useState<{ label: string; score: number }[] | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [model, setModel] = useState<tf.GraphModel | tf.LayersModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelType, setModelType] = useState('CNN');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    async function loadModel() {
      setModel(null);
      setModelError(null);
      
      // Gunakan subfolder agar tidak ada bentrok nama file .bin
      const modelPath = modelType === 'CNN' ? '/model/cnn/model.json' : '/model/mobilenet/model.json';
      const folderPath = modelPath.substring(0, modelPath.lastIndexOf('/'));
      
      try {
        const response = await fetch(modelPath);
        
        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: Gagal mengambil ${modelPath}`);
        }
        const json = await response.json();
        
        let loadedModel;
        
        // Cek apakah ini Layers Model atau Graph Model
        const isGraphModel = json.format === 'graph-model' || (json.modelTopology && Array.isArray(json.modelTopology.node));
        const isLayersModel = json.format === 'layers-model' || (json.modelTopology && (json.modelTopology.model_config || json.modelTopology.keras_version)) || !isGraphModel;

        if (isLayersModel && !isGraphModel) {
          // Beberapa model TFJS menyimpan modelTopology sebagai string JSON
          let topologyObj = json.modelTopology;
          let isTopologyString = typeof topologyObj === 'string';
          if (isTopologyString) {
            try {
              topologyObj = JSON.parse(topologyObj);
            } catch (e) {
              console.error("Gagal parse modelTopology string", e);
            }
          }

          // Fix untuk bug Keras v3 dimana InputLayer menggunakan 'batch_shape' bukannya 'batchInputShape'
          // Dan bug inbound_nodes yang formatnya berubah di Keras v3
          let hasKerasV3Bug = false;
          
          const fixKerasV3Topology = (obj: any) => {
            if (!obj || typeof obj !== 'object') return;
            
            if (obj.class_name === 'InputLayer' && obj.config) {
              if (obj.config.batch_shape && !obj.config.batchInputShape) {
                obj.config.batchInputShape = obj.config.batch_shape;
                hasKerasV3Bug = true;
              } else if (obj.config.shape && !obj.config.batchInputShape) {
                obj.config.batchInputShape = [null, ...obj.config.shape];
                hasKerasV3Bug = true;
              }
            }

            // Fix inbound_nodes untuk Keras v3 (dari array of dicts menjadi array of arrays)
            if (obj.inbound_nodes && Array.isArray(obj.inbound_nodes) && obj.inbound_nodes.length > 0) {
              const firstNode = obj.inbound_nodes[0];
              if (typeof firstNode === 'object' && !Array.isArray(firstNode)) {
                hasKerasV3Bug = true;
                const newInboundNodes: any[] = [];
                obj.inbound_nodes.forEach((node: any) => {
                  if (node.args) {
                    const nodeData: any[] = [];
                    const processArg = (arg: any) => {
                      if (arg && arg.class_name === '__keras_tensor__' && arg.config && arg.config.keras_history) {
                        const history = arg.config.keras_history;
                        nodeData.push([history[0], history[1], history[2], node.kwargs || {}]);
                      } else if (Array.isArray(arg)) {
                        arg.forEach(processArg);
                      }
                    };
                    node.args.forEach(processArg);
                    if (nodeData.length > 0) {
                      newInboundNodes.push(nodeData);
                    }
                  }
                });
                if (newInboundNodes.length > 0) {
                  obj.inbound_nodes = newInboundNodes;
                }
              }
            }

            if (Array.isArray(obj)) {
              obj.forEach(fixKerasV3Topology);
            } else {
              Object.values(obj).forEach(fixKerasV3Topology);
            }
          };
          
          fixKerasV3Topology(topologyObj);

          if (hasKerasV3Bug) {
            console.log("Memperbaiki JSON model Keras v3 secara otomatis...");
            const weightSpecs: any[] = [];
            let totalLength = 0;
            const weightDataBuffers: ArrayBuffer[] = [];
            
            for (const group of json.weightsManifest) {
              weightSpecs.push(...group.weights);
              for (const p of group.paths) {
                const res = await fetch(`${folderPath}/${p}`);
                if (!res.ok) throw new Error(`Gagal memuat bobot: ${p}`);
                const buffer = await res.arrayBuffer();
                weightDataBuffers.push(buffer);
                totalLength += buffer.byteLength;
              }
            }
            
            const weightData = new Uint8Array(totalLength);
            let offset = 0;
            for (const b of weightDataBuffers) {
              weightData.set(new Uint8Array(b), offset);
              offset += b.byteLength;
            }
            
            const fixedTopology = isTopologyString ? JSON.stringify(topologyObj) : topologyObj;
            loadedModel = await tf.loadLayersModel(tf.io.fromMemory(fixedTopology, weightSpecs, weightData.buffer));
          } else {
            // Jika tidak ada bug, fallback ke loadLayersModel langsung
            loadedModel = await tf.loadLayersModel(modelPath);
          }
        } else {
          // asumsikan tfjs graph model
          loadedModel = await tf.loadGraphModel(modelPath);
        }
      
        setModel(loadedModel);
        setModelError(null);
      } catch (err: any) {
        console.error(`Gagal memuat model:`, err);
        setModelError(
          `Gagal memuat model: ${err.message || err}. Pastikan Anda telah menempatkan file model.json dan .bin untuk ${modelType} di folder public${folderPath}/`
        );
      }
    }
    loadModel();
  }, [modelType]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setSelectedImage(result);
      setPrediction(null);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setPrediction(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImageUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrlInput) return;
    
    setSelectedImage(imageUrlInput);
    setPrediction(null);
    setImageUrlInput('');
  };

  const handlePredictClick = () => {
    if (!model) {
      const folderPath = modelType === 'CNN' ? '/model/cnn/' : '/model/mobilenet/';
      alert(`Model ${modelType} belum berhasil dimuat! Pastikan Anda sudah meletakkan file model.json dan .bin di folder public${folderPath}`);
      return;
    }
    if (selectedImage && !isPredicting) {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Important for CORS
      img.src = selectedImage;
      img.onload = () => {
        runPrediction(img);
      };
      img.onerror = () => {
        alert('Gagal memuat gambar. Jika menggunakan URL, mungkin server tidak mengizinkan akses silang (CORS). Coba unduh gambar lalu upload secara manual.');
        setIsPredicting(false);
      }
    }
  };

  const runPrediction = async (imageElement: HTMLImageElement) => {
    if (!model) return;
    setIsPredicting(true);
    setPrediction(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 50));

      const probs = tf.tidy(() => {
        const imgTensor = tf.browser.fromPixels(imageElement).toFloat();
        const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
        
        // Kita gunakan normalisasi 0-1 secara konsisten jika di Keras awalnya dilatih dengan rescale=1./255
        let normalized = resized.div(tf.scalar(255.0));
        
        // Cek jika MobileNetV2 normalisasi adalah [-1, 1]
        // Sebenarnya preprocess_input keras resnet/mobilenetv2 adalah: (pixel / 127.5) - 1.0
        if (modelType === 'MobileNetV2') {
          normalized = resized.div(tf.scalar(127.5)).sub(tf.scalar(1.0));
        }
        
        const batched = normalized.expandDims(0);
        
        const output = model.predict(batched) as tf.Tensor;
        const data = output.dataSync(); 
        
        return Array.from(data).map((score, i) => ({
          label: CLASSES[i],
          score: Math.max(0, Math.min(1, score)) 
        })).sort((a, b) => b.score - a.score);
      });
      
      setPrediction(probs);
      
      // Cek prediksi > 60% untuk mengontrol relay
      const topPrediction = probs[0]; // probs sudah diurutkan dari yang terbesar

      // Default semua relay mati
      let relay1State = false;
      let relay2State = false;
      let relay3State = false;
      let relay4State = false;

      if (topPrediction && topPrediction.score >= 0.6) {
        if (topPrediction.label === 'Kucing') {
          relay1State = true;
        } else if (topPrediction.label === 'Ayam') {
          relay2State = true;
        } else if (topPrediction.label === 'Kupu-kupu') {
          relay3State = true;
        } else if (topPrediction.label === 'Kuda') {
          relay4State = true;
        } else if (topPrediction.label === 'Gajah') {
          relay1State = true;
          relay2State = true;
          relay3State = true;
          relay4State = true;
        }
      }

      triggerRelay('relay1', relay1State);
      triggerRelay('relay2', relay2State);
      triggerRelay('relay3', relay3State);
      triggerRelay('relay4', relay4State);
      
    } catch (error) {
      console.error("Error inference model:", error);
    } finally {
      setIsPredicting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans flex flex-col transition-colors duration-300 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-accent-100/50 to-transparent dark:from-accent-900/10 dark:to-transparent -z-10" />
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-accent-400/10 dark:bg-accent-500/5 blur-[100px] -z-10" />
      <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-400/10 dark:bg-blue-500/5 blur-[100px] -z-10" />

      {/* Navbar (Eye Catching Dark) */}
      <nav className="sticky top-0 z-50 bg-slate-900 border-b border-indigo-500/30 shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo area */}
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-xl text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                <ScanLineIcon className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg tracking-tight hidden sm:block text-white">Klasifikasi Hewan</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-800 border border-slate-700 rounded-full shadow-sm text-sm font-medium hover:bg-slate-700 text-slate-200 transition"
                >
                  <span className="hidden sm:inline">Model:</span> <span className="text-indigo-400 font-bold">{modelType}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {isModelDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-12 right-0 sm:left-auto w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-50 overflow-hidden text-slate-200"
                    >
                      {MODELS.map((type) => (
                        <button
                          key={type}
                          onClick={() => {
                            setModelType(type);
                            setIsModelDropdownOpen(false);
                            if (selectedImage) {
                              setPrediction(null);
                            }
                          }}
                          className="w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-indigo-500/20 transition-colors"
                        >
                          {type}
                          {modelType === type && <Check className="w-4 h-4 text-indigo-400" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 sm:px-3 sm:py-2 bg-slate-800 border border-slate-700 rounded-full shadow-sm text-slate-300 hover:text-white transition"
              >
                {isDarkMode ? <Sun className="w-5 h-5 sm:w-4 sm:h-4" /> : <Moon className="w-5 h-5 sm:w-4 sm:h-4 text-indigo-200" />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 flex flex-col items-center justify-center">
        <header className="text-center space-y-4 mb-8">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">Prediksi Hewan Pintar</h2>
          <p className="text-base md:text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Unggah gambar hewan untuk memprediksi kelasnya dengan cepat (Kucing, Ayam, Kuda, Kupu-kupu, atau Gajah).
          </p>
        </header>

        <main className="w-full backdrop-blur-xl bg-white/60 dark:bg-slate-800/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/40 dark:border-slate-700/50 p-6 md:p-8 overflow-hidden transition-all duration-300">
          
          <AnimatePresence mode="wait">
            {!selectedImage ? (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full flex flex-col gap-6"
              >
                <div
                  className={`relative group border-2 border-dashed rounded-2xl p-12 transition-all duration-200 ease-in-out cursor-pointer flex flex-col items-center justify-center text-center
                    ${isDragging 
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10' 
                      : 'border-slate-300/80 dark:border-slate-600/60 hover:border-indigo-400 hover:bg-slate-50/50 dark:hover:bg-slate-700/30'
                    }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileInput}
                    accept="image/jpeg, image/png, image/webp"
                    className="hidden"
                  />
                  <div className="w-16 h-16 mb-4 rounded-full bg-white/80 dark:bg-slate-700/80 shadow-sm text-slate-400 dark:text-slate-300 flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-all">
                    <UploadCloud className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 dark:text-white">Klik untuk upload atau seret gambar device ke sini</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Mendukung JPG, PNG, atau WEBP</p>
                </div>
                
                <div className="flex items-center gap-4 text-slate-400 dark:text-slate-500 text-sm px-4">
                  <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                  <span>ATAU URL ONLINE</span>
                  <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                </div>

                <form onSubmit={handleImageUrlSubmit} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="url"
                    placeholder="Tempel link gambar URL di sini..."
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200"
                    required
                  />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl shadow-sm transition font-medium whitespace-nowrap"
                  >
                    Pakai URL
                  </button>
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="grid md:grid-cols-2 gap-8"
              >
                {/* Image Preview Window */}
                <div className="relative rounded-2xl overflow-hidden border border-white/50 dark:border-slate-700/50 bg-slate-100/50 dark:bg-slate-900/50 min-h-[300px] flex items-center justify-center group backdrop-blur-md">
                  <img
                    src={selectedImage}
                    alt="Preview"
                    className="object-cover w-full h-full max-h-[400px]"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                    <button
                      onClick={clearImage}
                      className="bg-white/90 dark:bg-slate-800/90 text-slate-900 dark:text-white font-medium px-4 py-2 rounded-full flex items-center gap-2 hover:scale-105 transition-transform shadow-lg backdrop-blur-md"
                    >
                      <X className="w-4 h-4" /> Ganti Gambar
                    </button>
                  </div>
                </div>

                {/* Results Window */}
                <div className="flex flex-col justify-center space-y-6">
                  <div>
                    <h3 className="text-2xl font-bold flex items-center gap-2 mb-1 dark:text-white">
                      Hasil Analisis
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Distribusi probabilitas dari model
                    </p>
                  </div>

                  <div className="space-y-4">
                    {!prediction && !isPredicting && (
                      <div className="flex flex-col items-center justify-center py-10 space-y-4">
                        <button
                          onClick={handlePredictClick}
                          disabled={!model}
                          className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-full shadow-lg shadow-indigo-500/30 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                        >
                          {model ? "Prediksi Sekarang" : "Menunggu Model..."}
                        </button>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Tekan tombol di atas untuk memulai analisis dengan {modelType}</p>
                      </div>
                    )}
                  
                    {isPredicting ? (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500 space-y-4">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        <span className="font-medium animate-pulse text-slate-600 dark:text-slate-400">Model sedang memproses...</span>
                      </div>
                    ) : prediction ? (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        {prediction.map((p, i) => (
                          <div key={p.label} className="space-y-1.5">
                            <div className="flex justify-between items-end text-sm">
                              <span className={`font-medium ${i === 0 ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                {p.label}
                                {i === 0 && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">Top Match</span>}
                              </span>
                              <span className="text-slate-500 dark:text-slate-400 font-mono text-xs">
                                {(p.score * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full bg-slate-200/50 dark:bg-slate-700/50 rounded-full h-2 overflow-hidden backdrop-blur-sm -z-10 relative">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${p.score * 100}%` }}
                                transition={{ duration: 0.8, ease: "easeOut", delay: i * 0.1 }}
                                className={`absolute top-0 left-0 h-full rounded-full ${
                                  i === 0 ? 'bg-accent-500' : 'bg-slate-400 dark:bg-slate-500'
                                }`}
                              />
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        
        {/* Footer info block */}
        <footer className="w-full text-center text-sm text-slate-400 dark:text-slate-400 mt-10 space-y-4 pb-8">
          {modelError ? (
            <div className="flex items-start md:items-center justify-center gap-2 text-amber-600 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-900/20 backdrop-blur-md mx-auto px-4 py-3 rounded-lg max-w-xl text-left md:text-center border border-amber-200/50 dark:border-amber-800/30 shadow-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{modelError}</p>
            </div>
          ) : !model ? (
            <div className="flex items-center justify-center gap-2 text-accent-600 dark:text-accent-400 animate-pulse bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-full px-4 py-2 mx-auto w-fit shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <p>Memuat model TensorFlow.js ({modelType})...</p>
            </div>
          ) : (
            <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-full px-4 py-2 mx-auto w-fit shadow-sm border border-white/20 dark:border-slate-700/30">
              <p className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 inline-block animate-pulse"></span>
                Model {modelType} siap digunakan
              </p>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function ScanLineIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </svg>
  );
}


