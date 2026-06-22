import { useEffect, useState } from "react";

export default function ImageLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
        cursor: "zoom-out",
        padding: 24,
      }}
    >
      {!loaded && (
        <div
          style={{
            position: "absolute",
            color: "#fff",
            fontSize: 13,
            opacity: 0.7,
          }}
        >
          Loading…
        </div>
      )}
      <img
        src={src}
        alt=""
        onLoad={() => setLoaded(true)}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          borderRadius: 8,
          objectFit: "contain",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.15s",
        }}
      />
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 32,
          height: 32,
          borderRadius: 16,
          border: "none",
          background: "rgba(255,255,255,0.15)",
          color: "#fff",
          fontSize: 16,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}
