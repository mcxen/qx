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
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--qx-overlay-1)",
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
            color: "var(--qx-text-on-accent)",
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
          borderRadius: 4,
          objectFit: "contain",
          boxShadow: "none",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.1s",
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
          borderRadius: 6,
          border: "none",
          background: "var(--qx-overlay-4)",
          color: "var(--qx-text-on-accent)",
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
