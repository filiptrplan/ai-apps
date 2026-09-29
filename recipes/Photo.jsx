import { usePhotoUrl } from "./photos.js";

// A recipe's photo on the striped placeholder, which shows while it loads
// and whenever there's no photo (or no session to read it with).
export function Photo({ path, session, className = "", children }) {
  const url = usePhotoUrl(path, session);
  return (
    <div className={`ra-ph ${className}`}>
      {url && <img className="ra-photo" src={url} alt="" loading="lazy" />}
      {children}
    </div>
  );
}
