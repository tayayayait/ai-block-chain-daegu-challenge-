import { Slot, Slottable } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "attest";
type Size = "sm" | "md" | "lg" | "xl" | "senior";

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[14px]",
  md: "h-10 px-4 text-[16px]",
  lg: "h-12 px-5 text-[18px]",
  xl: "h-14 px-6 text-[18px]",
  senior: "px-7 text-[22px] [&_svg]:size-[var(--icon-size)]",
};

function variantStyle(v: Variant): React.CSSProperties {
  switch (v) {
    case "primary":
      return { backgroundColor: "var(--brand)", color: "#FFFFFF" };
    case "secondary":
      return { color: "var(--brand)", border: "1px solid var(--brand)" };
    case "ghost":
      return { color: "var(--fg-2)" };
    case "danger":
      return { backgroundColor: "var(--danger)", color: "#FFFFFF" };
    case "attest":
      return { backgroundColor: "var(--attest)", color: "#FFFFFF" };
  }
}

export function Btn({
  asChild = false,
  variant = "primary",
  size = "md",
  loading = false,
  full = false,
  children,
  className = "",
  disabled = false,
  ...rest
}: {
  asChild?: boolean;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled || loading;

  return (
    <Comp
      {...rest}
      {...(asChild ? { "aria-disabled": isDisabled || undefined } : { disabled: isDisabled })}
      {...(asChild && isDisabled
        ? {
            onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
            },
          }
        : {})}
      aria-busy={loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,border-color,transform] duration-100 hover:brightness-95 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 ${SIZE[size]} ${full ? "w-full" : ""} ${className}`}
      style={{
        height: size === "senior" ? "var(--btn-h)" : undefined,
        minHeight: "var(--tap-min)",
        ...variantStyle(variant),
      }}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      <Slottable>{children}</Slottable>
    </Comp>
  );
}
