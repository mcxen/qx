"use client";

import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

interface PremiumButtonProps {
  text?: string;
  className?: string;
  onClick?: () => void;
}

const PremiumButton = ({
  text = "Premium Button",
  className,
  onClick,
}: PremiumButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative rounded-[8px] flex items-center gap-2 pl-[48px] pr-4 tracking-tight cursor-pointer h-[44px] bg-black  hover:scale-[1.02] active:scale-[0.98] transition-all dark:border dark:border-neutral-800",
        className
      )}
    >
      <Box />
      <span className="font-medium text-white">{text}</span>
    </button>
  );
};

const Box = () => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 14);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const isArrow = (row: number, col: number) => {
    const tailX = 9 - step; // Start from outside right, move left

    // Left-pointing arrow: tailX is the left tip
    // Body extends rightward, feathers at the right end
    if (row === 2) return col >= tailX && col <= tailX + 4;
    if (row === 1 || row === 3) return col === tailX + 3;
    if (row === 0 || row === 4) return col === tailX + 4;
    return false;
  };

  return (
    <div className="absolute inset-y-0 left-1 my-auto size-9 rounded-[4px] bg-rose-500 flex flex-col justify-center items-center gap-px transition-all duration-400 ease-out shadow-sm">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex gap-[2px]">
          {[0, 1, 2, 3, 4].map((col) => (
            <Bubble key={col} highlight={isArrow(row, col)} />
          ))}
        </div>
      ))}
    </div>
  );
};

const Bubble = ({ highlight }: { highlight?: boolean }) => {
  return (
    <span
      className={cn(
        "inline-block size-[3px] bg-white/25",
        highlight && "bg-white animate-nudge"
      )}
    />
  );
};

export default PremiumButton;
