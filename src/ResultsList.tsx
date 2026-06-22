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
      className={`qx-list-row${selected ? " is-active" : ""}`}
    >
      {item.icon ? (
        <img
          src={`file://${item.icon}`}
          alt=""
          className="qx-list-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        <div className="qx-list-icon" />
      )}
      <div className="qx-list-copy">
        <div className="qx-list-title" style={{ fontWeight: 500 }}>
          {item.name}
        </div>
        <div className="qx-list-subtitle">
          {item.path.replace("/Applications/", "").replace("/System/Applications/", "System/")}
        </div>
      </div>
      <span className="qx-list-time">
        Application
      </span>
    </motion.div>
  );
}

export default function ResultsList({
  items,
  onItemClick,
}: {
  items: AppEntry[];
  onItemClick: (item: AppEntry) => void;
}) {
  return (
    <div className="qx-plugin-list" style={{ flex: 1, borderRight: "none" }}>
      {items.length > 0 && (
        <div className="qx-section-header">Suggestions</div>
      )}
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
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--color-text-tertiary)",
            fontSize: 13,
          }}
        >
          No results found
        </div>
      )}
    </div>
  );
}
