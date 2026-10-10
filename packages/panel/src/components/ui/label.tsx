import { cn } from '~/lib/utils';

// React 19 : ref est passé comme prop, plus besoin de forwardRef
function Label({ className, ref, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
