import { useNavigate } from "react-router-dom";

// Floating cloth particles data
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  size: 40 + Math.random() * 80,
  x: Math.random() * 100,
  delay: Math.random() * 8,
  duration: 6 + Math.random() * 8,
  opacity: 0.08 + Math.random() * 0.15,
  rotate: Math.random() * 360,
}));

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black flex items-center justify-center">

      {/* ── Animated style block ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;600&display=swap');

        @keyframes floatUp {
          0%   { transform: translateY(110vh) rotate(var(--r)) scale(0.8); opacity: 0; }
          10%  { opacity: var(--op); }
          90%  { opacity: var(--op); }
          100% { transform: translateY(-20vh) rotate(calc(var(--r) + 180deg)) scale(1.1); opacity: 0; }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(255,255,255,0.1); }
          50%       { box-shadow: 0 0 40px rgba(255,255,255,0.3), 0 0 80px rgba(255,200,100,0.15); }
        }
        @keyframes scanLine {
          0%   { top: 0; }
          100% { top: 100%; }
        }

        .shimmer-text {
          background: linear-gradient(90deg, #fff 0%, #ffd700 40%, #fff 60%, #ffd700 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 4s linear infinite;
        }

        .btn-primary {
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, #fff 0%, #f0e8d8 100%);
          color: #111;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          letter-spacing: 0.05em;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .btn-primary::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #ffd700 0%, #ff8c00 100%);
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 20px 60px rgba(255,215,0,0.4); }
        .btn-primary:hover::before { opacity: 1; }
        .btn-primary span { position: relative; z-index: 1; }

        .btn-secondary {
          position: relative;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: white;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          letter-spacing: 0.05em;
          transition: all 0.3s ease;
          backdrop-filter: blur(8px);
        }
        .btn-secondary:hover { 
          transform: translateY(-2px); 
          border-color: #ffd700;
          background: rgba(255, 215, 0, 0.1); 
        }

        .vastra-logo {
          font-family: 'Playfair Display', serif;
          animation: fadeUp 1s ease 0.3s both;
        }
        .vastra-tagline { animation: fadeUp 1s ease 0.6s both; }
        .vastra-label   { animation: fadeUp 1s ease 0.8s both; }
        .vastra-btns    { animation: fadeUp 1s ease 1s both; }
      `}</style>

      {/* ── Background Video ── */}
      <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "#000", overflow: "hidden" }}>
        <video
          src="/intro.mp4"
          poster={`${import.meta.env.BASE_URL}ad-poster.jpg`}
          autoPlay
          muted
          loop
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 20%",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* ── Gradient Overlays (cinematic look) ── */}
      <div className="absolute inset-0 z-[2]"
        style={{
          background: "linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.45) 100%)"
        }}
      />
      {/* Bottom vignette */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 z-[2]"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }}
      />
      {/* Top vignette */}
      <div className="absolute inset-x-0 top-0 h-1/4 z-[2]"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)" }}
      />

      {/* ── Floating Cloth Particles ── */}
      <div className="absolute inset-0 z-[3] pointer-events-none overflow-hidden">
        {PARTICLES.map((p) => (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              bottom: "-10%",
              width: `${p.size}px`,
              height: `${p.size * 1.4}px`,
              "--r": `${p.rotate}deg`,
              "--op": `${p.opacity}`,
              animation: `floatUp ${p.duration}s ease-in-out ${p.delay}s infinite`,
              borderRadius: "4px",
              background: `linear-gradient(${p.rotate}deg, rgba(255,215,0,${p.opacity * 0.8}), rgba(255,140,0,${p.opacity}), rgba(255,255,255,${p.opacity * 0.5}))`,
              filter: "blur(1px)",
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* ── Scan Line Effect ── */}
      <div className="absolute inset-0 z-[3] pointer-events-none overflow-hidden">
        <div
          style={{
            position: "absolute",
            left: 0, right: 0,
            height: "2px",
            background: "linear-gradient(90deg, transparent, rgba(255,215,0,0.35), transparent)",
            animation: "scanLine 8s linear infinite",
          }}
        />
      </div>


      {/* ── Main Content ── */}
      <div className="relative z-[10] flex flex-col items-center gap-6 text-center px-6 max-w-4xl">

        {/* Logo */}
        <div className="vastra-logo">
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(3rem, 8vw, 7rem)", fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
            <span className="shimmer-text">Lavix</span>
          </h1>
        </div>

        {/* Decorative line */}
        <div className="flex items-center gap-4 w-full max-w-xs">
          <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,215,0,0.6))" }} />
          <div className="text-amber-400 text-lg">✦</div>
          <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.6), transparent)" }} />
        </div>

        {/* Tagline */}
        <p
          className="vastra-tagline text-white/80 max-w-xl"
          style={{ fontFamily: "'Inter',sans-serif", fontSize: "clamp(1rem, 2.5vw, 1.25rem)", fontWeight: 300, lineHeight: 1.7, letterSpacing: "0.03em" }}
        >
          Experience the <span style={{ color: "#ffd700", fontWeight: 600 }}>future of fashion</span> with our AI-powered virtual try-on technology. Dress to impress — virtually.
        </p>

        {/* Live indicator */}
        <div className="vastra-label flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-4 rounded-full bg-amber-400"
                style={{ animation: `glowPulse 1.2s ease ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
          <span className="text-white/60 text-sm" style={{ fontFamily: "'Inter',sans-serif" }}>
            Virtual Try-On Live
          </span>
        </div>

        {/* Buttons */}
        <div className="vastra-btns flex flex-col sm:flex-row gap-4 w-full sm:w-auto mt-4">
          <button
            onClick={() => navigate('/home')}
            className="btn-primary px-6 py-3 rounded-full text-base cursor-pointer"
          >
            <span>✦ Welcome to Lavix</span>
          </button>

          <button
            onClick={() => navigate('/admin')}
            className="btn-secondary px-6 py-3 rounded-full text-base cursor-pointer"
          >
            Admin Login →
          </button>
        </div>
      </div>

      {/* ── Bottom strip — collection names ── */}
      <div className="absolute bottom-8 left-0 right-0 z-[10] flex justify-center">
        <div
          className="flex gap-8 px-8 py-3 rounded-full"
          style={{
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {["Ethnic Wear", "Western", "Formals", "Fusion", "Bridal"].map((cat) => (
            <span
              key={cat}
              className="text-white/50 text-xs tracking-widest uppercase hover:text-amber-400 transition-colors cursor-pointer"
              style={{ fontFamily: "'Inter',sans-serif" }}
            >
              {cat}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
