// Shared Openbook brand mark — original authored SVG (portfolio logo).
// Use size prop for nav (32) vs landing (72) without re-styling inline.

export function BrandMark({
  size = 40,
  className = "ob-brand-mark",
  alt = "Openbook",
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/openbook.svg"
      width={size}
      height={size}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}
