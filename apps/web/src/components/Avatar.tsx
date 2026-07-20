import { Link } from "react-router-dom";
import { initialsOf } from "../lib/format";

// Deterministic-hue avatar: every user gets a stable color derived server-side
// (profiles.avatarHue), so identity is recognizable with zero file uploads.
export function Avatar({
  name,
  hue,
  size = 40,
  userId,
}: {
  name: string;
  hue: number;
  size?: number;
  userId?: string;
}) {
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.4,
    background: `linear-gradient(135deg, oklch(0.62 0.16 ${hue}), oklch(0.48 0.17 ${(hue + 40) % 360}))`,
  };
  const body = (
    <span className="ob-avatar" style={style} title={name} aria-label={name}>
      {initialsOf(name)}
    </span>
  );
  return userId ? (
    <Link
      to={`/profile/${userId}`}
      className="ob-avatar"
      style={style}
      title={name}
      aria-label={`${name}'s profile`}
    >
      {initialsOf(name)}
    </Link>
  ) : (
    body
  );
}
