import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";

interface DialogSurfaceProps {
  title: string;
  description?: string;
  children: ReactNode;
  trigger?: ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

type Surface = "shade" | "paper";

function DialogSurface({
  surface,
  title,
  description,
  children,
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  className = "",
}: DialogSurfaceProps & { surface: Surface }) {
  const isSheet = surface === "paper";

  const rootProps = {
    ...(open === undefined ? {} : { open }),
    ...(defaultOpen === undefined ? {} : { defaultOpen }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };

  return (
    <DialogPrimitive.Root {...rootProps}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0"
          style={{ backgroundColor: "rgba(13, 20, 24, 0.62)", zIndex: "var(--z-overlay)" }}
        />
        <DialogPrimitive.Content
          {...(!description ? { "aria-describedby": undefined } : {})}
          data-surface={surface}
          className={`bg-overlay text-foreground fixed overflow-y-auto border-border shadow-sh-3 focus:outline-none ${
            isSheet
              ? "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl border-t p-6"
              : "top-1/2 left-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-8"
          } ${className}`}
          style={{
            zIndex: "var(--z-modal)",
            overscrollBehavior: "contain",
            ...(isSheet
              ? { paddingBottom: "calc(var(--sp-6) + env(safe-area-inset-bottom))" }
              : undefined),
          }}
        >
          <DialogPrimitive.Title className="t-h2 pr-10">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="t-body-s text-fg-2 mt-2">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-6">{children}</div>
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label={isSheet ? "바텀시트 닫기" : "모달 닫기"}
              className="text-fg-2 hover:bg-raised absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full"
            >
              <span aria-hidden="true">×</span>
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Modal(props: DialogSurfaceProps) {
  return <DialogSurface {...props} surface="shade" />;
}

export function BottomSheet(props: DialogSurfaceProps) {
  return <DialogSurface {...props} surface="paper" />;
}
