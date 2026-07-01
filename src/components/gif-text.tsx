import type { CSSProperties } from "react";

interface GifTextProps {
  text: string;
  gif?: string;
  className?: string;
  containerClassName?: string;
}

type GifTextStyle = CSSProperties & {
  "--qx-gif-text-image"?: string;
};

export default function GifText({
  text,
  gif,
  className = "",
  containerClassName = "",
}: GifTextProps) {
  const style: GifTextStyle = {
    ...(gif ? { "--qx-gif-text-image": `url(${JSON.stringify(gif)})` } : {}),
  };

  return (
    <div className={`qx-gif-text-container ${containerClassName}`.trim()} style={style}>
      <span className={`qx-gif-text ${className}`.trim()} aria-label={text}>
        <span className="qx-gif-text-base" aria-hidden="true">
          {text}
        </span>
        <span className="qx-gif-text-fill" aria-hidden="true">
          {text}
        </span>
      </span>
    </div>
  );
}
