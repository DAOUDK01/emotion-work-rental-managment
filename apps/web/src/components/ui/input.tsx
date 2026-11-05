import { cloneElement, forwardRef, isValidElement, useId } from 'react';
import { cn } from './utils';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type ?? 'text'}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[70px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs font-medium leading-none text-foreground/90', className)}
      {...props}
    />
  );
}

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-2.5 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={props.id ?? id}
        type="checkbox"
        className={cn('h-4 w-4 rounded border-input accent-[hsl(var(--primary))]', className)}
        {...props}
      />
      {label ? (
        <label htmlFor={props.id ?? id} className="cursor-pointer select-none text-sm">
          {label}
        </label>
      ) : null}
    </div>
  );
}

/** Labelled field wrapper with error text (pairs with react-hook-form). */
export function Field({
  label,
  error,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  // Link the label to a single input child (screen readers, getByLabel); keep a caller-set id.
  let control = children;
  let controlId: string | undefined;
  if (isValidElement<{ id?: string }>(children)) {
    controlId = children.props.id ?? generatedId;
    control = cloneElement(children, { id: controlId });
  }
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={controlId}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {control}
      {hint && !error ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-2xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
