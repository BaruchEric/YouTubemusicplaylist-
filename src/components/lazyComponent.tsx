import { use, type ComponentType } from 'react';

export interface LazyComponent<P> {
  /** Draw this where the component goes, under a Suspense boundary. */
  Component: ComponentType<P>;
  /** Fetches the code before the first draw. A call that fails can be made again. */
  fetch: () => Promise<void>;
}

/**
 * A component whose code the browser fetches on its own. Unlike React.lazy, a component
 * fetched ahead of time draws at once: React.lazy shows the fallback on its first draw even
 * then, and React keeps a fallback on screen for 300 ms.
 */
export function lazyComponent<P extends object>(
  load: () => Promise<ComponentType<P>>
): LazyComponent<P> {
  let loaded: ComponentType<P> | null = null;
  // The request a draw waits on. It is kept when it fails, so the error reaches the boundary
  // above once. Clearing it would start a new request on every redraw.
  let drawRequest: Promise<ComponentType<P>> | null = null;

  async function request(): Promise<ComponentType<P>> {
    const component = await load();
    loaded = component;
    return component;
  }

  function Loaded(props: P) {
    const Ready = loaded ?? use((drawRequest ??= request()));
    return <Ready {...props} />;
  }

  return {
    Component: Loaded,
    async fetch() {
      if (!loaded) await request();
    },
  };
}
