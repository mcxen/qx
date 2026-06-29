import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("qx-shadcn-slider", className)}
    {...props}
  >
    <SliderPrimitive.Track className="qx-shadcn-slider-track">
      <SliderPrimitive.Range className="qx-shadcn-slider-range" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="qx-shadcn-slider-thumb" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;
