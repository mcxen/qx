import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge, Button, Input } from "./ui";
import type { SearchMetadataEntry } from "../modules/settings/store";

type TokenKind = "aliases" | "tags";

function normalizeToken(value: string): string {
  return value.trim().replace(/^#/, "");
}

function addToken(entry: SearchMetadataEntry, kind: TokenKind, value: string): SearchMetadataEntry {
  const token = normalizeToken(value);
  if (!token) return entry;
  return {
    ...entry,
    [kind]: Array.from(new Set([...entry[kind], token])),
  };
}

function removeToken(entry: SearchMetadataEntry, kind: TokenKind, value: string): SearchMetadataEntry {
  return {
    ...entry,
    [kind]: entry[kind].filter((item) => item !== value),
  };
}

function TokenSection({
  label,
  placeholder,
  kind,
  entry,
  onChange,
}: {
  label: string;
  placeholder: string;
  kind: TokenKind;
  entry: SearchMetadataEntry;
  onChange: (entry: SearchMetadataEntry) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parts = draft.split(/[,\n]/).map(normalizeToken).filter(Boolean);
    if (parts.length === 0) return;
    onChange(parts.reduce((next, part) => addToken(next, kind, part), entry));
    setDraft("");
  };

  return (
    <div className="qx-alias-section">
      <div className="qx-alias-label">{label}</div>
      <div className="qx-alias-input-row">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" size="icon" variant="secondary" onClick={commit} disabled={!draft.trim()}>
          <Plus size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="qx-alias-token-list">
        {entry[kind].length === 0 ? (
          <span className="qx-alias-empty">None</span>
        ) : (
          entry[kind].map((token) => (
            <Badge className="qx-alias-token" key={token}>
              <span>{kind === "tags" ? `#${token}` : token}</span>
              <button
                type="button"
                onClick={() => onChange(removeToken(entry, kind, token))}
                aria-label={`Remove ${token}`}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

export default function SearchAliasTagEditor({
  entry,
  onChange,
  compact = false,
}: {
  entry: SearchMetadataEntry;
  onChange: (entry: SearchMetadataEntry) => void;
  compact?: boolean;
}) {
  return (
    <div className={`qx-alias-editor${compact ? " is-compact" : ""}`}>
      <TokenSection
        label="Aliases"
        placeholder="Add alias"
        kind="aliases"
        entry={entry}
        onChange={onChange}
      />
      <TokenSection
        label="Tags"
        placeholder="Add tag"
        kind="tags"
        entry={entry}
        onChange={onChange}
      />
    </div>
  );
}
