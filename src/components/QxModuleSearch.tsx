import type {
  FocusEventHandler,
  InputHTMLAttributes,
  KeyboardEventHandler,
  Ref,
} from "react";

/**
 * Canonical QxShell top-bar search / filter field.
 *
 * Visual contract (toolbar.css):
 * - wrap: `.qx-search-wrap`
 * - leading magnifier: `.qx-search-icon`
 * - field: `.qx-plugin-search`
 *
 * Use for **module list filters** and the launcher primary search chrome.
 * Keep business logic (store, selection reset, summon focus) in the parent —
 * this component only owns markup and a11y defaults.
 *
 * Not for free-form editors (textarea). Message compose in QxAI may reuse the
 * same chrome when it sits in the Shell search slot.
 */

export interface QxModuleSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /**
   * One-shot mount focus. Defaults false so merely rendering a search field does
   * not claim keyboard ownership; launcher/composer/list surfaces opt in explicitly.
   */
  autoFocus?: boolean;
  disabled?: boolean;
  /** Extra classes on the wrap (e.g. clipboard layout tweaks). */
  className?: string;
  /** Extra classes on the input. */
  inputClassName?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  name?: string;
  /** Defaults to placeholder when omitted. */
  "aria-label"?: string;
  /**
   * Extra native input attributes (`data-qx-primary-search`, `enterKeyHint`, …).
   * Controlled fields (`value` / `onChange` / `className` / …) stay on the props above.
   */
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | "value"
    | "onChange"
    | "placeholder"
    | "className"
    | "type"
    | "autoComplete"
    | "autoCorrect"
    | "autoCapitalize"
    | "spellCheck"
    | "autoFocus"
    | "disabled"
    | "onKeyDown"
    | "onFocus"
    | "id"
    | "name"
    | "ref"
    | "aria-label"
  > & Record<string, string | number | boolean | undefined>;
}

export function QxModuleSearch({
  value,
  onChange,
  placeholder,
  autoFocus = false,
  disabled = false,
  className,
  inputClassName,
  onKeyDown,
  onFocus,
  inputRef,
  id,
  name,
  "aria-label": ariaLabel,
  inputProps,
}: QxModuleSearchProps) {
  return (
    <div className={["qx-search-wrap", className].filter(Boolean).join(" ")}>
      <span className="qx-search-icon" aria-hidden="true" />
      <input
        {...inputProps}
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={["qx-plugin-search", inputClassName].filter(Boolean).join(" ")}
      />
    </div>
  );
}

export default QxModuleSearch;
