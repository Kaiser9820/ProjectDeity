export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`icon material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}
