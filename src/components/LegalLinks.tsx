import { PRIVACY_URL, TERMS_URL } from '../utils/legalLinks';

const LINK = 'hover:text-white transition-colors';

/** The privacy policy and the terms, for the foot of the sidebar. */
export function LegalLinks() {
  return (
    <p className="flex items-center gap-2 px-1 text-[11px] text-[#8B92A2]">
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
        Privacy
      </a>
      <span aria-hidden="true">·</span>
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
        Terms
      </a>
    </p>
  );
}
