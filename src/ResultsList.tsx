import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "./store";
import type { AppEntry } from "./store";

function ResultItem({ item, index }: { item: AppEntry; index: number }) {
  const { selectedIndex, setSelectedIndex } = useStore();
  const selected = index === selectedIndex;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
      onMouseEnter={() => setSelectedIndex(index)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        margin: "0 6px",
        borderRadius: 8,
        cursor: "pointer",
        background: selected ? "var(--selection)" : "transparent",
      }}
    >
      <img
        src={item.icon}
        alt=""
        style={{ width: 24, height: 24, borderRadius: 4 }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.path}
        </div>
      </div>
    </motion.div>
  );
}

export default function ResultsList({ items, onItemClick }: { items: AppEntry[]; onItemClick: (item: AppEntry) => void }) {
  return (
    <div style={{ padding: "6px 0", maxHeight: 380, overflowY: "auto" }}>
      <AnimatePresence>
        {items.map((item, i) => (
          <div key={item.path} onClick={() => onItemClick(item)}>
            <ResultItem item={item} index={i} />
          </div>
        ))}
      </AnimatePresence>
      {items.length === 0 && (
        <div
          style={{
            padding: "24px 16px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          No results found
        </div>
      )}
    </div>
  );
}
