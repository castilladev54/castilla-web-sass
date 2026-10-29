import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children?: ReactNode;
  className?: string;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-6 py-2.5 text-base',
  lg: 'px-8 py-3 text-lg',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:   'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20',
  secondary: 'border border-white/10 text-gray-300 hover:bg-white/5',
  danger:    'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20',
  ghost:     'text-gray-400 hover:text-white hover:bg-white/5',
  icon:      'p-2 rounded-lg hover:bg-white/10',
  outline:   'bg-orange-500/10 text-orange-500 border border-orange-500/20 hover:bg-orange-500/20',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}, ref) => {
  const isIconVariant = variant === 'icon';
  const hasCustomBg = /\b(bg-[a-z0-9-]+|from-[a-z0-9-]+)\b/.test(className);
  const variantClass = hasCustomBg && variant === 'primary' ? 'text-white' : variantClasses[variant];
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-500/40';
  const classes = [base, variantClass, !isIconVariant ? sizeClasses[size] : '', className].filter(Boolean).join(' ');

  return (
    <button ref={ref} className={classes} disabled={disabled || isLoading} {...props}>
      {isLoading ? (
        <>
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Cargando...</span>
        </>
      ) : children}
    </button>
  );
});
Button.displayName = 'Button';
export default Button;
