import { forwardRef, useId, type InputHTMLAttributes } from "react";

export type FormFieldKind = "text" | "search" | "phone" | "age" | "name" | "address" | "code";

export interface FormFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode" | "autoComplete" | "spellCheck" | "onPaste" | "size"
> {
  label: string;
  kind?: FormFieldKind;
  hint?: string;
  error?: string;
  surface?: "shade" | "paper";
}

const INPUT_PRESETS: Record<
  FormFieldKind,
  Pick<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "autoComplete" | "spellCheck">
> = {
  text: { type: "text" },
  search: { type: "search", autoComplete: "off", spellCheck: false },
  phone: { type: "tel", inputMode: "numeric", autoComplete: "tel", spellCheck: false },
  age: { type: "number", inputMode: "numeric" },
  name: { type: "text", autoComplete: "name" },
  address: { type: "text", autoComplete: "street-address", spellCheck: false },
  code: { type: "text", autoComplete: "off", spellCheck: false },
};

function normalizePlaceholder(placeholder?: string) {
  if (!placeholder || placeholder.endsWith("…")) return placeholder;
  return `${placeholder}…`;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  {
    id,
    label,
    kind = "text",
    hint,
    error,
    surface = "paper",
    className = "",
    placeholder,
    disabled,
    style,
    "aria-describedby": describedBy,
    ...inputProps
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const descriptionIds = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  const preset = INPUT_PRESETS[kind];

  return (
    <div className="w-full">
      <label className="t-body-s mb-1.5 block font-semibold" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        {...preset}
        ref={ref}
        id={inputId}
        disabled={disabled}
        placeholder={normalizePlaceholder(placeholder)}
        aria-invalid={error ? true : undefined}
        aria-describedby={descriptionIds}
        className={`bg-raised text-foreground border-border w-full rounded-md border px-3 outline-none transition-[border-color,opacity] focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:brightness-[.96] disabled:opacity-60 ${
          surface === "shade" ? "t-body" : "t-body-l"
        } ${error ? "border-danger" : ""} ${className}`}
        style={{ minHeight: surface === "shade" ? "40px" : "var(--btn-h)", ...style }}
      />
      {hint ? (
        <p id={hintId} className="t-caption text-fg-2 mt-1.5">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="t-caption text-danger mt-1.5">
          {error}
        </p>
      ) : null}
    </div>
  );
});
