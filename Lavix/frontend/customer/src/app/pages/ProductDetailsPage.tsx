import { useState, useRef, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { 
  ChevronRight, 
  ArrowRight, 
  ScanFace, 
  X, 
  Upload, 
  Camera as CameraIcon, 
  AlertCircle,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Download,
  Maximize,
  Minimize,
  ChevronLeft,
  Search,
  Sparkles,
  ShoppingBag,
  SwitchCamera
} from "lucide-react";
import Webcam from "react-webcam";
import { Header } from "../components/Header";
import FeedbackModal from "../components/FeedbackModal";
import { convertUrlToBase64, requestVirtualTryOn, PRODUCT_CATEGORIES } from "../services/api";
import { useTryOnActivity } from "../context/TryOnActivityContext";
import { loadDetector, runDetection } from "../detectors/DetectorManager";
import { evaluateFraming, FramingHint } from "../utils/framing";

export interface ColorOption {
  name: string;
  hex: string;
  image?: string;
}

function getColorHex(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("red") || lower.includes("crimson")) return "#800e13";
  if (lower.includes("blue") || lower.includes("navy")) return "#1d2a44";
  if (lower.includes("green") || lower.includes("emerald")) return "#1b4332";
  if (lower.includes("gold") || lower.includes("yellow")) return "#d4af37";
  if (lower.includes("camel") || lower.includes("brown") || lower.includes("tan")) return "#c29b7f";
  if (lower.includes("black") || lower.includes("dark")) return "#111111";
  if (lower.includes("white")) return "#ffffff";
  if (lower.includes("pink")) return "#e0aaff";
  if (lower.includes("purple") || lower.includes("wine") || lower.includes("burgundy")) return "#581845";
  if (lower.includes("silver") || lower.includes("grey") || lower.includes("gray")) return "#8e9aaf";
  return "#4d4d4d";
}

const EXTENDED_CATEGORIES = [
  "Sarees",
  "Shirts",
  "T-Shirts",
  "Tops",
  "Kurtas",
  "Jeans",
  "Trousers",
  "Dresses",
  "Jackets",
  "Ethnic Wear",
  "Men's Wear",
  "Women's Wear",
  "Kids Wear",
] as const;

interface ProductDetailsPageProps {
  category: string;
  categoryLink: string;
  productName: string;
  brand: string;
  price: number;
  originalPrice: number;
  discountPercentage: number;
  discountAmount: number;
  images: string[];
  colors?: (string | ColorOption)[];
  sizes: number[];
  relatedProducts?: {
    id: number;
    name: string;
    image: string;
  }[];
}

export function ProductDetailsPage({
  category,
  categoryLink,
  productName,
  brand,
  price,
  originalPrice,
  discountPercentage,
  discountAmount,
  images,
  colors,
  sizes,
  relatedProducts,
}: ProductDetailsPageProps) {
  const colorOptions: ColorOption[] = (colors || []).map((c, i) => {
    if (typeof c === "object" && c.name && c.hex) return c;
    if (typeof c === "string" && (c.startsWith("#") || c.startsWith("rgb"))) {
      return { name: `Color ${i + 1}`, hex: c };
    }
    const colorName = typeof c === "string" && !c.startsWith("data:") && !c.includes("/") ? c : i === 0 ? "Camel" : i === 1 ? "Charcoal" : i === 2 ? "Navy Blue" : "Midnight Black";
    return { name: colorName, hex: getColorHex(colorName) };
  });

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] || images[0];

  const [isTryOnModalOpen, setIsTryOnModalOpen] = useState(false);
  const [faceImage, setFaceImage] = useState<string | null>(null);
  const [isTryOnLoading, setIsTryOnLoading] = useState(false);
  const [tryOnResult, setTryOnResult] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  // WhatsApp-style flip: front by default, one tap swaps to the rear camera
  // (useful on phones/tablets — kiosks only ever have the one front camera,
  // so the button is harmless there and simply has nothing to switch to).
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDegradedResult, setIsDegradedResult] = useState(false);
  const [cartAdded, setCartAdded] = useState(false);

  const LOADING_MESSAGES = [
    "Aligning Body & Rendering Garment...",
    "Analyzing Fabric Physics...",
    "Stitching Seamless Edges...",
    "Applying Lighting & Shadows...",
    "Generating Virtual Try-On..."
  ];
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  useEffect(() => {
    if (isTryOnLoading) {
      const interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [isTryOnLoading]);

  // Virtual Try-On Panel State
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [isFavorite, setIsFavorite] = useState<boolean>(false);
  const [selectedFitSize, setSelectedFitSize] = useState<string>("M");
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  const webcamRef = useRef<Webcam>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Live positioning guidance. Vertex needs a full-body, front-facing photo;
  // the kiosk webcam otherwise tends to capture a head-and-shoulders crop, and
  // Vertex still renders a full-length garment with no body to put it on --
  // which is what produced garments floating in mid-air with nothing under
  // them. Face size relative to the frame is a reliable stand-in for distance,
  // so tell the customer to reposition before they press the button rather
  // than only finding out after a render comes back wrong.
  const [framingHint, setFramingHint] = useState<FramingHint | null>(null);
  const framingRafRef = useRef<number>(0);

  // Suspends the idle-ad detector while the mirror is open. Driven by an effect
  // rather than the open/close handlers so it also unwinds if this page
  // unmounts with the modal still open.
  const { setTryOnActive } = useTryOnActivity();
  useEffect(() => {
    setTryOnActive(isTryOnModalOpen);
    return () => setTryOnActive(false);
  }, [isTryOnModalOpen, setTryOnActive]);

  const [modalCameraCountdown, setModalCameraCountdown] = useState<number | null>(null);

  // Runs while the live webcam preview is showing (not once a photo is
  // captured or a countdown is underway) and updates framingHint every frame.
  useEffect(() => {
    const active = isTryOnModalOpen && isCameraActive && !faceImage && modalCameraCountdown === null;
    if (!active) {
      cancelAnimationFrame(framingRafRef.current);
      setFramingHint(null);
      return;
    }

    let cancelled = false;

    loadDetector("face")
      .then(() => {
        if (cancelled) return;
        const tick = () => {
          const video = webcamRef.current?.video;
          if (video && video.readyState >= 2) {
            try {
              const result = runDetection("face", video) as any;
              setFramingHint(evaluateFraming(result?.faceLandmarks?.[0]));
            } catch {
              // A transient detector hiccup shouldn't crash the mirror; try
              // again next frame.
            }
          }
          framingRafRef.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((err) => console.error("[Framing] detector load failed:", err));

    return () => {
      cancelled = true;
      cancelAnimationFrame(framingRafRef.current);
    };
  }, [isTryOnModalOpen, isCameraActive, faceImage, modalCameraCountdown]);

  // Customer Feedback States
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackSessionId, setFeedbackSessionId] = useState("");
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTryOnWithFace = async (faceSrc: string) => {
    setIsTryOnLoading(true);
    setErrorMessage(null);

    try {
      const garmentBase64 = await convertUrlToBase64(selectedImage);
      const res = await requestVirtualTryOn(faceSrc, garmentBase64);

      if (res.success && res.result_image) {
        setTryOnResult(res.result_image);

        // The backend returns a flat-overlay composite when Vertex AI is
        // unavailable. Flag it instead of passing it off as a real AI fitting.
        if (res.mode === "local") {
          setIsDegradedResult(true);
          console.warn("[Try-On] Vertex AI unavailable, showing local composite:", res.fallback_reason);
        } else {
          setIsDegradedResult(false);
        }

        // Generate a new unique session ID
        const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setFeedbackSessionId(newSessionId);

        // Clear any active timer
        if (feedbackTimerRef.current) {
          clearTimeout(feedbackTimerRef.current);
        }

        // Start 5 second timer to show feedback modal
        feedbackTimerRef.current = setTimeout(() => {
          setIsFeedbackOpen(true);
        }, 5000);
      } else {
        setErrorMessage(res.error || "Virtual Try-On generation failed.");
      }
    } catch (err: any) {
      setErrorMessage(`Error: ${err.message || "Failed to process image"}`);
    } finally {
      setIsTryOnLoading(false);
    }
  };

  useEffect(() => {
    const autoOpen = sessionStorage.getItem("autoOpenTryOnModal");
    const capturedFace = sessionStorage.getItem("tryOnCapturedFace");
    if (autoOpen === "true" && capturedFace) {
      setFaceImage(capturedFace);
      setIsTryOnModalOpen(true);
      sessionStorage.removeItem("autoOpenTryOnModal");
      sessionStorage.removeItem("tryOnCapturedFace");
      handleTryOnWithFace(capturedFace);
    }
  }, []);

  useEffect(() => {
    if (modalCameraCountdown === null) return;
    if (modalCameraCountdown > 0) {
      const timer = setTimeout(() => setModalCameraCountdown(modalCameraCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      if (webcamRef.current) {
        const imageSrc = webcamRef.current.getScreenshot();
        if (imageSrc) {
          setFaceImage(imageSrc);
          setIsCameraActive(false);
          setErrorMessage(null);
          setModalCameraCountdown(null);
          handleTryOnWithFace(imageSrc);
        }
      }
    }
  }, [modalCameraCountdown]);

  const handleStartModalCountdown = () => {
    if (modalCameraCountdown === null) {
      setModalCameraCountdown(3);
    }
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const uploadedImg = reader.result as string;
        setFaceImage(uploadedImg);
        setErrorMessage(null);
        handleTryOnWithFace(uploadedImg);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCapture = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        setFaceImage(imageSrc);
        setIsCameraActive(false);
        setErrorMessage(null);
        handleTryOnWithFace(imageSrc);
      }
    }
  }, [webcamRef, selectedImage]);

  const navigate = useNavigate();

  const handleStartCamera = () => {
    setIsCameraActive(true);
  };

  const enterFullScreen = () => {
    const el = mirrorRef.current as any;
    if (!el) return;
    const doc: any = document;
    if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement) return;

    const request =
      el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (request) {
      // Fails silently if the browser blocks it (no user gesture, iOS Safari);
      // the modal is still full-viewport via CSS in that case.
      Promise.resolve(request.call(el)).then(() => setIsFullScreen(true)).catch(() => {});
    }
  };

  const exitFullScreen = () => {
    const doc: any = document;
    if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    }
    setIsFullScreen(false);
  };

  // The modal element only exists after isTryOnModalOpen flips to true, so the
  // fullscreen request has to happen once it is mounted — not inside the click.
  useEffect(() => {
    if (isTryOnModalOpen) enterFullScreen();
  }, [isTryOnModalOpen]);

  // Keep state in sync when the user leaves fullscreen with Esc.
  useEffect(() => {
    const onChange = () => {
      const doc: any = document;
      setIsFullScreen(
        Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement)
      );
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const handleOpenMirrorModal = () => {
    setIsTryOnModalOpen(true);
    setIsCameraActive(true); // Automatically activate live webcam when mirror modal opens
    setFaceImage(null);
    setTryOnResult(null);
    setErrorMessage(null);
    setModalCameraCountdown(null);
  };

  const handleCloseModal = () => {
    exitFullScreen();
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setIsFeedbackOpen(false);
    setIsTryOnModalOpen(false);
    setIsTryOnLoading(false);
    setFaceImage(null);
    setTryOnResult(null);
    setIsDegradedResult(false);
    setIsCameraActive(false);
    setErrorMessage(null);
    setZoomLevel(100);
    setRotationAngle(0);
    setModalCameraCountdown(null);
  };

  const handleDownloadSnapshot = () => {
    const link = document.createElement("a");
    link.href = tryOnResult || selectedImage;
    link.download = `lavix-tryon-${Date.now()}.png`;
    link.click();
  };

  const handleRestartSession = () => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setIsFeedbackOpen(false);
    setFaceImage(null);
    setTryOnResult(null);
    setIsDegradedResult(false);
    setIsCameraActive(true);
    setErrorMessage(null);
    setZoomLevel(100);
    setRotationAngle(0);
    setModalCameraCountdown(null);
  };

  const handlePrevGarment = () => {
    setSelectedImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNextGarment = () => {
    setSelectedImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="bg-[#f6f6f6] min-h-screen flex flex-col items-center w-full font-['Clash_Display',sans-serif]">
      <Header />

      <div className="w-full max-w-[2000px] px-4 sm:px-8 md:px-[64px] py-4 sm:py-[24px] flex flex-col">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 sm:gap-[16px] text-sm sm:text-lg md:text-[24px] font-medium mb-4 sm:mb-[32px] overflow-x-auto whitespace-nowrap">
          <Link to="/home" className="text-[#b1b1b1] hover:text-black transition-colors">Home</Link>
          <span className="text-[#b1b1b1]">/</span>
          <Link to={categoryLink} className="text-[#b1b1b1] hover:text-black transition-colors">{category}</Link>
          <span className="text-[#b1b1b1]">/</span>
          <span className="text-black">{productName}</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 lg:gap-[64px] items-start w-full relative">
          
          {/* Left Column: Main Garment Image */}
          <div className="w-full lg:w-[680px] shrink-0 lg:sticky lg:top-[32px] flex flex-col">
            <div className="w-full aspect-[4/3] sm:aspect-[738/705] bg-[#e2ded9] rounded-2xl overflow-hidden relative shadow-sm">
              <img src={selectedImage} alt={productName} className="w-full h-full object-cover" />
            </div>
          </div>

          {/* Right Column: Product Info & Actions */}
          <div className="w-full flex-1 flex flex-col justify-between self-stretch min-h-0 lg:min-h-[705px]">
            <div className="flex flex-col gap-6 sm:gap-[32px]">
              
              <div className="flex flex-col gap-2 sm:gap-[12px]">
                <span className="text-sm sm:text-[20px] font-bold tracking-widest text-[#767676] uppercase">{brand}</span>
                <h1 className="text-2xl sm:text-3xl md:text-[44px] font-semibold text-[#1d1b20] leading-tight">{productName}</h1>
              </div>

              {/* Price & Discounts */}
              <div className="flex items-baseline gap-3 sm:gap-[16px] flex-wrap">
                <span className="text-2xl sm:text-3xl md:text-[36px] font-bold text-black">Rs. {price}</span>
                {originalPrice && (
                  <span className="text-lg sm:text-[24px] font-medium text-[#767676] line-through">Rs. {originalPrice}</span>
                )}
                {discountPercentage && (
                  <span className="text-xs sm:text-base md:text-[20px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                    ({discountPercentage}% OFF - Save Rs. {discountAmount})
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-[16px] mt-2 sm:mt-[16px]">
                <button 
                  onClick={handleOpenMirrorModal}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 sm:py-[20px] px-4 sm:px-8 rounded-2xl text-base sm:text-[20px] flex items-center justify-center gap-3 transition-all shadow-lg active:scale-98 cursor-pointer"
                >
                  <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300 animate-spin" />
                  <span>Virtual Try-On Mirror</span>
                </button>

                <button 
                  onClick={() => setCartAdded(true)}
                  className={`flex-1 font-bold py-4 sm:py-[20px] px-4 sm:px-8 rounded-2xl text-base sm:text-[20px] flex items-center justify-center gap-3 transition-all shadow-sm ${
                    cartAdded ? "bg-emerald-600 text-white" : "bg-black hover:bg-gray-900 text-white"
                  }`}
                >
                  <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6" />
                  <span>{cartAdded ? "Added to Bag!" : "Add to Shopping Bag"}</span>
                </button>
              </div>

            </div>

            {/* Product Details Section */}
            <div className="flex flex-col gap-4 sm:gap-[32px] pt-6 sm:pt-[32px] border-t border-gray-200 mt-6 sm:mt-[16px]">
              <div className="flex flex-col gap-2 sm:gap-[16px]">
                <h3 className="text-xl sm:text-[28px] font-semibold text-[#1d1b20]">Product Details</h3>
                <div className="font-['Satoshi',sans-serif] text-base sm:text-[24px] text-black leading-relaxed space-y-1">
                  <p>Category: {category}</p>
                  <p>Brand Fit: Relaxed</p>
                  <p>High-quality fabric blend</p>
                  <p>Machine Washable</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* VIRTUAL TRY-ON MODAL PANEL (CLEAN FULL SCREEN EDGE-TO-EDGE) */}
      {isTryOnModalOpen && (
        <div
          ref={mirrorRef}
          className="fixed inset-0 z-[100] bg-black w-full h-[100dvh] overflow-hidden flex flex-col p-0 m-0"
        >
          
          {/* Modal Header Controls (Floating Overlay) */}
          <div className="absolute top-0 left-0 right-0 z-40 flex justify-between items-center px-6 py-5 bg-gradient-to-b from-black/90 via-black/40 to-transparent text-white">
            <div className="flex items-center gap-3">
              <ScanFace className="w-7 h-7 text-emerald-400" />
              <div>
                <h2 className="text-xl font-bold tracking-tight">Lavix Virtual Mirror</h2>
                <div
                  className={`flex items-center gap-2 text-xs font-semibold ${
                    tryOnResult && isDegradedResult ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full animate-pulse ${
                      tryOnResult && isDegradedResult ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                  />
                  <span>
                    {tryOnResult
                      ? isDegradedResult
                        ? "Preview Only — AI Fitting Unavailable"
                        : "Rendered AI Output Ready"
                      : isTryOnLoading
                      ? "Rendering Garment..."
                      : "Live Webcam Active"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!faceImage && !tryOnResult && !isTryOnLoading && (
                <button
                  onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
                  className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-colors text-white border border-white/20 shadow-xl cursor-pointer"
                  title="Switch Camera"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>
              )}

              <button
                onClick={() => (isFullScreen ? exitFullScreen() : enterFullScreen())}
                className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-colors text-white border border-white/20 shadow-xl cursor-pointer"
                title={isFullScreen ? "Exit Full Screen" : "Enter Full Screen"}
              >
                {isFullScreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>

              <button
                onClick={handleRestartSession}
                className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-colors text-white border border-white/20 shadow-xl cursor-pointer"
                title="Restart Session"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              <button 
                onClick={handleCloseModal}
                className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-colors text-white border border-white/20 shadow-xl cursor-pointer"
                title="Close Virtual Mirror"
              >
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Modal Body: FULL SCREEN VIEW */}
          {tryOnResult ? (
            <div className="w-full h-full relative flex items-center justify-center bg-black p-0 m-0 overflow-hidden">
              {/* Every kiosk this app runs on has a different screen shape, so
                  the result always fills it edge-to-edge (object-cover) rather
                  than being letterboxed to fit — trading a small amount of
                  cropping at the edges for a guaranteed full-screen fit. */}
              <img
                src={tryOnResult}
                alt="Virtual Try-On Render Output"
                className="w-full h-full object-cover"
              />

              {/* Floating Bottom Action Overlay */}
              <div className="absolute bottom-0 left-0 right-0 z-40 p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex flex-col sm:flex-row items-center justify-center gap-4">
                <button 
                  onClick={handleDownloadSnapshot}
                  className="w-full max-w-[280px] bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-xl active:scale-98 cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Save Image to Device
                </button>

                <button 
                  onClick={handleRestartSession}
                  className="w-full sm:w-auto bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/20 rounded-xl px-5 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Retake Photo
                </button>
              </div>
            </div>
          ) : isTryOnLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black relative">
              {faceImage && <img src={faceImage} alt="Face background" className="w-full h-full object-cover opacity-30 blur-md" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-20">
                <div className="w-48 h-48 rounded-full overflow-hidden relative border-4 border-indigo-500 shadow-2xl">
                  {faceImage && <img src={faceImage} alt="Face" className="w-full h-full object-cover" />}
                  <div className="absolute left-0 right-0 h-2 bg-indigo-500 shadow-[0_0_20px_6px_#6366f1] animate-[scan_2s_ease-in-out_infinite]" />
                </div>
                <p className="text-xl text-indigo-300 font-bold animate-pulse flex items-center gap-2 bg-black/80 px-8 py-4 rounded-full border border-indigo-500/40 backdrop-blur-md shadow-2xl">
                  <Sparkles className="w-6 h-6 text-amber-300 animate-spin" /> {LOADING_MESSAGES[loadingMessageIndex]}
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full h-full relative bg-black flex items-center justify-center overflow-hidden">
              <input 
                type="file" 
                ref={fileInputRef} 
                accept="image/*" 
                className="hidden" 
                onChange={handleFileChange} 
              />

              {errorMessage && (
                <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 p-4 rounded-2xl bg-red-900/90 border border-red-500 text-white flex items-center gap-3 text-sm font-medium shadow-2xl backdrop-blur-md">
                  <AlertCircle className="w-5 h-5 text-red-300 shrink-0" />
                  <div>{errorMessage}</div>
                </div>
              )}

              {faceImage ? (
                <div className="w-full h-full relative bg-black flex items-center justify-center">
                  <img src={faceImage} alt="Captured Face" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setFaceImage(null)}
                    className="absolute top-24 right-6 z-30 bg-black/70 text-white p-3 rounded-full hover:bg-black transition-colors border border-white/20 shadow-xl"
                    title="Remove Photo"
                  >
                    <X size={24} />
                  </button>
                </div>
              ) : (
                <div className="w-full h-full relative bg-black flex items-center justify-center">
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/png"
                    className="w-full h-full object-cover"
                    videoConstraints={{
                      width: { ideal: 1920 },
                      height: { ideal: 1080 },
                      facingMode
                    }}
                  />

                  {/* Live positioning guidance */}
                  {framingHint && modalCameraCountdown === null && (
                    <div className="absolute top-28 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                      <div
                        className={`flex items-center gap-2.5 px-5 py-2.5 rounded-full backdrop-blur-md border shadow-2xl transition-colors duration-300 ${
                          framingHint.ready
                            ? "bg-emerald-500/90 border-emerald-300/40 text-black"
                            : "bg-black/70 border-white/20 text-white"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            framingHint.ready ? "bg-black" : "bg-amber-400 animate-pulse"
                          }`}
                        />
                        <span className="text-sm font-semibold whitespace-nowrap">{framingHint.message}</span>
                      </div>
                    </div>
                  )}

                  {/* 3-2-1 Countdown Overlay */}
                  {modalCameraCountdown !== null && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none z-20">
                      <div className="w-36 h-36 rounded-full bg-white/20 border-4 border-white/60 flex items-center justify-center backdrop-blur-md animate-bounce shadow-2xl">
                        <span className="text-white text-7xl font-bold font-mono">
                          {modalCameraCountdown > 0 ? modalCameraCountdown : "📸"}
                        </span>
                      </div>
                      <p className="text-white text-xl font-bold mt-4 tracking-wider uppercase animate-pulse">
                        {modalCameraCountdown > 0 ? "Hold Still..." : "Smile! Capturing..."}
                      </p>
                    </div>
                  )}

                  {/* Bottom Center Floating Action Control Bar */}
                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 bg-black/60 backdrop-blur-xl p-3 px-6 rounded-full border border-white/20 shadow-2xl">
                    <button 
                      onClick={handleStartModalCountdown}
                      disabled={modalCameraCountdown !== null}
                      className="px-8 py-3.5 bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-500 hover:to-teal-600 text-black font-extrabold text-lg rounded-full shadow-2xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                    >
                      <Sparkles className="w-5 h-5 text-black fill-black" />
                      <span>{modalCameraCountdown !== null ? `${modalCameraCountdown}s` : "Start Virtual Try-On"}</span>
                    </button>

                    <button
                      onClick={handleUploadClick}
                      className="p-3.5 bg-white/10 hover:bg-white/20 text-white rounded-full border border-white/20 backdrop-blur-md shadow-2xl transition-transform active:scale-95 cursor-pointer"
                      title="Upload Photo from Device"
                    >
                      <Upload size={20} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        sessionId={feedbackSessionId}
        gender={categoryLink.includes("womens") || category.toLowerCase().includes("women") ? "Women" : "Men"}
        selectedGarment={productName}
      />
        </div>
      )}

    </div>
  );
}
