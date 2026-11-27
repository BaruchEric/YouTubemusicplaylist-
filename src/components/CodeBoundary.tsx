import { Component, Suspense, type ReactNode } from 'react';

interface CodeBoundaryProps {
  children: ReactNode;
  /** Shown while the code of a part inside is on the way. */
  waiting: ReactNode;
  /** Shown in place of the parts inside when one fails to load or to draw. */
  failed: ReactNode;
}

interface CodeBoundaryState {
  hasFailed: boolean;
}

/**
 * Wraps a part of the page whose code the browser fetches on its own. A failure stays inside
 * this boundary, so the rest of the page keeps working.
 */
export class CodeBoundary extends Component<CodeBoundaryProps, CodeBoundaryState> {
  state: CodeBoundaryState = { hasFailed: false };

  static getDerivedStateFromError(): CodeBoundaryState {
    return { hasFailed: true };
  }

  render() {
    if (this.state.hasFailed) return this.props.failed;
    return <Suspense fallback={this.props.waiting}>{this.props.children}</Suspense>;
  }
}

/** The button a failed part offers. A reload fetches the page and its code again. */
export function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
    >
      Reload
    </button>
  );
}
